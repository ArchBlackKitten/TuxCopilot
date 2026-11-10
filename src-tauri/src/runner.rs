// The run engine, ported from lib/run-manager.ts. A run's steps go one after another through
// one shell in one pseudo-terminal session (see run_session): output streams live, sudo asks
// once per run, and Stop signals the whole session. Output is ANSI-stripped, kept in memory,
// and polled by the view with a byte offset; finished runs (and dry runs) go into run_log.
//
// This is the one place that executes the user's own commands — deliberately separate from
// probe.rs, which only ever runs its fixed read-only list.

use serde::{Deserialize, Serialize};
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::db::{err, new_id, now_iso, Db};

const MAX_OUTPUT: usize = 400_000; // bytes kept in memory
const DB_OUTPUT_CAP: usize = 100_000; // bytes persisted to run_log
/// A step that prints nothing for this long is stopped — never while a package manager works
/// (stopping pacman half way can leave the system half-updated) or the password window is open.
const SILENCE_LIMIT: Duration = Duration::from_secs(30 * 60);
/// Programs that change the system's packages: never stopped by a limit.
const PACKAGE_WORK: &[&str] = &["pacman", "yay", "paru", "makepkg", "pacman-key", "pacstrap", "mkinitcpio", "dracut", "flatpak", "snap"];
const KILL_GRACE: Duration = Duration::from_secs(3);
/// How run_start says "Fluff won't run this" (wreck.rs): the screen opens its window on it.
pub const WRECK_PREFIX: &str = "FLUFF_WONT_RUN:";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RunStep {
    pub id: String,
    pub label: String,
    pub command: String,
    pub kind: String,
    #[serde(default)]
    pub node_ids: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RunState {
    pub status: String, // idle | running | success | failed | stopped | dry-run
    pub label: String,
    pub dry_run: bool,
    pub steps: Vec<RunStep>,
    pub current_step_index: i64,
    pub output: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub exit_summary: Option<String>,
    /// The steps that ended with an error (their index), so Apply keeps those changes pending.
    #[serde(default)]
    pub failed_steps: Vec<usize>,
    /// The steps that ended well: Apply drops only these changes (a stopped run's later steps never ran).
    #[serde(default)]
    pub ok_steps: Vec<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    #[serde(flatten)]
    pub state: RunState,
    pub total: usize,
    /// What the run is doing right now (program names), so a quiet step still shows life.
    pub activity: Vec<String>,
    /// The password window is open: the run waits for you.
    pub waiting_password: bool,
}

struct Inner {
    run: RunState,
    pgid: Option<i32>,
    stop_requested: bool,
    log_id: Option<String>,
}

pub struct Runner {
    inner: Mutex<Inner>,
    db: Db,
}

fn idle() -> RunState {
    RunState {
        status: "idle".into(),
        label: String::new(),
        dry_run: false,
        steps: vec![],
        current_step_index: -1,
        output: String::new(),
        started_at: None,
        finished_at: None,
        exit_summary: None,
        failed_steps: vec![],
        ok_steps: vec![],
    }
}

/// The largest index <= i that sits on a char boundary.
fn floor_boundary(s: &str, mut i: usize) -> usize {
    i = i.min(s.len());
    while !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

fn tail(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut start = s.len() - max;
    while !s.is_char_boundary(start) {
        start += 1;
    }
    &s[start..]
}

/// Strips CSI, OSC and two-byte escape sequences (the three patterns run-manager.ts used).
pub fn strip_ansi(s: &str) -> String {
    let b: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] != '\x1b' {
            out.push(b[i]);
            i += 1;
            continue;
        }
        match b.get(i + 1) {
            Some('[') => {
                // CSI: ESC [ params(0-9;?) intermediates(space-/) final(@-~)
                let mut j = i + 2;
                while j < b.len() && (b[j].is_ascii_digit() || b[j] == ';' || b[j] == '?') {
                    j += 1;
                }
                while j < b.len() && (' '..='/').contains(&b[j]) {
                    j += 1;
                }
                if j < b.len() && ('@'..='~').contains(&b[j]) {
                    i = j + 1;
                } else {
                    out.push(b[i]);
                    i += 1;
                }
            }
            Some(']') => {
                // OSC: ESC ] … BEL | ESC \
                let mut j = i + 2;
                let mut end = None;
                while j < b.len() {
                    if b[j] == '\x07' {
                        end = Some(j + 1);
                        break;
                    }
                    if b[j] == '\x1b' {
                        if b.get(j + 1) == Some(&'\\') {
                            end = Some(j + 2);
                        }
                        break;
                    }
                    j += 1;
                }
                match end {
                    Some(e) => i = e,
                    None => {
                        out.push(b[i]);
                        i += 1;
                    }
                }
            }
            Some(c) if ('@'..='Z').contains(c) || ('\\'..='_').contains(c) => i += 2,
            _ => {
                out.push(b[i]);
                i += 1;
            }
        }
    }
    out
}

// ── sudo's password window ───────────────────────────────────────────────
//
// Nobody can type into the run's terminal, so sudo must ask through a graphical helper named
// in SUDO_ASKPASS; the run's `sudo` wrapper (sudo_shim) adds `-A` so it always does. yay
// calls sudo itself, through the same wrapper. An explicit SUDO_ASKPASS always wins.

const ASKPASS_CANDIDATES: &[&str] = &[
    "/usr/bin/ksshaskpass",               // KDE Plasma
    "/usr/bin/lxqt-openssh-askpass",      // any desktop (Qt)
    "/usr/lib/seahorse/ssh-askpass",      // GNOME
    "/usr/lib/ssh/x11-ssh-askpass",       // any X11/XWayland desktop
    "/usr/lib/ssh/ssh-askpass",
];

const NO_ASKPASS_HINT: &str = "\n⚠ This run uses sudo, but no password helper is installed, so sudo cannot ask for \
your password here.\n  Install one and Play again:  sudo pacman -S ksshaskpass   (KDE)\n  \
or:  sudo pacman -S lxqt-openssh-askpass   (any other desktop)\n";

fn first_existing(env: Option<String>, candidates: &[&str]) -> Option<String> {
    env.filter(|p| !p.is_empty())
        .or_else(|| candidates.iter().find(|c| std::path::Path::new(c).exists()).map(|c| c.to_string()))
}

fn askpass() -> Option<String> {
    first_existing(std::env::var("SUDO_ASKPASS").ok(), ASKPASS_CANDIDATES)
}

/// sudo itself, or yay (which calls sudo to install).
fn needs_password(command: &str) -> bool {
    command
        .split(|c: char| c.is_whitespace() || matches!(c, ';' | '&' | '|' | '(' | ')' | '`' | '$'))
        .any(|w| w == "sudo" || w == "yay")
}

