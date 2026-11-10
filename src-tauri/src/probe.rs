// Read-only probes for the TypeScript libs (system-specs, apps-detect, ollama, arch-sync).
// The webview may ask for exactly these argv lines and these paths, nothing else: the
// lists below ARE the surface. A new probe is added here, on purpose, or it does not run.

use serde::Serialize;
use std::io::Read;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

pub const ALLOWED_EXEC: &[&[&str]] = &[
    // machine analysis (system-specs.ts)
    &["nproc"],
    &["getconf", "_NPROCESSORS_ONLN"],
    &["lspci"],
    &["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
    &["df", "-B1", "/"],
    &["uname", "-r"],
    // installed apps (apps-detect.ts)
    &["pacman", "-Qe", "--color=never"],
    &["pacman", "-Qem", "--color=never"],
    &["flatpak", "list", "--app", "--columns=application", "--user"],
    &["flatpak", "list", "--app", "--columns=application", "--system"],
    &["flatpak", "--version"],
    &["flatpak", "list", "--app", "--columns=application,size"],
    &["flatpak", "list", "--runtime", "--columns=size"],
    &["snap", "--version"],
    &["snap", "list"],
    // Docker section and troubleshooting (docker.ts, troubleshoot.ts)
    &["docker", "--version"],
    &["docker", "compose", "version"],
    &["docker", "info", "--format", "{{json .ServerVersion}}"],
    &["docker", "ps", "-a", "--format", "{{json .}}"],
    &["docker", "compose", "ls", "-a", "--format", "json"],
    &["docker", "system", "df", "--format", "{{json .}}"],
    &["systemctl", "is-active", "docker.service"],
    &["systemctl", "is-enabled", "docker.service"],
    &["systemctl", "is-active", "ollama.service"],
    &["systemctl", "is-enabled", "ollama.service"],
    &["journalctl", "-u", "docker.service", "-n", "200", "--no-pager", "-o", "short-iso"],
    &["journalctl", "-u", "ollama.service", "-n", "200", "--no-pager", "-o", "short-iso"],
    &["id", "-nG"],
    // Ports (ports.ts)
    &["ss", "-Htulnpe"],
    // Tor section (tor.ts)
    &["tor", "--version"],
    &["systemctl", "is-active", "tor.service"],
    &["systemctl", "is-active", "tuxcopilot-shadow.service"],
    &["systemctl", "is-enabled", "tor.service"],
    &["journalctl", "-u", "tor.service", "-n", "300", "--no-pager", "-o", "short-iso"],
    // Your torrc (torrc.ts): the options this Tor accepts, and its manual, unwrapped
    &["tor", "--list-torrc-options"],
    &["env", "MANWIDTH=4000", "man", "-P", "cat", "tor"],
    // Ollama state (ollama.ts)
    &["ollama", "--version"],
    &["ollama", "list"],
    &["ollama", "ps"],
    // Arch Commands self-update (arch-sync.ts)
    &["pacman", "--help"],
    &["yay", "--help"],
    &["git", "help", "-a"],
    &["systemctl", "--help"],
    &["journalctl", "--help"],
    &["pacman", "-Qq"],
];

const ALLOWED_READ: &[&str] = &[
    "/proc/cpuinfo",
    "/proc/meminfo",
    "/proc/swaps",
    "/etc/os-release",
    "/etc/passwd",
    "/etc/tor/torrc",
    "/etc/tor/torrc.d/tuxcopilot.conf",
];

const MAX_CAPTURE: usize = 8 * 1024 * 1024;

pub fn exec_allowed(argv: &[String]) -> bool {
    ALLOWED_EXEC
        .iter()
        .any(|a| a.len() == argv.len() && a.iter().zip(argv).all(|(x, y)| *x == y))
}

/// `/sys/class/drm/card<N>/device/{vendor,mem_info_vram_total}`
pub fn read_allowed(path: &str) -> bool {
    if ALLOWED_READ.contains(&path) {
        return true;
    }
    let Some(rest) = path.strip_prefix("/sys/class/drm/card") else { return false };
    let Some((num, file)) = rest.split_once("/device/") else { return false };
    !num.is_empty()
        && num.bytes().all(|b| b.is_ascii_digit())
        && (file == "vendor" || file == "mem_info_vram_total")
}

#[derive(Serialize)]
pub struct ExecResult {
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

impl ExecResult {
    pub fn ok(&self) -> bool {
        self.code == Some(0)
    }
    pub fn code(&self) -> Option<i32> {
        self.code
    }
    pub fn stdout_text(&self) -> String {
        self.stdout.clone()
    }
    pub fn stderr_text(&self) -> String {
        self.stderr.clone()
    }
    pub fn stdout_trim(&self) -> String {
        self.stdout.trim().to_string()
    }
    pub fn lines(&self) -> Vec<String> {
        self.stdout.lines().map(str::trim).filter(|l| !l.is_empty()).map(String::from).collect()
    }
    /// What it printed, both streams (stdout first).
    pub fn joined(&self) -> String {
        let mut s = self.stdout.clone();
        if !self.stderr.is_empty() {
            if !s.is_empty() && !s.ends_with('\n') {
                s.push('\n');
            }
            s.push_str(&self.stderr);
        }
        s
    }
}

fn drain(mut r: impl Read + Send + 'static) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut buf = vec![];
        let _ = r.by_ref().take(MAX_CAPTURE as u64).read_to_end(&mut buf);
        buf
    })
}

