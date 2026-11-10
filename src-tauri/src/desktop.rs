// What counts as an "app": something with an entry in the application menu. The index reads
// every visible .desktop file, asks pacman which package owns each one, and records the
// executables they launch. Two readers:
//
//   - the usage tracker, to recognise running apps the hand-written process map never listed
//   - the "Fully unused" list, which only ever offers packages from here, so the kernel,
//     firmware, bootloader, drivers and libraries (none of which has a menu entry) never
//     appear as "apps you never use".

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize, Clone, Debug)]
pub struct DesktopApp {
    pub package: String,
    pub name: String,
    pub source: String, // pacman | aur | other (a menu entry no package owns)
}

#[derive(Default)]
pub struct Index {
    pub apps: Vec<DesktopApp>,
    by_exec: HashMap<String, usize>, // executable basename → apps[i]
}

/// Launchers and interpreters: the app is the script after them, not the program itself.
const WRAPPERS: &[&str] = &[
    "env", "sh", "bash", "dash", "zsh", "python", "python2", "python3", "perl", "ruby", "node",
    "java", "mono", "dotnet", "lua", "luajit", "gjs", "electron", "wine", "flatpak", "snap",
    "kioclient5", "kioclient", "kde-open", "xdg-open", "gtk-launch", "pkexec", "sudo", "nice",
];

pub fn is_wrapper(base: &str) -> bool {
    WRAPPERS.contains(&base)
        || (base.starts_with("python") && base[6..].chars().all(|c| c.is_ascii_digit() || c == '.'))
        || (base.starts_with("electron") && base[8..].chars().all(|c| c.is_ascii_digit()))
}

fn basename(p: &str) -> &str {
    p.rsplit('/').next().unwrap_or(p)
}

/// Splits an Exec= value into words, honouring "double" and 'single' quotes.
fn words(exec: &str) -> Vec<String> {
    let (mut out, mut cur, mut quote, mut any) = (vec![], String::new(), None, false);
    for c in exec.chars() {
        match (quote, c) {
            (None, '"' | '\'') => {
                quote = Some(c);
                any = true;
            }
            (Some(q), _) if c == q => quote = None,
            (None, c) if c.is_whitespace() => {
                if any {
                    out.push(std::mem::take(&mut cur));
                    any = false;
                }
            }
            _ => {
                cur.push(c);
                any = true;
            }
        }
    }
    if any {
        out.push(cur);
    }
    out
}

/// `NAME=value`, as the shell (and `env`) reads an assignment.
fn is_assignment(t: &str) -> bool {
    t.split_once('=').is_some_and(|(k, _)| {
        !k.is_empty() && !k.starts_with(|c: char| c.is_ascii_digit()) && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
    })
}

/// The program an Exec= line really launches: wrappers, NAME=value and flags are skipped.
pub fn exec_target(exec: &str) -> Option<String> {
    for t in words(exec) {
        let t = t.as_str();
        if t.is_empty() || t.starts_with('%') || t.starts_with('-') || is_assignment(t) {
            continue;
        }
        let b = basename(t);
        if b == "flatpak" || b == "snap" {
            return None; // sandboxed: tracked by app id elsewhere
        }
        if is_wrapper(b) {
            continue;
        }
        return Some(b.to_string());
    }
    None
}

struct Entry {
    file: PathBuf,
    name: String,
    exec: Option<String>,
}

/// Only the [Desktop Entry] group; hidden, NoDisplay and non-Application entries are skipped.
fn parse_entry(path: &Path) -> Option<Entry> {
    let text = std::fs::read_to_string(path).ok()?;
    let (mut in_main, mut name, mut exec, mut try_exec) = (false, None, None, None);
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_main = line == "[Desktop Entry]";
            continue;
        }
        if !in_main {
            continue;
        }
        let Some((k, v)) = line.split_once('=') else { continue };
        match k.trim() {
            "Type" if v.trim() != "Application" => return None,
            "NoDisplay" | "Hidden" if v.trim() == "true" => return None,
            "Name" => name = Some(v.trim().to_string()),
            "Exec" => exec = exec_target(v),
            "TryExec" => try_exec = exec_target(v),
            _ => {}
        }
    }
    Some(Entry { file: path.to_path_buf(), name: name?, exec: exec.or(try_exec) })
}

fn owners(files: &[PathBuf]) -> HashMap<PathBuf, String> {
    let mut map = HashMap::new();
    for chunk in files.chunks(200) {
        let Ok(out) = Command::new("pacman").arg("-Qo").args(chunk).env("LC_ALL", "C").output() else { break };
        // "/usr/share/applications/x.desktop is owned by pkg 1.2-1"
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            if let Some((file, rest)) = line.split_once(" is owned by ") {
                if let Some(pkg) = rest.split_whitespace().next() {
                    map.insert(PathBuf::from(file), pkg.to_string());
                }
            }
        }
    }
    map
}

fn foreign() -> HashSet<String> {
    Command::new("pacman")
        .arg("-Qqm")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().map(str::to_string).collect())
        .unwrap_or_default()
}