/// Signal everything in the run's session (the shell is its leader): with `steps_only`, the
/// current step's processes but not the shell, which then goes on to the next step.
fn signal_session(leader: i32, sig: libc::c_int, steps_only: bool) {
    let mut pids = session_members(leader);
    for d in descendants(leader) {
        if !pids.contains(&d) {
            pids.push(d);
        }
    }
    for pid in pids {
        if steps_only && pid == leader {
            continue;
        }
        // SAFETY: kill(2) on a pid; no memory involved.
        unsafe {
            libc::kill(pid, sig);
        }
    }
    if !steps_only {
        // SAFETY: as above, the whole process group.
        unsafe {
            libc::kill(-leader, sig);
        }
    }
}

/// Every process below `pid` (children, their children, …), by the ppid in /proc/<pid>/stat.
fn descendants(pid: i32) -> Vec<i32> {
    let Ok(rd) = std::fs::read_dir("/proc") else { return vec![] };
    let parents: Vec<(i32, i32)> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| e.file_name().to_str()?.parse::<i32>().ok())
        .filter_map(|p| {
            let st = std::fs::read_to_string(format!("/proc/{p}/stat")).ok()?;
            let ppid = st.rsplit_once(')')?.1.split_whitespace().nth(1)?.parse().ok()?;
            Some((p, ppid))
        })
        .collect();
    let mut out = vec![];
    let mut frontier = vec![pid];
    while let Some(cur) = frontier.pop() {
        for (p, pp) in &parents {
            if *pp == cur && !out.contains(p) {
                out.push(*p);
                frontier.push(*p);
            }
        }
    }
    out.sort();
    out
}

fn proc_name(pid: i32) -> Option<String> {
    std::fs::read_to_string(format!("/proc/{pid}/comm")).ok().map(|s| s.trim().to_string())
}

/// Every process whose session id is `sid` (field 6 of /proc/<pid>/stat).
fn session_members(sid: i32) -> Vec<i32> {
    let Ok(rd) = std::fs::read_dir("/proc") else { return vec![] };
    rd.filter_map(|e| e.ok())
        .filter_map(|e| e.file_name().to_str()?.parse::<i32>().ok())
        .filter(|pid| {
            std::fs::read_to_string(format!("/proc/{pid}/stat"))
                .ok()
                .and_then(|st| st.rsplit_once(')').map(|(_, rest)| rest.to_string()))
                .and_then(|rest| rest.split_whitespace().nth(3).and_then(|x| x.parse::<i32>().ok()))
                == Some(sid)
        })
        .collect()
}

// ── the run's terminal ───────────────────────────────────────────────────

struct Pty {
    master: i32,
    slave: i32,
}

impl Pty {
    fn open() -> std::io::Result<Pty> {
        let (mut m, mut sl) = (-1, -1);
        let ws = libc::winsize { ws_row: 40, ws_col: 120, ws_xpixel: 0, ws_ypixel: 0 };
        // SAFETY: openpty writes two fds into the given ints; name and termios may be null.
        let r = unsafe { libc::openpty(&mut m, &mut sl, std::ptr::null_mut(), std::ptr::null(), &ws) };
        if r != 0 {
            return Err(std::io::Error::last_os_error());
        }
        // SAFETY: plain fcntl on our own fds — the steps must not inherit them.
        unsafe {
            libc::fcntl(m, libc::F_SETFD, libc::FD_CLOEXEC);
            libc::fcntl(sl, libc::F_SETFD, libc::FD_CLOEXEC);
        }
        Ok(Pty { master: m, slave: sl })
    }

    /// A copy of the terminal's slave end, for the shell's stdout / stderr.
    fn slave_stdio(&self) -> std::io::Result<Stdio> {
        use std::os::fd::FromRawFd;
        // SAFETY: dup(2) of an fd we own; the new fd is handed to Stdio, which closes it.
        let d = unsafe { libc::dup(self.slave) };
        if d < 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(Stdio::from(unsafe { std::fs::File::from_raw_fd(d) }))
    }

    /// Our slave copy closed; the master end, to read what the run prints.
    fn into_master(self) -> std::fs::File {
        use std::os::fd::FromRawFd;
        let me = std::mem::ManuallyDrop::new(self);
        // SAFETY: closing our own slave fd; the master fd is moved into the File.
        unsafe {
            libc::close(me.slave);
            std::fs::File::from_raw_fd(me.master)
        }
    }
}

impl Drop for Pty {
    fn drop(&mut self) {
        // SAFETY: our own fds, closed once.
        unsafe {
            libc::close(self.master);
            libc::close(self.slave);
        }
    }
}

/// Single-quoted for bash.
pub(crate) fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// A command that may stop to ask you something — pacman's ":: Proceed? [Y/n]", rm -i. In the
/// app's panel nobody can answer, and pacman reads the silence as No (tested: it installs
/// nothing and fails), so such a run opens in a terminal window instead.
pub fn may_ask(cmd: &str) -> bool {
    cmd.split(|c| c == ';' || c == '|' || c == '&' || c == '\n').any(|part| {
        let words: Vec<&str> = part.split_whitespace().filter(|w| !w.contains('=') || w.starts_with('-')).collect();
        let words: Vec<&str> = words.into_iter().skip_while(|w| matches!(*w, "sudo" | "doas" | "env" | "nice" | "time" | "{" | "(")).collect();
        let Some(prog) = words.first().map(|w| w.rsplit('/').next().unwrap_or(w)) else { return false };
        let args = &words[1..];
        let flags: Vec<&str> = args.iter().copied().filter(|a| a.starts_with('-')).collect();
        let targets = args.iter().filter(|a| !a.starts_with('-')).count();
        let confirmless = flags.iter().any(|f| *f == "--noconfirm" || *f == "--yes" || *f == "-y" && prog == "flatpak");
        match prog {
            "pacman" | "yay" | "paru" => {
                if confirmless {
                    return false;
                }
                if args.is_empty() {
                    return prog != "pacman"; // bare yay / paru is a full update
                }
                let ops: String = flags.iter().filter(|f| !f.starts_with("--")).flat_map(|f| f[1..].chars()).collect();
                let long = |l: &str| flags.iter().any(|f| *f == l);
                let sync = ops.contains('S') || long("--sync");
                let query_only = ops.chars().any(|c| "silgp".contains(c)) || long("--search") || long("--info") || long("--print");
                (sync && !query_only && (ops.contains('u') || ops.contains('c') || ops.contains('w') || targets > 0))
                    || ops.contains('U') || ops.contains('R') || long("--upgrade") || long("--remove")
            }
            "makepkg" => !confirmless && flags.iter().any(|f| !f.starts_with("--") && f.contains('i')),
            "rm" => flags.iter().any(|f| !f.starts_with("--") && (f.contains('i') || f.contains('I'))) || flags.contains(&"--interactive"),
            // firmware: it asks before flashing, and whether to restart
            "fwupdmgr" => !flags.iter().any(|f| *f == "-y" || *f == "--assume-yes") && args.iter().any(|a| matches!(*a, "update" | "install" | "downgrade" | "security-fix" | "security-undo" | "unlock" | "reinstall")),
            _ => false,
        }
    })
}

