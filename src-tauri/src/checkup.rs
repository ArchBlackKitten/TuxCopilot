// Fluff's checkup (Troubleshoot): what the whole system says about itself, read only — the
// config files a package update left waiting (.pacnew / .pacsave, and the package each belongs
// to), a pacman lock nobody holds, the errors since this boot, how long the boot
// took, and how full the system disk is. The failed services come from services.rs.

use crate::probe::exec;
use serde::Serialize;
use std::path::Path;
use std::time::Duration;

const PACMAN_LOCK: &str = "/var/lib/pacman/db.lck";

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Waiting {
    pub path: String,         // /etc/pacman.conf.pacnew
    pub file: String,         // /etc/pacman.conf
    pub kind: String,         // "pacnew" | "pacsave"
    pub owner: Option<String>, // the package the file belongs to
    pub file_exists: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkup {
    pub waiting: Vec<Waiting>,
    pub lock_left: bool, // the lock is there and no pacman is running
    pub pacman_running: bool,
    pub boot: Option<String>,  // systemd-analyze's line: "Startup finished in …"
    pub errors: Vec<String>,   // the journal's errors since this boot (short-iso lines)
    pub disk: Option<(u64, u64)>, // the system disk: (free, total) bytes
}

/// `/etc/a.pacnew` → (`/etc/a`, "pacnew"). Only files under /etc, by their plain names.
pub fn waiting_kind(path: &str) -> Option<(String, &'static str)> {
    if !path.starts_with("/etc/") || path.contains("/../") || path.contains('\n') {
        return None;
    }
    for kind in ["pacnew", "pacsave"] {
        if let Some(base) = path.strip_suffix(&format!(".{kind}")) {
            return (base.len() > 5).then(|| (base.to_string(), kind));
        }
    }
    None
}

pub(crate) fn pacman_running() -> bool {
    std::fs::read_dir("/proc")
        .map(|d| d.flatten().any(|e| std::fs::read_to_string(e.path().join("comm")).is_ok_and(|c| c.trim() == "pacman")))
        .unwrap_or(false)
}

pub(crate) fn disk() -> Option<(u64, u64)> {
    let mut s: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: a valid C string and a zeroed struct statvfs(3) fills in.
    if unsafe { libc::statvfs(c"/".as_ptr(), &mut s) } != 0 {
        return None;
    }
    let f = s.f_frsize as u64;
    Some((s.f_bavail as u64 * f, s.f_blocks as u64 * f))
}

fn run(argv: &[&str], secs: u64) -> Option<crate::probe::ExecResult> {
    exec(&argv.iter().map(|s| s.to_string()).collect::<Vec<_>>(), Duration::from_secs(secs))
}

pub(crate) fn waiting_files() -> Vec<Waiting> {
    let listed = run(&["pacdiff", "-o"], 60).map(|r| r.lines()).unwrap_or_default();
    let mut out: Vec<Waiting> = listed
        .iter()
        .filter_map(|p| {
            let (file, kind) = waiting_kind(p)?;
            Some(Waiting { path: p.clone(), file_exists: Path::new(&file).exists(), file, kind: kind.into(), owner: None })
        })
        .collect();
    for w in &mut out {
        // (whether you edited it can't be read: a .pacnew exists only because the file in use
        // differs from what the package shipped, so pacman always calls it [modified])
        w.owner = run(&["pacman", "-Qqo", &w.file], 10).filter(|r| r.ok()).map(|r| r.stdout_trim()).filter(|o| !o.is_empty() && !o.contains(char::is_whitespace));
    }
    out
}

#[tauri::command]
pub async fn checkup() -> Result<Checkup, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let running = pacman_running();
        Checkup {
            waiting: waiting_files(),
            lock_left: Path::new(PACMAN_LOCK).exists() && !running,
            pacman_running: running,
            boot: run(&["systemd-analyze"], 10).filter(|r| r.ok()).and_then(|r| r.lines().into_iter().next()),
            errors: run(&["journalctl", "-b", "-p", "err", "--no-pager", "-o", "short-iso", "-n", "300"], 15)
                .map(|r| r.stdout_text().lines().filter(|l| !l.starts_with(' ') && !l.starts_with("-- ")).map(String::from).collect())
                .unwrap_or_default(),
            disk: disk(),
        }
    })
    .await
    .map_err(|e| e.to_string())
}

/// Files whose contents are secrets (passwords, keys, Wi-Fi): Fluff never shows them.
pub fn secret(path: &str) -> bool {
    let p = path.to_lowercase();
    ["shadow", "gshadow", "sudoers", "crypttab", "system-connections", "wpa_supplicant", "/etc/ssh/", "/ssl/private", "/private/", "secret", "passwd-", "credentials"]
        .iter()
        .any(|s| p.contains(s))
        || [".key", ".pem", ".p12"].iter().any(|e| p.ends_with(e) || p.ends_with(&format!("{e}.pacnew")) || p.ends_with(&format!("{e}.pacsave")))
}