/// None when the program is missing or ran past its timeout (it is killed).
pub fn exec(argv: &[String], timeout: Duration) -> Option<ExecResult> {
    let mut child = Command::new(&argv[0])
        .args(&argv[1..])
        .env("LC_ALL", "C") // stable, parseable output
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let out = drain(child.stdout.take()?);
    let errs = drain(child.stderr.take()?);
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st,
            Ok(None) if started.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(_) => return None,
        }
    };
    Some(ExecResult {
        code: status.code(),
        stdout: String::from_utf8_lossy(&out.join().ok()?).into_owned(),
        stderr: String::from_utf8_lossy(&errs.join().ok()?).into_owned(),
    })
}

#[tauri::command]
pub async fn probe_exec(argv: Vec<String>, timeout_ms: Option<u64>) -> Result<Option<ExecResult>, String> {
    if !exec_allowed(&argv) {
        return Err(format!("not an allowed probe: {}", argv.join(" ")));
    }
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(6000).min(60_000));
    tauri::async_runtime::spawn_blocking(move || exec(&argv, timeout))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn probe_read(path: String) -> Result<Option<String>, String> {
    if !read_allowed(&path) {
        return Err(format!("not an allowed path: {path}"));
    }
    Ok(std::fs::read_to_string(&path).ok())
}

#[tauri::command]
pub async fn probe_readdir(path: String) -> Result<Vec<String>, String> {
    // /etc/tor: your torrc's backups (torrc.bak-<when>) and a waiting torrc.pacnew
    if path != "/sys/class/drm" && path != "/etc/tor" {
        return Err(format!("not an allowed directory: {path}"));
    }
    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    Ok(entries.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn only_the_listed_argv_lines_pass() {
        assert!(exec_allowed(&v(&["pacman", "-Qe", "--color=never"])));
        assert!(!exec_allowed(&v(&["pacman", "-Qe"])), "a prefix is not the line");
        assert!(!exec_allowed(&v(&["pacman", "-Qe", "--color=never", "; rm -rf ~"])));
        assert!(!exec_allowed(&v(&["sh", "-c", "nproc"])));
        assert!(!exec_allowed(&[]));
    }

    #[test]
    fn only_the_listed_paths_pass() {
        assert!(read_allowed("/proc/meminfo"));
        assert!(read_allowed("/sys/class/drm/card0/device/vendor"));
        assert!(read_allowed("/sys/class/drm/card12/device/mem_info_vram_total"));
        assert!(!read_allowed("/sys/class/drm/card0/device/../../../../etc/shadow"));
        assert!(!read_allowed("/sys/class/drm/cardX/device/vendor"));
        assert!(!read_allowed("/sys/class/drm/card/device/vendor"));
        assert!(!read_allowed("/etc/shadow"));
    }

    #[test]
    fn the_torrc_probes_read_tors_manual_and_nothing_else() {
        assert!(exec_allowed(&v(&["env", "MANWIDTH=4000", "man", "-P", "cat", "tor"])));
        assert!(!exec_allowed(&v(&["env", "MANWIDTH=4000", "man", "-P", "cat", "sudo"])), "only Tor's manual");
        assert!(!exec_allowed(&v(&["env", "MANWIDTH=4000", "man", "-P", "sh", "tor"])), "man's pager runs a program");
        assert!(exec_allowed(&v(&["tor", "--list-torrc-options"])));
    }

    #[test]
    fn a_missing_program_is_none_and_a_slow_one_is_killed() {
        assert!(exec(&v(&["definitely-not-a-program-xyz"]), Duration::from_secs(1)).is_none());
        let t = Instant::now();
        assert!(exec(&v(&["sleep", "5"]), Duration::from_millis(200)).is_none());
        assert!(t.elapsed() < Duration::from_secs(2));
        let r = exec(&v(&["uname", "-r"]), Duration::from_secs(5)).unwrap();
        assert_eq!(r.code, Some(0));
        assert!(!r.stdout.trim().is_empty());
    }
}
