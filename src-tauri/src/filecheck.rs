// "Did anyone change my system files?" Two kinds of fingerprints, both read as you, without a password:
//   1. the packages' own: `pacman -Qkk` compares every installed file with the SHA-256 its package
//      recorded (its mtree). Settings files are meant to change; a program file is not.
//   2. Fluff's own, for what no package tracks — where something planted would hide: files in /etc
//      and /usr/local no package owns, and the files that run when you log in (shell startup files,
//      autostart, your systemd units, KDE's login scripts, ~/.local/bin, ~/.ssh's authorized_keys).
//      The screen keeps the recorded ones in the sealed database and compares.
// Never a secret file (checkup.rs `secret`), never a private key: only names and SHA-256s leave here.

use serde::Serialize;
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub package: String,
    pub path: String,
    pub reasons: Vec<String>, // pacman's words: "SHA256 checksum mismatch", "Permissions mismatch", …
    pub settings: bool,       // a settings file (pacman's "backup file"): meant to be changed
}

#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PackageCheck {
    pub changed: Vec<FileChange>,
    pub unreadable: usize, // files only root may read: not checked as you
    pub packages: usize,
}

const UNREADABLE: &[&str] = &["Permission denied", "failed to calculate SHA256 checksum"];

/// `pacman -Qkk`, by file: its warnings (stderr) and its settings-file lines ("backup file:", which
/// it prints on stdout, beside the per-package summaries, which are counted). A modification time
/// alone is left out (a file touched, not changed).
pub fn parse_qkk(stderr: &str, stdout: &str) -> PackageCheck {
    let mut by: BTreeMap<String, FileChange> = BTreeMap::new();
    let mut unreadable = HashSet::new();
    for line in stderr.lines().chain(stdout.lines()) {
        let (settings, rest) = if let Some(r) = line.strip_prefix("backup file: ") {
            (true, r)
        } else if let Some(r) = line.strip_prefix("warning: ") {
            (false, r)
        } else {
            continue;
        };
        let Some((package, rest)) = rest.split_once(": ") else { continue };
        let Some(open) = rest.rfind(" (") else { continue };
        let (path, reason) = (&rest[..open], rest[open + 2..].trim_end_matches(')'));
        if !path.starts_with('/') {
            continue;
        }
        if UNREADABLE.contains(&reason) {
            unreadable.insert(path.to_string());
            continue;
        }
        let e = by.entry(path.to_string()).or_insert_with(|| FileChange { package: package.into(), path: path.into(), reasons: vec![], settings });
        e.settings |= settings;
        if !e.reasons.iter().any(|r| r == reason) {
            e.reasons.push(reason.to_string());
        }
    }
    let changed = by.into_values().filter(|c| c.reasons.iter().any(|r| r != "Modification time mismatch")).collect();
    PackageCheck { changed, unreadable: unreadable.len(), packages: stdout.lines().filter(|l| l.contains(" total files, ")).count() }
}

#[tauri::command]
pub async fn package_files_check() -> Result<PackageCheck, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let r = crate::probe::exec(&["pacman".into(), "-Qkk".into()], Duration::from_secs(900)).ok_or("pacman didn't finish")?;
        Ok(parse_qkk(&r.stderr_text(), &r.stdout_text()))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Fluff's own fingerprints ─────────────────────────────────────────────

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Fingerprint {
    pub path: String,
    pub sha256: String,
}

const MAX_FILE: u64 = 64 * 1024 * 1024;
const MAX_FILES: usize = 5000;

/// The files that run when you log in, or that let someone in: as paths under your home.
pub const LOGIN_FILES: &[&str] = &[".bashrc", ".bash_profile", ".bash_login", ".profile", ".zshrc", ".zprofile", ".zshenv", ".zlogin", ".xprofile", ".xinitrc", ".ssh/authorized_keys", ".ssh/rc"];
pub const LOGIN_DIRS: &[&str] = &[".config/autostart", ".config/systemd/user", ".config/environment.d", ".config/plasma-workspace/env", ".config/plasma-workspace/shutdown", ".config/autostart-scripts", ".local/bin"];

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let Ok(t) = e.file_type() else { continue };
        if t.is_dir() {
            walk(&e.path(), out);
        } else if t.is_file() {
            out.push(e.path());
        }
        if out.len() > MAX_FILES * 4 {
            return;
        }
    }
}

/// The paths Fluff fingerprints: untracked system files (not owned by any package, not secret)
/// and your login files.
pub fn fingerprint_paths(owned: &HashSet<String>, home: &Path) -> Vec<PathBuf> {
    let mut sys = vec![];
    for d in ["/etc", "/usr/local"] {
        walk(Path::new(d), &mut sys);
    }
    let mut out: Vec<PathBuf> = sys
        .into_iter()
        .filter(|p| {
            let s = p.to_string_lossy();
            !owned.contains(s.as_ref()) && !crate::checkup::secret(&s) && !s.contains('\n')
        })
        .collect();
    for f in LOGIN_FILES {
        let p = home.join(f);
        if p.is_file() {
            out.push(p);
        }
    }
    for d in LOGIN_DIRS {
        walk(&home.join(d), &mut out);
    }
    out.retain(|p| std::fs::metadata(p).is_ok_and(|m| m.len() <= MAX_FILE) && std::fs::File::open(p).is_ok());
    out.sort();
    out.dedup();
    out.truncate(MAX_FILES);
    out
}