pub fn build() -> Index {
    let mut dirs = vec![PathBuf::from("/usr/share/applications")];
    if let Ok(home) = std::env::var("HOME") {
        dirs.push(PathBuf::from(home).join(".local/share/applications"));
    }
    let mut entries = vec![];
    for d in &dirs {
        let Ok(rd) = std::fs::read_dir(d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().is_some_and(|x| x == "desktop") {
                if let Some(en) = parse_entry(&p) {
                    entries.push(en);
                }
            }
        }
    }
    entries.sort_by(|a, b| a.file.cmp(&b.file));
    let files: Vec<PathBuf> = entries.iter().map(|e| e.file.clone()).collect();
    let owner = owners(&files);
    let aur = foreign();

    let mut idx = Index::default();
    let mut by_pkg: HashMap<String, usize> = HashMap::new();
    for e in entries {
        let (package, source) = match owner.get(&e.file) {
            Some(p) => (p.clone(), if aur.contains(p) { "aur" } else { "pacman" }),
            None => (e.file.file_stem().unwrap_or_default().to_string_lossy().into_owned(), "other"),
        };
        let i = *by_pkg.entry(package.clone()).or_insert_with(|| {
            idx.apps.push(DesktopApp { package: package.clone(), name: e.name.clone(), source: source.into() });
            idx.apps.len() - 1
        });
        if let Some(x) = e.exec {
            idx.by_exec.entry(x).or_insert(i);
        }
    }
    idx
}

impl Index {
    /// The app a process belongs to: its real executable, else (for scripts and unreadable
    /// processes) its argv[0], else its 15-character comm compared with a truncated name.
    pub fn match_process(&self, exe: Option<&str>, argv0: Option<&str>, comm: &str) -> Option<&DesktopApp> {
        let exe_base = exe.map(basename);
        if let Some(b) = exe_base.filter(|b| !is_wrapper(b)) {
            if let Some(&i) = self.by_exec.get(b) {
                return Some(&self.apps[i]);
            }
        }
        if let Some(b) = argv0.map(basename).filter(|b| !is_wrapper(b)) {
            if let Some(&i) = self.by_exec.get(b) {
                return Some(&self.apps[i]);
            }
        }
        // comm is truncated to 15 bytes, so it is trusted only when the executable could not be
        // read or is an interpreter running a script, never to second-guess a readable binary.
        if exe_base.is_none() || exe_base.is_some_and(is_wrapper) {
            let hit = self
                .by_exec
                .iter()
                .find(|(k, _)| k.as_str() == comm || (k.len() > 15 && k.as_bytes()[..15] == *comm.as_bytes()));
            if let Some((_, &i)) = hit {
                return Some(&self.apps[i]);
            }
        }
        None
    }

    #[cfg(test)]
    pub fn from_pairs(pairs: &[(&str, &str)]) -> Self {
        let mut idx = Index::default();
        for (exec, pkg) in pairs {
            idx.apps.push(DesktopApp { package: pkg.to_string(), name: pkg.to_string(), source: "pacman".into() });
            idx.by_exec.insert(exec.to_string(), idx.apps.len() - 1);
        }
        idx
    }
}

#[tauri::command]
pub async fn desktop_apps(t: tauri::State<'_, std::sync::Arc<crate::usage::Tracker>>) -> Result<Vec<DesktopApp>, String> {
    Ok(t.desktop_apps())
}

/// Re-reads the application menu now (the Refresh button).
#[tauri::command]
pub async fn desktop_refresh(t: tauri::State<'_, std::sync::Arc<crate::usage::Tracker>>) -> Result<usize, String> {
    let t = t.inner().clone();
    tauri::async_runtime::spawn_blocking(move || t.refresh_index()).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exec_lines_resolve_to_the_real_program() {
        assert_eq!(exec_target("/usr/bin/codium --unity-launch %F").as_deref(), Some("codium"));
        assert_eq!(exec_target("env GDK_BACKEND=x11 brave %U").as_deref(), Some("brave"));
        assert_eq!(exec_target("python3 /usr/bin/example-app").as_deref(), Some("example-app"));
        assert_eq!(exec_target("\"/opt/My App/app\" --x").as_deref(), Some("app"));
        assert_eq!(exec_target("env FOO=/x/y GDK_SCALE=2 /usr/bin/krita").as_deref(), Some("krita"));
        assert_eq!(exec_target("/usr/bin/flatpak run --branch=stable org.gimp.GIMP"), None);
    }

    #[test]
    fn a_readable_binary_is_never_matched_by_a_truncated_name() {
        let idx = Index::from_pairs(&[("drkonqi-coredump-gui", "drkonqi"), ("example-app", "example-app-gtk"), ("brave", "brave-bin")]);
        // the crash DAEMON shares the GUI's first 15 characters, but its binary is readable
        assert!(idx.match_process(Some("/usr/lib/drkonqi-coredump-daemon"), None, "drkonqi-coredum").is_none());
        // a python script: exe is the interpreter, so argv[0]/comm decide
        assert_eq!(idx.match_process(Some("/usr/bin/python3.13"), Some("/usr/bin/example-app"), "example-app").unwrap().package, "example-app-gtk");
        // the real binary of a browser
        assert_eq!(idx.match_process(Some("/opt/brave.com/brave/brave"), None, "brave").unwrap().package, "brave-bin");
        // a process we cannot read (another user's): comm is all there is
        assert_eq!(idx.match_process(None, None, "brave").unwrap().package, "brave-bin");
        // interpreters themselves are never an app
        assert!(idx.match_process(Some("/usr/bin/python3"), Some("python3"), "python3").is_none());
    }

    #[test]
    fn this_machine_indexes_its_menu() {
        // smoke test against the real system: an Arch desktop has menu entries owned by packages
        let idx = build();
        if Path::new("/usr/share/applications").exists() && Path::new("/usr/bin/pacman").exists() {
            assert!(idx.apps.iter().any(|a| a.source == "pacman"), "no pacman-owned menu entries found");
            assert!(!idx.apps.iter().any(|a| a.package.starts_with("linux") && a.package.contains("firmware")));
        }
    }
}