/// What differs between the file in use and the one waiting (`diff -u`), for a file the
/// checkup listed. Refused for secret files and for anything not waiting.
#[tauri::command]
pub async fn waiting_diff(path: String) -> Result<String, String> {
    let (file, _) = waiting_kind(&path).ok_or("not a .pacnew or .pacsave file in /etc")?;
    if secret(&path) {
        return Err("This one can hold secrets (passwords or keys), so Fluff doesn't show it. Compare it yourself: sudo diff -u <file> <file>.pacnew".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let listed = run(&["pacdiff", "-o"], 60).map(|r| r.lines()).unwrap_or_default();
        if !listed.contains(&path) {
            return Err(format!("{path} is not waiting (pacdiff doesn't list it)"));
        }
        let r = run(&["diff", "-u", "--", &file, &path], 10).ok_or("diff did not answer")?;
        match r.code() {
            Some(0) => Ok("They are the same: the waiting one can go (Keep mine).".into()),
            Some(1) => Ok(r.stdout_text()),
            _ => Err(r.joined().trim().to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Merge: your changes and the new version together ──────────
// The same way pacdiff merges (a three-way `diff3 -m`), without vim: the base is the file as the
// older package shipped it, from pacman's cache. Fluff only previews here; the command that writes
// builds the merge again as root from root-owned files, and writes only if it is byte-for-byte
// what you saw (its sha256) — never a copy from your own folders, which any program of yours could
// change in between.

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Merge {
    pub owner: String,
    pub installed: String,            // the package version installed now
    pub base_package: Option<String>, // the cached package the base comes from (None: none older in the cache)
    pub base_version: Option<String>,
    pub conflicts: usize,             // places where both you and the package changed the same lines
    pub preview: String,              // diff -u: yours → merged
    pub sha256: String,               // of the merged text
}

/// `{pkg}-{ver}-{rel}-{arch}.pkg.tar.*` → "ver-rel" (an epoch "1:" is part of ver). Another
/// package whose name begins the same ("foo-bar" for "foo") is not taken.
pub fn cached_version(file_name: &str, pkg: &str) -> Option<String> {
    if file_name.ends_with(".sig") {
        return None;
    }
    let rest = file_name.strip_prefix(pkg)?.strip_prefix('-')?;
    let rest = &rest[..rest.find(".pkg.tar")?];
    let (verrel, _arch) = rest.rsplit_once('-')?;
    (verrel.matches('-').count() == 1 && verrel.starts_with(|c: char| c.is_ascii_digit())).then(|| verrel.to_string())
}

/// The newest cached version older than the one installed. `cmp` is pacman's vercmp.
pub fn pick_base(cached: &[(String, String)], installed: &str, cmp: impl Fn(&str, &str) -> i32) -> Option<(String, String)> {
    cached
        .iter()
        .filter(|(_, v)| cmp(v, installed) < 0)
        .max_by(|a, b| cmp(&a.1, &b.1).cmp(&0))
        .cloned()
}

fn vercmp(a: &str, b: &str) -> i32 {
    run(&["vercmp", a, b], 5).and_then(|r| r.stdout_trim().parse().ok()).unwrap_or(0)
}

/// diff3 -m of yours, the base and the new one, in a folder only you can read.
pub fn merge3(mine: &str, base: &str, new: &str) -> Result<(String, usize, String, String), String> {
    use std::os::unix::fs::DirBuilderExt;
    let dir = std::env::temp_dir().join(format!("tuxcopilot-merge-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)));
    std::fs::DirBuilder::new().mode(0o700).create(&dir).map_err(|e| e.to_string())?;
    let out = (|| {
        let path = |n: &str| dir.join(n).to_string_lossy().into_owned();
        for (n, t) in [("yours", mine), ("base", base), ("new", new)] {
            std::fs::write(path(n), t).map_err(|e| e.to_string())?;
        }
        let r = run(&["diff3", "-m", &path("yours"), &path("base"), &path("new")], 20).ok_or("diff3 is missing (the diffutils package) or didn't answer")?;
        if !matches!(r.code(), Some(0) | Some(1)) {
            return Err(r.joined().trim().to_string());
        }
        let merged = r.stdout_text();
        std::fs::write(path("merged"), &merged).map_err(|e| e.to_string())?;
        let conflicts = merged.lines().filter(|l| l.starts_with("<<<<<<<")).count();
        let sha = run(&["sha256sum", "--", &path("merged")], 10).and_then(|r| r.stdout_trim().split_whitespace().next().map(String::from)).ok_or("sha256sum didn't answer")?;
        let d = run(&["diff", "-u", "--label", "yours", "--label", "merged", &path("yours"), &path("merged")], 10).ok_or("diff didn't answer")?;
        Ok((merged, conflicts, sha, d.stdout_text()))
    })();
    let _ = std::fs::remove_dir_all(&dir);
    out
}

/// Preview a merge of a waiting .pacnew with yours. Refused for secret files and anything not waiting.
#[tauri::command]
pub async fn waiting_merge(path: String) -> Result<Merge, String> {
    let (file, kind) = waiting_kind(&path).ok_or("not a .pacnew or .pacsave file in /etc")?;
    if kind != "pacnew" {
        return Err("only a .pacnew is a new version to merge".into());
    }
    if secret(&path) {
        return Err("This one can hold secrets (passwords or keys), so Fluff doesn't read it. Merge it yourself: sudo pacdiff".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        if !run(&["pacdiff", "-o"], 60).map(|r| r.lines()).unwrap_or_default().contains(&path) {
            return Err(format!("{path} is not waiting (pacdiff doesn't list it)"));
        }
        let owner = run(&["pacman", "-Qoq", "--", &file], 10).filter(|r| r.ok()).map(|r| r.stdout_trim()).ok_or("no package owns this file")?;
        let installed = run(&["pacman", "-Q", "--", &owner], 10).and_then(|r| r.stdout_trim().split_whitespace().nth(1).map(String::from)).ok_or("the package isn't installed")?;
        let mut cached = vec![];
        for dir in run(&["pacman-conf", "CacheDir"], 10).map(|r| r.lines()).unwrap_or_default() {
            for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
                let name = e.file_name().to_string_lossy().into_owned();
                if let Some(v) = cached_version(&name, &owner) {
                    cached.push((e.path().to_string_lossy().into_owned(), v));
                }
            }
        }
        let read = |p: &str| std::fs::read_to_string(p).map_err(|e| format!("Fluff can't read {p} as you: {e}"));
        let (mine, new) = (read(&file)?, read(&path)?);
        let Some((pkg_file, version)) = pick_base(&cached, &installed, vercmp) else {
            return Ok(Merge { owner, installed, base_package: None, base_version: None, conflicts: 0, preview: String::new(), sha256: String::new() });
        };
        let rel = file.trim_start_matches('/');
        let base = run(&["bsdtar", "-xqOf", &pkg_file, rel], 30).filter(|r| r.ok()).map(|r| r.stdout_text()).ok_or(format!("{rel} isn't in {pkg_file}"))?;
        let (_merged, conflicts, sha256, preview) = merge3(&mine, &base, &new)?;
        Ok(Merge { owner, installed, base_package: Some(pkg_file), base_version: Some(version), conflicts, preview, sha256 })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn waiting_files_are_named_plainly() {
        assert_eq!(waiting_kind("/etc/pacman.conf.pacnew"), Some(("/etc/pacman.conf".into(), "pacnew")));
        assert_eq!(waiting_kind("/etc/pacman.d/mirrorlist.pacsave"), Some(("/etc/pacman.d/mirrorlist".into(), "pacsave")));
        for bad in ["/home/me/x.pacnew", "/etc/../root/x.pacnew", "/etc/x.conf", "/etc/.pacnew", "/etc/a\nb.pacnew"] {
            assert_eq!(waiting_kind(bad), None, "{bad}");
        }
    }

    #[test]
    fn secrets_are_never_shown() {
        for s in ["/etc/shadow.pacnew", "/etc/gshadow.pacsave", "/etc/sudoers.pacnew", "/etc/NetworkManager/system-connections/home.nmconnection.pacnew", "/etc/ssh/sshd_config.pacnew", "/etc/x/server.key.pacnew"] {
            assert!(secret(s), "{s}");
        }
        for ok in ["/etc/pacman.conf.pacnew", "/etc/locale.gen.pacnew", "/etc/pacman.d/mirrorlist.pacnew"] {
            assert!(!secret(ok), "{ok}");
        }
        let r = tauri::async_runtime::block_on(waiting_diff("/etc/shadow.pacnew".into()));
        assert!(r.unwrap_err().contains("secrets"));
        assert!(tauri::async_runtime::block_on(waiting_diff("/etc/hostname".into())).is_err());
    }

    #[test]
    fn the_merge_base_is_the_newest_older_package_of_the_same_name() {
        assert_eq!(cached_version("pacman-7.1.0-4-x86_64.pkg.tar.zst", "pacman"), Some("7.1.0-4".into()));
        assert_eq!(cached_version("glibc-2.44+r50+g1848099f063e-2-x86_64_v3.pkg.tar.zst", "glibc"), Some("2.44+r50+g1848099f063e-2".into()));
        assert_eq!(cached_version("foo-1:2.0-1-any.pkg.tar.xz", "foo"), Some("1:2.0-1".into()));
        assert_eq!(cached_version("pacman-7.1.0-4-x86_64.pkg.tar.zst.sig", "pacman"), None);
        assert_eq!(cached_version("pacman-mirrorlist-20260610-1-any.pkg.tar.zst", "pacman"), None, "another package");
        assert_eq!(cached_version("foo-2fa-1.0-1-any.pkg.tar.zst", "foo"), None, "another package, starting with a digit");
        assert_eq!(cached_version("pacman-7.1.0-4-x86_64.tar.gz", "pacman"), None);
        let cmp = |a: &str, b: &str| {
            let n = |v: &str| v.split(['.', '-']).map(|x| x.parse::<u32>().unwrap_or(0)).collect::<Vec<_>>();
            n(a).cmp(&n(b)) as i32
        };
        let c = |v: &[&str]| v.iter().map(|x| (format!("/c/p-{x}"), x.to_string())).collect::<Vec<_>>();
        assert_eq!(pick_base(&c(&["1.0-1", "1.2-1", "1.3-1"]), "1.3-1", cmp).map(|b| b.1), Some("1.2-1".into()), "the installed one is not a base");
        assert_eq!(pick_base(&c(&["1.2-1", "1.0-1"]), "1.3-1", cmp).map(|b| b.1), Some("1.2-1".into()));
        assert_eq!(pick_base(&c(&["1.3-1", "1.4-1"]), "1.3-1", cmp), None, "nothing older");
        assert_eq!(pick_base(&[], "1.3-1", cmp), None);
    }

    #[test]
    fn a_merge_keeps_your_changes_and_takes_the_new_ones() {
        let base = "a=1\nb=2\nc=3\n";
        let mine = "a=1\nb=MINE\nc=3\n";
        let new = "a=1\nb=2\nc=3\nd=NEW\n";
        let (merged, conflicts, sha, preview) = merge3(mine, base, new).unwrap();
        assert_eq!(merged, "a=1\nb=MINE\nc=3\nd=NEW\n");
        assert_eq!(conflicts, 0);
        assert_eq!(sha.len(), 64);
        assert!(preview.contains("+d=NEW") && !preview.contains("-b=MINE"), "{preview}");
        let (merged, conflicts, _, _) = merge3("a=MINE\n", "a=1\n", "a=NEW\n").unwrap();
        assert_eq!(conflicts, 1, "{merged}");
        let (_, _, sha2, _) = merge3(mine, base, new).unwrap();
        assert_eq!(sha, sha2, "the same files, the same merge");
        assert!(!std::fs::read_dir(std::env::temp_dir()).unwrap().flatten().any(|e| e.file_name().to_string_lossy().starts_with(&format!("tuxcopilot-merge-{}-", std::process::id()))), "its folder is gone");
    }

    #[test]
    fn a_merge_is_refused_for_secrets_and_for_what_is_not_waiting() {
        let r = tauri::async_runtime::block_on(waiting_merge("/etc/sudoers.pacnew".into()));
        assert!(r.unwrap_err().contains("secrets"));
        assert!(tauri::async_runtime::block_on(waiting_merge("/etc/pacman.conf.pacsave".into())).unwrap_err().contains("only a .pacnew"));
        assert!(tauri::async_runtime::block_on(waiting_merge("/etc/hostname".into())).is_err());
    }

    /// The real computer's merges (outcomes only, no contents): `cargo test this_computer_merges -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn this_computer_merges() {
        for w in waiting_files().into_iter().filter(|w| w.kind == "pacnew") {
            match tauri::async_runtime::block_on(waiting_merge(w.path.clone())) {
                Ok(m) => println!("{}: {} {} base {:?}, conflicts {}", w.path, m.owner, m.installed, m.base_version, m.conflicts),
                Err(e) => println!("{}: refused: {}", w.path, e.lines().next().unwrap_or("")),
            }
        }
    }

    /// The real computer (counts only): `cargo test this_computer_checkup -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn this_computer_checkup() {
        let c = tauri::async_runtime::block_on(checkup()).unwrap();
        let owned = c.waiting.iter().filter(|w| w.owner.is_some()).count();
        println!("waiting {} ({owned} with their package); lock left {}; errors {}; boot {:?}; disk {:?}", c.waiting.len(), c.lock_left, c.errors.len(), c.boot, c.disk.map(|(f, t)| f * 100 / t.max(1)));
    }
}