/// `sha256sum` output → fingerprints ("<64 hex>  <path>"; an escaped name starts with "\" and is left out).
pub fn parse_sums(text: &str) -> Vec<Fingerprint> {
    text.lines()
        .filter_map(|l| {
            let (sum, path) = l.split_once("  ")?;
            (sum.len() == 64 && sum.bytes().all(|b| b.is_ascii_hexdigit()) && path.starts_with('/')).then(|| Fingerprint { path: path.into(), sha256: sum.into() })
        })
        .collect()
}

#[tauri::command]
pub async fn untracked_fingerprints() -> Result<Vec<Fingerprint>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let owned: HashSet<String> = crate::probe::exec(&["pacman".into(), "-Qlq".into()], Duration::from_secs(60))
            .ok_or("pacman didn't answer")?
            .stdout_text()
            .lines()
            .map(String::from)
            .collect();
        let home = PathBuf::from(std::env::var("HOME").unwrap_or_default());
        let paths = fingerprint_paths(&owned, &home);
        let mut out = vec![];
        for chunk in paths.chunks(200) {
            let mut argv = vec!["sha256sum".to_string(), "--".to_string()];
            argv.extend(chunk.iter().map(|p| p.to_string_lossy().into_owned()));
            if let Some(r) = crate::probe::exec(&argv, Duration::from_secs(120)) {
                out.extend(parse_sums(&r.stdout_text()));
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pacmans_warnings_are_read_by_file() {
        let err = concat!(
            "warning: libvlc: /usr/lib/vlc/plugins/plugins.dat (Size mismatch)\n",
            "warning: libvlc: /usr/lib/vlc/plugins/plugins.dat (SHA256 checksum mismatch)\n",
            "warning: x: /usr/bin/touched (Modification time mismatch)\n",
            "warning: cups: /etc/cups/printers.conf (Permissions mismatch)\n",
            "warning: bind: /var/named/localhost.zone (Permission denied)\n",
            "warning: libvirt: /etc/libvirt/nwfilter/a.xml (failed to calculate SHA256 checksum)\n",
            "warning: weird: path with no reason\n",
        );
        // pacman prints the settings-file lines on stdout, among the summaries
        let out = "a52dec: 22 total files, 0 altered files\nbackup file: pacman: /etc/pacman.conf (Modification time mismatch)\nbackup file: pacman: /etc/pacman.conf (SHA256 checksum mismatch)\nlibvlc: 900 total files, 1 altered file\n";
        let c = parse_qkk(err, out);
        assert_eq!(c.packages, 2);
        assert_eq!(c.unreadable, 2);
        let paths: Vec<&str> = c.changed.iter().map(|x| x.path.as_str()).collect();
        assert_eq!(paths, ["/etc/cups/printers.conf", "/etc/pacman.conf", "/usr/lib/vlc/plugins/plugins.dat"], "a time alone is no change");
        let vlc = c.changed.iter().find(|x| x.package == "libvlc").unwrap();
        assert_eq!(vlc.reasons, ["Size mismatch", "SHA256 checksum mismatch"]);
        assert!(!vlc.settings);
        assert!(c.changed.iter().find(|x| x.path == "/etc/pacman.conf").unwrap().settings);
    }

    #[test]
    fn sums_are_read_and_odd_names_left_out() {
        let a = "a".repeat(64);
        let f = parse_sums(&format!("{a}  /etc/x\n\\{a}  /etc/odd\\nname\nnot a sum\n{}  /etc/short\n", "b".repeat(10)));
        assert_eq!(f, vec![Fingerprint { path: "/etc/x".into(), sha256: a }]);
    }

    #[test]
    fn untracked_and_login_files_are_chosen_never_secrets() {
        let home = std::env::temp_dir().join(format!("tux-fp-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        for f in [".bashrc", ".config/autostart/x.desktop", ".local/bin/tool", ".ssh/authorized_keys", ".ssh/id_ed25519", "notes.txt"] {
            let p = home.join(f);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(&p, "x").unwrap();
        }
        let owned: HashSet<String> = ["/etc/hostname".to_string()].into();
        let paths: Vec<String> = fingerprint_paths(&owned, &home).iter().map(|p| p.to_string_lossy().into_owned()).collect();
        let h = home.to_string_lossy();
        for want in [".bashrc", ".config/autostart/x.desktop", ".local/bin/tool", ".ssh/authorized_keys"] {
            assert!(paths.contains(&format!("{h}/{want}")), "{want}");
        }
        assert!(!paths.iter().any(|p| p.ends_with("id_ed25519")), "a private key is never read");
        assert!(!paths.iter().any(|p| p.ends_with("notes.txt")), "only the login files of your home");
        assert!(!paths.contains(&"/etc/hostname".to_string()), "owned by a package: pacman checks it");
        assert!(!paths.iter().any(|p| p.contains("shadow") || p.contains("sudoers")), "never a secret file");
        let _ = std::fs::remove_dir_all(&home);
    }

    /// This computer (counts only): `cargo test this_computer_files -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn this_computer_files() {
        let c = tauri::async_runtime::block_on(package_files_check()).unwrap();
        println!("packages {} unreadable {} changed {} (settings {})", c.packages, c.unreadable, c.changed.len(), c.changed.iter().filter(|x| x.settings).count());
        for x in c.changed.iter().filter(|x| !x.settings) {
            println!("  {} {} {:?}", x.package, x.path, x.reasons);
        }
        let f = tauri::async_runtime::block_on(untracked_fingerprints()).unwrap();
        println!("fingerprints {}", f.len());
    }
}