/// The run as one script: each step in its own `bash -c`, its input empty, between markers.
/// Markers are an OSC code terminals ignore (nothing shows on screen), read back by Stream.
/// `visible`: the script prints each step's header and result itself (your own terminal shows
/// them; the app's panel then reads them from the log instead of writing its own).
fn session_script(steps: &[RunStep], visible: bool) -> String {
    let n = steps.len();
    let mut s = String::new();
    for (i, st) in steps.iter().enumerate() {
        if visible {
            s.push_str(&format!(
                "printf '\\n\\033[1m▶ [%d/%d] %s\\033[0m\\n$ %s\\n' {} {n} {} {}\n",
                i + 1,
                sh_quote(&st.label),
                sh_quote(&st.command)
            ));
        }
        s.push_str(&format!("printf '\\033]6973;S {i}\\007'\n"));
        // in your own terminal a step may ask you things; in the app nobody can answer
        s.push_str(&format!("bash -c {}{}\n__am=$?\n", sh_quote(&st.command), if visible { "" } else { " </dev/null" }));
        s.push_str(&format!("printf '\\033]6973;E {i} %d\\007' \"$__am\"\n"));
        if visible {
            s.push_str("if [ \"$__am\" = 0 ]; then printf '\\033[32m✓ done\\033[0m\\n'; else printf '\\033[31m✗ exited with code %d\\033[0m\\n' \"$__am\"; fi\n");
        }
    }
    s
}

/// The app's own folder for a run's files: $XDG_RUNTIME_DIR/tuxcopilot-<uid>, yours only.
pub(crate) fn runtime_dir() -> Option<std::path::PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    let base = std::env::var("XDG_RUNTIME_DIR").map(std::path::PathBuf::from).unwrap_or_else(|_| std::env::temp_dir());
    // SAFETY: getuid(2) cannot fail.
    let dir = base.join(format!("tuxcopilot-{}", unsafe { libc::getuid() }));
    std::fs::create_dir_all(&dir).ok()?;
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).ok()?;
    Some(dir)
}

/// `sudo` for the run, first in its PATH: always through the password window (`-A`), so it
/// never waits on the terminal where nobody can type. With no window helper installed it
/// fails at once (`-n`) instead of hanging; the run's header says what to install.
fn sudo_shim(has_helper: bool) -> Option<std::path::PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    let real = ["/usr/bin/sudo", "/bin/sudo"].into_iter().find(|p| std::path::Path::new(p).exists())?;
    let dir = runtime_dir()?.join("bin");
    std::fs::create_dir_all(&dir).ok()?;
    let flag = if has_helper { "-A" } else { "-n" };
    let file = dir.join("sudo");
    std::fs::write(&file, format!("#!/bin/sh\nexec {real} {flag} \"$@\"\n")).ok()?;
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).ok()?;
    Some(dir)
}

// ── reading the run's terminal ───────────────────────────────────────────

const MARK: &str = "\x1b]6973;";

/// Our OSC markers (ESC ] 6973 ; … BEL) → \x1e…\x1e, which `events` splits on.
fn markers_to_rs(t: &str) -> String {
    let mut out = String::with_capacity(t.len());
    let mut rest = t;
    while let Some(i) = rest.find(MARK) {
        out.push_str(&rest[..i]);
        let after = &rest[i + MARK.len()..];
        match after.find('\x07') {
            Some(j) => {
                out.push('\x1e');
                out.push_str(&after[..j]);
                out.push('\x1e');
                rest = &after[j + 1..];
            }
            None => {
                out.push_str(&rest[i..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

#[derive(Debug, PartialEq)]
enum Event {
    Done, // the run in your own terminal has finished
    Text(String),
    Start(usize),
    End(usize, i32),
}

/// Bytes from the terminal → text and step markers. Keeps what is cut off at a chunk's end
/// (half a character, half a marker, a lone \r that may be half of \r\n, half an ESC code).
#[derive(Default)]
struct Stream {
    carry: Vec<u8>,
    skip_newline: bool,
}

impl Stream {
    fn feed(&mut self, bytes: &[u8]) -> Vec<Event> {
        self.carry.extend_from_slice(bytes);
        let valid = match std::str::from_utf8(&self.carry) {
            Ok(_) => self.carry.len(),
            Err(e) if e.error_len().is_none() => e.valid_up_to(),
            Err(_) => self.carry.len(),
        };
        let text = String::from_utf8_lossy(&self.carry[..valid]).into_owned();
        let mut keep_from = text.len();
        // a marker not closed yet, a trailing \r, or an unfinished ESC code wait for more
        if let Some(i) = text.rfind(MARK) {
            if !text[i..].contains('\x07') {
                keep_from = i;
            }
        }
        if keep_from == text.len() {
            if text.ends_with('\r') {
                keep_from = text.len() - 1;
            } else if let Some(e) = text.rfind('\x1b') {
                let tail = &text[e..];
                if tail.len() < 32 && !tail.chars().skip(2).any(|c| ('@'..='~').contains(&c)) && !tail.contains('\x07') {
                    keep_from = e;
                }
            }
        }
        let rest = text[keep_from..].as_bytes().to_vec();
        let mut leftover = rest;
        leftover.extend_from_slice(&self.carry[valid..]);
        self.carry = leftover;
        self.events(&markers_to_rs(&text[..keep_from]))
    }

    fn flush(&mut self) -> Option<Event> {
        let t = String::from_utf8_lossy(&std::mem::take(&mut self.carry)).into_owned();
        (!t.is_empty()).then(|| Event::Text(clean(&t)))
    }

    fn events(&mut self, text: &str) -> Vec<Event> {
        let mut out = vec![];
        let mut parts = text.split('\x1e');
        let mut in_marker = false;
        let mut first = true;
        while let Some(part) = parts.next() {
            if !first {
                in_marker = !in_marker;
            }
            first = false;
            if in_marker {
                let w: Vec<&str> = part.split_whitespace().collect();
                match w.as_slice() {
                    ["S", i] => out.extend(i.parse().ok().map(Event::Start)),
                    ["E", i, c] => out.extend(i.parse().ok().zip(c.parse().ok()).map(|(i, c)| Event::End(i, c))),
                    ["D"] => out.push(Event::Done),
                    _ => {}
                }
            } else {
                let mut t = part;
                if self.skip_newline {
                    t = t.strip_prefix("\r\n").or_else(|| t.strip_prefix('\n')).unwrap_or(t);
                    if !t.is_empty() || !part.is_empty() {
                        self.skip_newline = t.is_empty() && part.is_empty();
                    }
                }
                if !t.is_empty() {
                    out.push(Event::Text(clean(t)));
                }
            }
        }
        out
    }
}

/// The terminal's \r\n back to \n, colours and cursor codes out. A lone \r stays: it is a
/// progress line redrawing itself, and the view shows only its last state.
fn clean(t: &str) -> String {
    let mut t = strip_ansi(&t.replace("\r\n", "\n"));
    // KDE's password window complains about sudo's prompt text, harmlessly, every time
    const NOISE: &str = "ksshaskpass: Unable to parse phrase";
    while let Some(i) = t.find(NOISE) {
        let end = t[i..].find('\n').map(|j| i + j + 1).unwrap_or(t.len());
        t.replace_range(i..end, "");
    }
    t
}

impl Runner {
    pub fn new(db: Db) -> Arc<Self> {
        // a run that was going when the app stopped (closed, or restarted) did not finish here
        let _ = db.lock().unwrap().execute(
            "UPDATE run_log SET status = 'interrupted', output = output || ?1 WHERE status = 'running'",
            ["\n■ interrupted — TuxCopilot closed or restarted while this ran; check the result before running it again\n"],
        );
        Arc::new(Runner {
            inner: Mutex::new(Inner { run: idle(), pgid: None, stop_requested: false, log_id: None }),
            db,
        })
    }

    pub fn snapshot(&self, since: usize) -> Snapshot {
        let g = self.inner.lock().unwrap();
        let out = &g.run.output;
        let from = floor_boundary(out, since);
        let mut state = g.run.clone();
        state.output = out[from..].to_string();
        let (activity, waiting_password) = match (g.run.status.as_str(), g.pgid) {
            ("running", Some(p)) => {
                let names: Vec<String> = descendants(p).into_iter().filter_map(|pid| proc_name(pid)).collect();
                let waiting = names.iter().any(|n| n.contains("askpass"));
                let mut shown: Vec<String> = names.into_iter().filter(|n| !matches!(n.as_str(), "bash" | "sh" | "script" | "sudo")).collect();
                shown.dedup();
                (shown, waiting)
            }
            _ => (vec![], false),
        };
        Snapshot { state, total: out.len(), activity, waiting_password }
    }

    fn append(&self, chunk: &str) {
        let mut g = self.inner.lock().unwrap();
        g.run.output.push_str(chunk);
        if g.run.output.len() > MAX_OUTPUT {
            g.run.output = tail(&g.run.output, MAX_OUTPUT).to_string();
        }
    }

    pub fn start(self: &Arc<Self>, steps: Vec<RunStep>, label: String, dry_run: bool) -> Result<(), String> {
        let mut g = self.inner.lock().unwrap();
        if g.run.status == "running" {
            return Err("Fluff is already running something: wait for it to finish, or stop it (the terminal panel)".into());
        }
        let n = steps.len();
        let plural = if n == 1 { "" } else { "s" };
        let commands = serde_json::to_string(&steps).map_err(err)?;
        let now = now_iso();

        if dry_run {
            let mut lines = vec![format!("── DRY RUN ─ {label}"), format!("Fluff would run {n} step{plural}:"), String::new()];
            for (i, s) in steps.iter().enumerate() {
                lines.push(format!("[{}] {}", i + 1, s.label));
                lines.push(format!("    $ {}", s.command));
                lines.push(String::new());
            }
            lines.push("Nothing ran: this was a dry run. Turn off Dry Run and Fluff runs it for real.".into());
            let output = lines.join("\n");
            g.run = RunState {
                status: "dry-run".into(),
                label: label.clone(),
                dry_run: true,
                steps,
                current_step_index: -1,
                output: output.clone(),
                started_at: Some(now.clone()),
                finished_at: Some(now.clone()),
                exit_summary: Some(format!("Dry run — Fluff showed {n} step{plural}, ran none")),
                failed_steps: vec![],
        ok_steps: vec![],
            };
            g.stop_requested = false;
            g.pgid = None;
            drop(g);
            // dry-run previews go into history too (best-effort)
            let _ = self.db.lock().unwrap().execute(
                "INSERT INTO run_log (id, label, commands, output, status, dry_run, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 'dry-run', 1, ?5, ?5)",
                (new_id(), &label, &commands, tail(&output, DB_OUTPUT_CAP), &now),
            );
            return Ok(());
        }

        let mut header = format!("── PLAY ─ {label}\n{n} step{plural} queued\n");
        if steps.iter().any(|s| needs_password(&s.command)) && askpass().is_none() {
            header.push_str(NO_ASKPASS_HINT);
        }
        g.stop_requested = false;
        g.pgid = None;
        g.run = RunState {
            status: "running".into(),
            label: label.clone(),
            dry_run: false,
            steps,
            current_step_index: -1,
            output: header,
            started_at: Some(now.clone()),
            finished_at: None,
            exit_summary: None,
            failed_steps: vec![],
        ok_steps: vec![],
        };
        let log_id = new_id();
        let logged = self
            .db
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO run_log (id, label, commands, status, dry_run, created_at, updated_at)
                 VALUES (?1, ?2, ?3, 'running', 0, ?4, ?4)",
                (&log_id, &label, &commands, &now),
            )
            .is_ok();
        g.log_id = logged.then_some(log_id);
        drop(g);

        let me = Arc::clone(self);
        thread::spawn(move || me.run_loop());
        Ok(())
    }

    fn run_loop(self: &Arc<Self>) {
        let steps = self.inner.lock().unwrap().run.steps.clone();
        let n = steps.len();
        let chosen = crate::db::setting_get(&self.db.lock().unwrap(), "run.terminal").filter(|t| crate::terminal::installed(t));
        // a run that may ask a question goes where you can answer: your terminal
        let terminal = chosen.or_else(|| {
            if !steps.iter().any(|s| may_ask(&s.command)) {
                return None;
            }
            let t = crate::terminal::terminals().preferred_installed();
            match &t {
                Some(t) => self.append(&format!("This run may ask you questions (pacman asks before it changes anything), so it opens in {t}, where you can answer.\n")),
                None => self.append("This run may ask you questions, but no terminal was found to answer them in; inside TuxCopilot nobody can answer, and pacman takes that as No. Settings → Where commands run can choose one.\n"),
            }
            t
        });
        let failed = match terminal {
            Some(t) => {
                let label = self.inner.lock().unwrap().run.label.clone();
                self.run_external(&steps, &t, &label)
            }
            None => self.run_session(&steps),
        };

        let (status, log_id, output) = {
            let mut g = self.inner.lock().unwrap();
            g.run.finished_at = Some(now_iso());
            let summary = if g.stop_requested {
                g.run.status = "stopped".into();
                let at = g.run.current_step_index;
                if at >= 0 { format!("You stopped Fluff at step {} of {}", at + 1, n) } else { "You stopped Fluff".into() }
            } else if failed > 0 {
                g.run.status = "failed".into();
                format!("Fluff finished {} of {} steps; {} failed", n - failed, n, failed)
            } else {
                g.run.status = "success".into();
                format!("Fluff finished {}", if n == 1 { "the step".to_string() } else { format!("all {n} steps") })
            };
            g.run.output.push_str(&format!("\n■ {summary}\n"));
            g.run.exit_summary = Some(summary);
            g.pgid = None;
            (g.run.status.clone(), g.log_id.take(), tail(&g.run.output, DB_OUTPUT_CAP).to_string())
        };
        if let Some(id) = log_id {
            let _ = self.db.lock().unwrap().execute(
                "UPDATE run_log SET status = ?1, output = ?2, updated_at = ?3 WHERE id = ?4",
                (&status, &output, now_iso(), &id),
            );
        }
    }

    /// The run in your own terminal (Settings → Where commands run): a window you can see and
    /// type into — sudo asks there, and a step may ask you questions. `script` records the
    /// window into a log the app follows, so its panel shows the same and still knows each
    /// step's result. Terminals that hand the window to a running copy return at once, so the
    /// app watches the log and the window's shell (its pid file), not the terminal program.
    fn run_external(self: &Arc<Self>, steps: &[RunStep], term: &str, label: &str) -> usize {
        self.run_in_window(steps, term, label, |title, script| crate::terminal::argv(term, title, script))
    }

    fn run_in_window(self: &Arc<Self>, steps: &[RunStep], term: &str, label: &str, make_argv: impl Fn(&str, &str) -> Option<Vec<String>>) -> usize {
        let n = steps.len();
        let Some(dir) = runtime_dir() else {
            self.append("no folder for the run's files\n");
            return n;
        };
        // unique even for two runs in the same millisecond
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let id = format!("{}-{}-{seq}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
        let (steps_sh, outer, log, pidf) = (dir.join(format!("run-{id}.sh")), dir.join(format!("term-{id}.sh")), dir.join(format!("run-{id}.log")), dir.join(format!("run-{id}.pid")));
        // removed however this ends
        struct Cleanup(Vec<std::path::PathBuf>);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                for f in &self.0 {
                    let _ = std::fs::remove_file(f);
                }
            }
        }
        let _cleanup = Cleanup(vec![steps_sh.clone(), outer.clone(), log.clone(), pidf.clone()]);
        let p = |x: &std::path::Path| sh_quote(&x.to_string_lossy());
        let title = format!("TuxCopilot — {label}");
        let outer_text = format!(
            "#!/bin/bash\necho $$ > {pid}\ncd ~\nprintf '\\033]0;%s\\007' {title}\nscript -qefc {inner} {log}\nprintf '\\033]6973;D\\007' >> {log}\nprintf '\\nFinished. Press Enter to close this window. '\nread -r _\n",
            pid = p(&pidf),
            title = sh_quote(&title),
            inner = sh_quote(&format!("bash {}", p(&steps_sh))),
            log = p(&log),
        );
        let written = std::fs::write(&steps_sh, session_script(steps, true)).and_then(|_| std::fs::write(&outer, outer_text)).and_then(|_| std::fs::write(&log, ""));
        if let Err(e) = written {
            self.append(&format!("could not write the run's files: {e}\n"));
            return n;
        }
        let Some(argv) = make_argv(&title, &outer.to_string_lossy()) else {
            self.append(&format!("unknown terminal: {term}\n"));
            return n;
        };
        self.append(&format!("(running in your terminal: {term} — type there if it asks you something)\n"));
        let mut child = match Command::new(&argv[0]).args(&argv[1..]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn() {
            Ok(c) => c,
            Err(e) => {
                self.append(&format!("could not open {term}: {e}\n"));
                return n;
            }
        };

        let mut stream = Stream::default();
        let mut offset = 0u64;
        let mut failed = 0usize;
        let mut ended = 0usize;
        let mut done = false;
        let mut shell: Option<i32> = None;
        let started = Instant::now();
        let mut gone_since: Option<Instant> = None;
        loop {
            let _ = child.try_wait(); // reap the terminal program if it returned
            if shell.is_none() {
                if let Some(pid) = std::fs::read_to_string(&pidf).ok().and_then(|t| t.trim().parse::<i32>().ok()) {
                    shell = Some(pid);
                    self.inner.lock().unwrap().pgid = Some(pid);
                } else if started.elapsed() > Duration::from_secs(20) {
                    self.append(&format!("{term} did not open a window\n"));
                    break;
                }
            }
            if let Ok(mut f) = std::fs::File::open(&log) {
                use std::io::{Seek, SeekFrom};
                if f.seek(SeekFrom::Start(offset)).is_ok() {
                    let mut buf = vec![];
                    if f.read_to_end(&mut buf).is_ok() && !buf.is_empty() {
                        offset += buf.len() as u64;
                        for ev in stream.feed(&buf) {
                            match ev {
                                Event::Text(t) => self.append(&t),
                                Event::Start(i) => self.inner.lock().unwrap().run.current_step_index = i as i64,
                                Event::End(at, code) => {
                                    ended += 1;
                                    if code != 0 {
                                        failed += 1;
                                        self.inner.lock().unwrap().run.failed_steps.push(at);
                                    } else {
                                        self.inner.lock().unwrap().run.ok_steps.push(at);
                                    }
                                }
                                Event::Done => done = true,
                            }
                        }
                    }
                }
            }
            if done || self.inner.lock().unwrap().stop_requested {
                break;
            }
            // the window was closed before the run finished
            // SAFETY: kill(pid, 0) only checks that the process exists.
            if let Some(pid) = shell {
                if unsafe { libc::kill(pid, 0) } != 0 {
                    let t = *gone_since.get_or_insert_with(Instant::now);
                    if t.elapsed() > Duration::from_secs(1) {
                        self.append("\nthe terminal window was closed before the run finished\n");
                        break;
                    }
                }
            }
            thread::sleep(Duration::from_millis(100));
        }
        if let Some(Event::Text(t)) = stream.flush() {
            self.append(&t);
        }
        self.inner.lock().unwrap().pgid = None;
        failed + (n - ended.min(n))
    }

    /// All steps in ONE shell, in one pseudo-terminal session:
    /// - programs see a terminal, so they print as they go (pacman, yay, curl…), and
    /// - sudo remembers the password for the whole run (its tickets are per terminal session),
    ///   so it is asked once, whoever calls sudo (yay calls it too).
    /// sudo always asks through the graphical helper (`-A`, via a wrapper first in PATH), never
    /// on the terminal, where nobody could answer. Markers between steps (\x1e…\x1e) tell the
    /// reader where a step starts and how it ended. Returns how many steps failed.
    fn run_session(self: &Arc<Self>, steps: &[RunStep]) -> usize {
        let n = steps.len();
        let pty = match Pty::open() {
            Ok(p) => p,
            Err(e) => {
                self.append(&format!("could not open a terminal for the run: {e}\n"));
                return n;
            }
        };
        let home = std::env::var("HOME").unwrap_or_else(|_| "/".into());
        let mut cmd = Command::new("bash");
        cmd.arg("-c").arg(session_script(steps, false)).current_dir(home).env("TERM", "dumb").env("NO_COLOR", "1");
        // a question no one can answer must fail, not wait: git gives up, ssh asks the helper
        cmd.env("GIT_TERMINAL_PROMPT", "0");
        if let Some(helper) = askpass() {
            cmd.env("SUDO_ASKPASS", &helper).env("SSH_ASKPASS", &helper).env("SSH_ASKPASS_REQUIRE", "force");
        }
        if let Some(dir) = sudo_shim(askpass().is_some()) {
            let path = std::env::var("PATH").unwrap_or_else(|_| "/usr/local/bin:/usr/bin:/bin".into());
            cmd.env("PATH", format!("{}:{path}", dir.display()));
        }
        cmd.stdin(Stdio::null());
        match (pty.slave_stdio(), pty.slave_stdio()) {
            (Ok(o), Ok(e)) => {
                cmd.stdout(o).stderr(e);
            }
            _ => {
                self.append("could not attach the run's terminal\n");
                return n;
            }
        }
        // SAFETY: setsid(2) and ioctl(2) are async-signal-safe. fd 1 is the terminal by now.
        unsafe {
            cmd.pre_exec(move || {
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                if libc::ioctl(1, libc::TIOCSCTTY as _, 0) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let spawned = cmd.spawn();
        // the child holds the terminal now; with our copy closed, its end reads as EOF/EIO
        let master = pty.into_master();
        let mut child = match spawned {
            Ok(c) => c,
            Err(e) => {
                self.append(&format!("spawn error: {e}\n"));
                return n;
            }
        };
        let leader = child.id() as i32;
        self.inner.lock().unwrap().pgid = Some(leader);

        let failed = Arc::new(Mutex::new(0usize));
        let step_started = Arc::new(Mutex::new(None::<Instant>));
        let last_output = Arc::new(Mutex::new(Instant::now()));
        let shell_done = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let reader = {
            let me = Arc::clone(self);
            let shell_done = Arc::clone(&shell_done);
            let steps = steps.to_vec();
            let failed = Arc::clone(&failed);
            let step_started = Arc::clone(&step_started);
            let last_output = Arc::clone(&last_output);
            thread::spawn(move || {
                use std::os::fd::AsRawFd;
                let mut master = master;
                let mut buf = [0u8; 8192];
                let mut stream = Stream::default();
                let mut quiet_since_done: Option<Instant> = None;
                loop {
                    // wait for output at most 200 ms at a time, so the end of the run is
                    // noticed even when a leftover background program keeps the terminal open
                    let mut pfd = libc::pollfd { fd: master.as_raw_fd(), events: libc::POLLIN, revents: 0 };
                    // SAFETY: one pollfd on our own fd.
                    let ready = unsafe { libc::poll(&mut pfd, 1, 200) };
                    if ready == 0 {
                        if shell_done.load(std::sync::atomic::Ordering::SeqCst) {
                            let t = *quiet_since_done.get_or_insert_with(Instant::now);
                            if t.elapsed() > Duration::from_millis(600) {
                                break;
                            }
                        }
                        continue;
                    }
                    match master.read(&mut buf) {
                        Ok(0) | Err(_) => break, // EIO: every holder of the terminal is gone
                        Ok(k) => {
                            *last_output.lock().unwrap() = Instant::now();
                            for ev in stream.feed(&buf[..k]) {
                                match ev {
                                    Event::Done => {}
                                    Event::Text(t) => me.append(&t),
                                    Event::Start(i) => {
                                        if let Some(st) = steps.get(i) {
                                            me.inner.lock().unwrap().run.current_step_index = i as i64;
                                            *step_started.lock().unwrap() = Some(Instant::now());
                                            me.append(&format!("\n▶ [{}/{}] {}\n$ {}\n", i + 1, steps.len(), st.label, st.command));
                                        }
                                    }
                                    Event::End(at, code) => {
                                        if code != 0 {
                                            me.inner.lock().unwrap().run.failed_steps.push(at);
                                        } else {
                                            me.inner.lock().unwrap().run.ok_steps.push(at);
                                        }
                                        *step_started.lock().unwrap() = None;
                                        if !me.inner.lock().unwrap().run.output.ends_with('\n') {
                                            me.append("\n");
                                        }
                                        if code == 0 {
                                            me.append("✓ done\n");
                                        } else {
                                            *failed.lock().unwrap() += 1;
                                            me.append(&format!("✗ exited with code {code}\n"));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                if let Some(Event::Text(t)) = stream.flush() {
                    me.append(&t);
                }
            })
        };

        let mut timed_out_at: Option<Instant> = None;
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {}
                Err(e) => {
                    self.append(&format!("error: {e}\n"));
                    break;
                }
            }
            let since = *step_started.lock().unwrap();
            let quiet = last_output.lock().unwrap().elapsed();
            let busy_with_packages = || {
                let names: Vec<String> = descendants(leader).into_iter().filter_map(proc_name).collect();
                names.iter().any(|n| PACKAGE_WORK.contains(&n.as_str()) || n.contains("askpass"))
            };
            if timed_out_at.is_none() && since.is_some() && quiet > SILENCE_LIMIT && !busy_with_packages() {
                self.append(&format!("⏱ the step printed nothing for {} minutes — stopping it\n", SILENCE_LIMIT.as_secs() / 60));
                // the step's processes only: the shell then goes on to the next step
                signal_session(leader, libc::SIGTERM, true);
                timed_out_at = Some(Instant::now());
            }
            if let Some(t) = timed_out_at {
                if since.is_none() {
                    timed_out_at = None;
                } else if t.elapsed() > KILL_GRACE {
                    signal_session(leader, libc::SIGKILL, true);
                }
            }
            thread::sleep(Duration::from_millis(50));
        }
        shell_done.store(true, std::sync::atomic::Ordering::SeqCst);
        let _ = reader.join();
        self.inner.lock().unwrap().pgid = None;
        let f = *failed.lock().unwrap();
        f
    }

    pub fn stop(self: &Arc<Self>) -> bool {
        let pgid = {
            let mut g = self.inner.lock().unwrap();
            if g.run.status != "running" {
                return false;
            }
            g.stop_requested = true;
            g.run.output.push_str("\n■ stop requested — terminating…\n");
            g.pgid
        };
        if let Some(p) = pgid {
            signal_session(p, libc::SIGTERM, false);
            let me = Arc::clone(self);
            thread::spawn(move || {
                thread::sleep(KILL_GRACE);
                // only if that same run is still going
                if me.inner.lock().unwrap().pgid == Some(p) {
                    signal_session(p, libc::SIGKILL, false);
                }
            });
        }
        true
    }
}

// ── history ──────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunLogRow {
    id: String,
    label: String,
    commands: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    output: Option<String>,
    status: String,
    dry_run: bool,
    created_at: String,
    updated_at: String,
}

fn log_row(r: &rusqlite::Row, with_output: bool) -> rusqlite::Result<RunLogRow> {
    Ok(RunLogRow {
        id: r.get("id")?,
        label: r.get("label")?,
        commands: r.get("commands")?,
        output: if with_output { Some(r.get("output")?) } else { None },
        status: r.get("status")?,
        dry_run: r.get::<_, i64>("dry_run")? != 0,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

// ── commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn run_start(
    runner: tauri::State<'_, Arc<Runner>>,
    steps: Vec<RunStep>,
    label: String,
    dry_run: bool,
) -> Result<(), String> {
    // what would wreck the system is never run by Fluff (a dry run only shows it, so it may)
    if !dry_run {
        if let Some(w) = steps.iter().find_map(|s| crate::wreck::wrecks(&s.command)) {
            return Err(format!("{WRECK_PREFIX}{}", serde_json::to_string(&w).unwrap_or_default()));
        }
    }
    runner.start(steps, label, dry_run)
}

#[tauri::command]
pub async fn run_snapshot(runner: tauri::State<'_, Arc<Runner>>, since: usize) -> Result<Snapshot, String> {
    Ok(runner.snapshot(since))
}

#[tauri::command]
pub async fn run_stop(runner: tauri::State<'_, Arc<Runner>>) -> Result<bool, String> {
    Ok(runner.stop())
}

#[tauri::command]
pub async fn runs_list(db: tauri::State<'_, Db>) -> Result<Vec<RunLogRow>, String> {
    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, label, commands, status, dry_run, created_at, updated_at FROM run_log ORDER BY created_at DESC LIMIT 50")
        .map_err(err)?;
    let rows = stmt.query_map([], |r| log_row(r, false)).map_err(err)?.collect::<Result<_, _>>().map_err(err)?;
    Ok(rows)
}

#[tauri::command]
pub async fn run_get(db: tauri::State<'_, Db>, id: String) -> Result<RunLogRow, String> {
    db.lock()
        .unwrap()
        .query_row("SELECT * FROM run_log WHERE id = ?1", [&id], |r| log_row(r, true))
        .map_err(|_| "Run not found".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_firmware_update_goes_where_you_can_answer() {
        assert!(may_ask("fwupdmgr update 0123456789abcd"));
        assert!(may_ask("sudo fwupdmgr install x.cab"));
        assert!(!may_ask("fwupdmgr update -y 0123456789abcd"), "it answers itself");
        assert!(!may_ask("fwupdmgr refresh --force"));
        assert!(!may_ask("fwupdmgr get-updates --json"));
    }

    #[test]
    fn a_command_that_may_ask_goes_where_you_can_answer() {
        // what pacman asks before changing anything — in the panel it would read that as No
        for c in [
            "sudo pacman -Syu",
            "yay -Syu",
            "yay",
            "sudo pacman -Syu --needed firewalld && sudo systemctl enable --now firewalld.service",
            "sudo pacman -Rns vlc",
            "sudo pacman -Scc",
            "sudo pacman -U ./x.pkg.tar.zst",
            "{ command -v tor >/dev/null || sudo pacman -Syu --needed tor; } && echo ok",
            "sudo pacman -Sy archlinux-keyring && sudo pacman -Syu",
            "d=$(mktemp -d) && cd \"$d\" && makepkg -si",
            "rm -ri ~/.config/vlc",
            "LANG=C sudo pacman -S vlc",
            "time sudo pacman -Syu",
            "( sudo pacman -Rns vlc )",
            "{ sudo pacman -Syu; }",
        ] {
            assert!(may_ask(c), "{c}");
        }
        // these answer themselves, or only read
        for c in [
            "sudo pacman -Syu --needed --noconfirm vlc",
            "yay -Syu --noconfirm",
            "pacman -Qqe",
            "pacman -Ss firefox",
            "pacman -Si firefox",
            "sudo pacman -Sy",
            "sudo pacman -D --asdeps vlc",
            "makepkg --printsrcinfo",
            "makepkg -si --noconfirm",
            "rm -rf ~/.cache/yay/vlc",
            "sudo systemctl enable --now cups.service",
            "echo pacman -Syu",
            "flatpak install --user -y --noninteractive flathub org.x.Y",
        ] {
            assert!(!may_ask(c), "{c}");
        }
    }
    use crate::db::open_memory;

    fn step(cmd: &str) -> RunStep {
        RunStep { id: "s".into(), label: "t".into(), command: cmd.into(), kind: "shell".into(), node_ids: vec![] }
    }

    fn wait_done(r: &Arc<Runner>) -> RunState {
        for _ in 0..200 {
            let s = r.snapshot(0).state;
            if s.status != "running" {
                return s;
            }
            thread::sleep(Duration::from_millis(50));
        }
        panic!("run did not finish");
    }

    #[test]
    fn a_password_helper_is_found_and_the_environment_wins() {
        assert_eq!(first_existing(Some("/my/helper".into()), &["/bin/sh"]).as_deref(), Some("/my/helper"));
        assert_eq!(first_existing(None, &["/nope/a", "/bin/sh"]).as_deref(), Some("/bin/sh"));
        assert_eq!(first_existing(Some(String::new()), &["/nope/a"]), None);
        assert!(needs_password("sudo pacman -S --needed --noconfirm firefox"));
        assert!(needs_password("cd x && yay -S foo"));
        assert!(!needs_password("echo pseudo; yayo"));
    }

    #[test]
    fn the_password_windows_harmless_complaint_is_dropped() {
        assert_eq!(clean("a\r\nksshaskpass: Unable to parse phrase \"[sudo] password for x: \"\r\nb\r\n"), "a\nb\n");
    }

    #[test]
    fn ansi_is_stripped() {
        assert_eq!(strip_ansi("\x1b[1;32mok\x1b[0m done"), "ok done");
        assert_eq!(strip_ansi("\x1b]0;title\x07text"), "text");
        // `ESC (` is outside the two-byte set the original stripped, so it survives
        assert_eq!(strip_ansi("a\x1b(b"), "a\x1b(b");
    }

    #[test]
    fn steps_run_in_order_and_failures_are_counted() {
        let db: Db = Arc::new(Mutex::new(open_memory()));
        let r = Runner::new(db.clone());
        r.start(vec![step("echo one"), step("exit 3"), step("printf 'ü%s' x")], "T".into(), false).unwrap();
        let s = wait_done(&r);
        assert_eq!(s.status, "failed");
        assert!(s.output.contains("one\n✓ done"));
        assert!(s.output.contains("✗ exited with code 3"));
        assert!(s.output.contains("üx"));
        assert_eq!(s.exit_summary.as_deref(), Some("Fluff finished 2 of 3 steps; 1 failed"));
        // which ones, for Apply
        assert_eq!((s.ok_steps.clone(), s.failed_steps.clone()), (vec![0, 2], vec![1]));
        let status: String = db.lock().unwrap().query_row("SELECT status FROM run_log", [], |r| r.get(0)).unwrap();
        assert_eq!(status, "failed");
    }

    #[test]
    fn stop_kills_the_whole_process_group() {
        let db: Db = Arc::new(Mutex::new(open_memory()));
        let r = Runner::new(db);
        // the sleep is a child of bash: only a group kill reaches it
        r.start(vec![step("sleep 30; echo late"), step("echo never")], "T".into(), false).unwrap();
        thread::sleep(Duration::from_millis(300));
        let t = Instant::now();
        assert!(r.stop());
        let s = wait_done(&r);
        assert!(t.elapsed() < Duration::from_secs(5));
        assert_eq!(s.status, "stopped");
        assert!(!s.output.contains("never"));
    }

    // Steps share ONE terminal session on purpose — sudo then asks once per run, and programs
    // print live.
    #[test]
    fn every_step_shares_one_terminal_session_and_sudo_uses_the_window() {
        let db: Db = Arc::new(Mutex::new(open_memory()));
        let r = Runner::new(db);
        let probe = "printf 'SID<%s>\\n' \"$(ps -o sid= -p $$ | tr -d ' ')\"; [ -t 1 ] && printf 'TTY<%s>\\n' yes; printf 'SUDO<%s>\\n' \"$(cat \"$(command -v sudo)\" | tail -1)\"";
        r.start(vec![step(probe), step(probe)], "T".into(), false).unwrap();
        let s = wait_done(&r);
        let grab = |tag: &str| -> Vec<String> {
            s.output.match_indices(&format!("{tag}<")).map(|(i, _)| {
                let rest = &s.output[i + tag.len() + 1..];
                rest[..rest.find('>').unwrap()].to_string()
            }).filter(|v| v != "%s").collect() // the echoed command carries the same tags
        };
        let sids = grab("SID");
        assert_eq!(sids.len(), 2, "{}", s.output);
        assert_eq!(sids[0], sids[1], "both steps in the same session");
        assert_eq!(grab("TTY"), vec!["yes", "yes"], "output goes to a terminal");
        let shim = &grab("SUDO")[0];
        assert!(shim.contains(if askpass().is_some() { " -A " } else { " -n " }), "{shim}");
    }

    #[test]
    fn output_arrives_while_the_step_still_runs() {
        if !std::path::Path::new("/usr/bin/python3").exists() {
            return;
        }
        let db: Db = Arc::new(Mutex::new(open_memory()));
        let r = Runner::new(db);
        // python holds its output back on a pipe and prints line by line on a terminal
        r.start(vec![step("python3 -c \"import time; print('EAR'+'LY'); time.sleep(2); print('LA'+'TE')\"")], "T".into(), false).unwrap();
        let t = Instant::now();
        let mut seen_live = false;
        while t.elapsed() < Duration::from_millis(1700) {
            let s = r.snapshot(0).state;
            if s.status == "running" && s.output.contains("EARLY") && !s.output.contains("LATE") {
                seen_live = true;
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }
        let s = wait_done(&r);
        assert!(seen_live, "{}", s.output);
        assert!(s.output.contains("LATE\n✓ done"), "{}", s.output);
    }

    #[test]
    fn a_program_left_running_in_the_background_does_not_hang_the_run() {
        let db: Db = Arc::new(Mutex::new(open_memory()));
        let r = Runner::new(db);
        let t = Instant::now();
        r.start(vec![step("sleep 20 & echo after")], "T".into(), false).unwrap();
        let s = wait_done(&r);
        assert!(t.elapsed() < Duration::from_secs(5));
        assert_eq!(s.status, "success", "{}", s.output);
        let _ = Command::new("pkill").args(["-f", "^sleep 20$"]).status();
    }

    /// A stand-in terminal that forks and returns at once (as kitty / wezterm do when a copy
    /// is already running): the run must follow the window's log, not the terminal program.
    fn fake_terminal(_title: &str, script: &str) -> Option<Vec<String>> {
        Some(vec!["bash".into(), "-c".into(), "bash \"$0\" </dev/null >/dev/null 2>&1 &".into(), script.into()])
    }

    #[test]
    fn in_your_own_terminal_the_panel_mirrors_it_and_knows_each_result() {
        let db: Db = Arc::new(Mutex::new(open_memory()));
        let r = Runner::new(db);
        r.inner.lock().unwrap().run.status = "running".into();
        let failed = r.run_in_window(&[step("echo hello-from-window"), step("exit 4"), step("printf 'ü%s\\n' x")], "fake", "T", fake_terminal);
        let out = r.snapshot(0).state.output;
        assert_eq!(failed, 1, "{out}");
        let st = r.inner.lock().unwrap().run.clone();
        assert_eq!((st.ok_steps, st.failed_steps), (vec![0, 2], vec![1]), "known in your own terminal too");
        assert!(out.contains("hello-from-window"), "{out}");
        assert!(out.contains("▶ [2/3] t"), "the window's own headers come through: {out}");
        assert!(out.contains("✗ exited with code 4"), "{out}");
        assert!(out.contains("üx"), "{out}");
        assert!(!out.contains("6973"), "markers never show: {out}");
        let dir = runtime_dir().unwrap();
        let left: Vec<String> = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert!(!left.iter().any(|f| f.starts_with(&format!("run-{}-", std::process::id()))), "files cleaned up: {left:?}");
    }

    #[test]
    fn a_terminal_that_never_opens_is_reported() {
        let db: Db = Arc::new(Mutex::new(open_memory()));
        let r = Runner::new(db);
        let failed = r.run_in_window(&[step("true")], "nope", "T", |_, _| Some(vec!["/nonexistent/terminal".into()]));
        assert_eq!(failed, 1);
        assert!(r.snapshot(0).state.output.contains("could not open nope"));
    }

    #[test]
    fn markers_and_characters_split_across_reads() {
        let mut st = Stream::default();
        let mut ev = vec![];
        for chunk in [&b"\x1b]69"[..], b"73;S 0\x07hi \xc3", b"\xbc\r", b"\n\x1b[3", b"2mok\x1b[0m\x1b]6973;E 0 ", b"3\x07"] {
            ev.extend(st.feed(chunk));
        }
        let text: String = ev.iter().filter_map(|e| if let Event::Text(t) = e { Some(t.as_str()) } else { None }).collect();
        assert_eq!(text, "hi ü\nok");
        assert_eq!(ev.first(), Some(&Event::Start(0)));
        assert_eq!(ev.last(), Some(&Event::End(0, 3)));
    }

    #[test]
    fn a_second_run_is_refused_while_one_is_live() {
        let db: Db = Arc::new(Mutex::new(open_memory()));
        let r = Runner::new(db);
        r.start(vec![step("sleep 1")], "T".into(), false).unwrap();
        assert_eq!(r.start(vec![step("true")], "U".into(), true).unwrap_err(), "Fluff is already running something: wait for it to finish, or stop it (the terminal panel)");
        r.stop();
        wait_done(&r);
    }

    #[test]
    fn snapshot_offsets_never_split_a_character() {
        let db: Db = Arc::new(Mutex::new(open_memory()));
        let r = Runner::new(db);
        r.start(vec![step("echo x")], "é".into(), true).unwrap();
        let full = r.snapshot(0);
        for i in 0..full.total + 2 {
            let _ = r.snapshot(i); // would panic on a non-boundary slice
        }
    }
}
