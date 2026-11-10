// App pages: what one app is made of, read from pacman (or flatpak), the folders it keeps in
// your home, and the state of its background services. Read-only; every change an app page
// offers is a command through the run manager.

use crate::probe::exec;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

const T: Duration = Duration::from_secs(10);

fn run(argv: &[&str]) -> Option<crate::probe::ExecResult> {
    exec(&argv.iter().map(|s| s.to_string()).collect::<Vec<_>>(), T)
}

/// pacman's own name rule; never starting with "-" (it would be read as an option).
pub fn valid_pkg(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && !name.starts_with(['-', '.'])
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b"@._+-".contains(&b))
}

/// Flatpak ids: reverse-DNS, at least three parts.
pub fn valid_flatpak(id: &str) -> bool {
    id.len() <= 255
        && id.split('.').count() >= 3
        && id.split('.').all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'))
        && !id.starts_with('-')
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomePath {
    path: String,
    place: String, // settings | data | cache | state | autostart | sandbox
    backups: Vec<String>, // earlier copies TuxCopilot set aside (<path>.bak-<when>), oldest first
}

/// `<path>.bak-*` next to it, oldest first (the stamp sorts by time).
fn backups_of(p: &Path) -> Vec<String> {
    let (Some(dir), Some(name)) = (p.parent(), p.file_name().and_then(|n| n.to_str())) else { return vec![] };
    let prefix = format!("{name}.bak-");
    let mut b: Vec<String> = std::fs::read_dir(dir)
        .map(|rd| rd.filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().starts_with(&prefix)).map(|e| e.path().to_string_lossy().into_owned()).collect())
        .unwrap_or_default();
    b.sort();
    b
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Unit {
    name: String,
    user: bool, // a per-user unit (systemctl --user)
    enabled: String, // enabled / disabled / static / … ("" when it can't be told)
    active: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PkgDetails {
    name: String, // the installed package (another than asked, when asked by what it provides)
    foreign: bool, // not from a repository: the AUR (or built by hand)
    info: String, // `pacman -Qii` as printed
    files: Vec<String>,
    home: Vec<HomePath>,
    units: Vec<Unit>,
    pacnew: Vec<String>, // its config files with a newer default waiting next to them
    processes: Vec<Proc>, // running right now
    off_record: Option<String>, // turned off by TuxCopilot: what to turn back on
}

/// ~/.local/state/tuxcopilot/off/<pkg>: written by the off switch, read back by on.
pub fn off_record(pkg: &str) -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    std::fs::read_to_string(Path::new(&home).join(".local/state/tuxcopilot/off").join(pkg)).ok()
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Proc {
    pid: i32,
    name: String,
    uid: u32,
    parent: i32,
    mine: bool, // yours: you may end it without a password
}

/// Running processes of a package: their program file is one of its files; for other users'
/// processes (whose program file can't be read) the program name is compared instead.
pub fn processes_of(files: &[String]) -> Vec<Proc> {
    let owned: std::collections::HashSet<&str> = files.iter().map(String::as_str).collect();
    let progs: std::collections::HashSet<String> = files
        .iter()
        .filter_map(|f| f.strip_prefix("/usr/bin/"))
        .filter(|b| !b.is_empty() && !b.contains('/'))
        .map(String::from)
        .collect();
    let Ok(rd) = std::fs::read_dir("/proc") else { return vec![] };
    let mut out = vec![];
    for pid in rd.filter_map(|e| e.ok()).filter_map(|e| e.file_name().to_str()?.parse::<i32>().ok()) {
        let base = PathBuf::from(format!("/proc/{pid}"));
        let Ok(status) = std::fs::read_to_string(base.join("status")) else { continue };
        let field = |k: &str| status.lines().find_map(|l| l.strip_prefix(k)).map(str::trim).unwrap_or("").to_string();
        let comm = field("Name:");
        let uid = field("Uid:").split_whitespace().next().and_then(|u| u.parse().ok()).unwrap_or(u32::MAX);
        let parent = field("PPid:").parse().unwrap_or(0);
        let hit = match std::fs::read_link(base.join("exe")) {
            Ok(exe) => owned.contains(exe.to_string_lossy().trim_end_matches(" (deleted)")),
            Err(_) => {
                // not ours to read: the name it runs under (comm is cut at 15 characters)
                let argv0 = std::fs::read(base.join("cmdline")).ok().and_then(|c| {
                    c.split(|b| *b == 0).next().map(|a| String::from_utf8_lossy(a).rsplit('/').next().unwrap_or("").to_string())
                });
                progs.iter().any(|p| argv0.as_deref() == Some(p.as_str()) || (p.len() >= 15 && p[..15] == comm) || *p == comm)
            }
        };
        if hit {
            // SAFETY: getuid(2) cannot fail.
            out.push(Proc { pid, name: comm, uid, parent, mine: uid == unsafe { libc::getuid() } });
        }
    }
    out.sort_by_key(|p| p.pid);
    out
}

/// The paths in -Qii's "Backup Files" section.
pub fn backup_files(qii: &str) -> Vec<String> {
    let mut on = false;
    let mut out = vec![];
    for line in qii.lines() {
        if line.starts_with("Backup Files") {
            on = true;
        } else if !line.starts_with(' ') {
            on = false;
        }
        if on {
            let v = line.split_once(" : ").map(|(_, v)| v).unwrap_or(line).trim();
            if let Some(path) = v.split_whitespace().next().filter(|p| p.starts_with('/')) {
                out.push(path.to_string());
            }
        }
    }
    out
}

/// Names an app's own folders are usually called by: the package, without -bin/-git/…,
/// and each program it installs in /usr/bin. Compared without case.
pub fn candidates(pkg: &str, files: &[String]) -> Vec<String> {
    let mut c = vec![pkg.to_lowercase()];
    let mut base = pkg.to_lowercase();
    for suffix in ["-bin", "-git", "-appimage", "-nightly", "-beta", "-desktop", "-stable"] {
        if let Some(b) = base.strip_suffix(suffix) {
            base = b.to_string();
        }
    }
    c.push(base);
    for f in files {
        if let Some(b) = f.strip_prefix("/usr/bin/") {
            if !b.is_empty() && !b.contains('/') {
                c.push(b.to_lowercase());
            }
        }
    }
    c.sort();
    c.dedup();
    c.retain(|n| n.len() >= 3); // "qt", "kf" would match half the folder
    c
}

/// The entries of the usual home folders whose name is one of the candidates.
pub fn home_matches(home: &Path, names: &[String]) -> Vec<HomePath> {
    let places = [(".config", "settings"), (".local/share", "data"), (".cache", "cache"), (".local/state", "state")];
    let mut out = vec![];
    for (dir, place) in places {
        let Ok(rd) = std::fs::read_dir(home.join(dir)) else { continue };
        let mut found: Vec<_> = rd
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| {
                let l = n.to_lowercase();
                names.iter().any(|c| l == *c || l == format!("{c}rc") || l == format!("{c}.conf"))
            }))
            .collect();
        found.sort();
        out.extend(found.into_iter().map(|p| HomePath { backups: backups_of(&p), path: p.to_string_lossy().into_owned(), place: place.into() }));
    }
    let auto = home.join(".config/autostart");
    if let Ok(rd) = std::fs::read_dir(&auto) {
        for e in rd.filter_map(|e| e.ok()) {
            let n = e.file_name().to_string_lossy().to_lowercase();
            let stem = n.trim_end_matches(".desktop");
            if names.iter().any(|c| stem == *c || stem.ends_with(&format!(".{c}"))) {
                out.push(HomePath { path: e.path().to_string_lossy().into_owned(), place: "autostart".into(), backups: vec![] });
            }
        }
    }
    out
}

/// Its systemd units, from the files it installs; template units (name@.service) have no
/// state of their own.
pub fn units_in(files: &[String]) -> Vec<(String, bool)> {
    let mut u = vec![];
    for f in files {
        for (dir, user) in [("/usr/lib/systemd/system/", false), ("/usr/lib/systemd/user/", true)] {
            if let Some(n) = f.strip_prefix(dir) {
                let unit = !n.contains('/') && [".service", ".timer", ".socket", ".path"].iter().any(|s| n.ends_with(s));
                if unit && !n.contains("@.") {
                    u.push((n.to_string(), user));
                }
            }
        }
    }
    u
}

fn unit_state(name: &str, user: bool) -> Unit {
    let q = |what: &str| {
        let mut argv = vec!["systemctl"];
        if user {
            argv.push("--user");
        }
        argv.extend([what, name]);
        run(&argv).map(|r| r.stdout_trim()).unwrap_or_default()
    };
    Unit { name: name.into(), user, enabled: q("is-enabled"), active: q("is-active") }
}

fn home() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(PathBuf::from)
}

/// A system service with the units that start it on demand (its socket, its path): switching
/// only the service off leaves those to start it again — `systemctl disable cups.service`
/// says "its triggering units are still active". Triggers first, the service last.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitFamily {
    units: Vec<Unit>,
    package: Option<String>, // the package it comes from (its page has the same switches)
    off_record: Option<String>,
}

pub fn port_record_path(unit: &str) -> Option<PathBuf> {
    home().map(|h| h.join(".local/state/tuxcopilot/off").join(format!("port-{unit}")))
}

#[tauri::command]
pub async fn unit_family(name: String) -> Result<UnitFamily, String> {
    if !valid_unit(&name) {
        return Err(format!("not a unit name: {name}"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let triggers: Vec<String> = run(&["systemctl", "show", "-p", "TriggeredBy", "--value", &name])
            .map(|r| r.stdout_trim().split_whitespace().filter(|t| valid_unit(t)).map(String::from).collect())
            .unwrap_or_default();
        let mut units: Vec<Unit> = triggers.iter().map(|t| unit_state(t, false)).collect();
        units.push(unit_state(&name, false));
        let package = run(&["pacman", "-Qqo", &format!("/usr/lib/systemd/system/{name}")]).filter(|r| r.ok()).map(|r| r.stdout_trim());
        let off_record = port_record_path(&name).and_then(|p| std::fs::read_to_string(p).ok());
        Ok(UnitFamily { units, package, off_record })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Ports TuxCopilot switched off: (unit, its record). They no longer listen, so this is how
/// the Ports list still shows them, to switch back on.
#[tauri::command]
pub fn port_records() -> Vec<(String, String)> {
    let Some(dir) = home().map(|h| h.join(".local/state/tuxcopilot/off")) else { return vec![] };
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    let mut out: Vec<(String, String)> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let unit = name.strip_prefix("port-")?.to_string();
            valid_unit(&unit).then(|| (unit, std::fs::read_to_string(e.path()).unwrap_or_default()))
        })
        .collect();
    out.sort();
    out
}

#[tauri::command]
pub async fn pkg_details(pkg: String) -> Result<PkgDetails, String> {
    if !valid_pkg(&pkg) {
        return Err(format!("not a package name: {pkg}"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut pkg = pkg;
        let mut info = run(&["pacman", "-Qii", &pkg]).filter(|r| r.ok());
        if info.is_none() {
            // a name another package provides ("sh" is bash): open that package
            let provider = crate::system::read_db()
                .into_iter()
                .find(|(_, p)| p.provides.iter().any(|x| x.split('=').next() == Some(pkg.as_str())))
                .map(|(n, _)| n);
            if let Some(real) = provider {
                info = run(&["pacman", "-Qii", &real]).filter(|r| r.ok());
                pkg = real;
            }
        }
        let info = info.ok_or(format!("{pkg} is not installed"))?;
        let foreign = run(&["pacman", "-Qqm", &pkg]).is_some_and(|r| r.ok());
        let files: Vec<String> = run(&["pacman", "-Qlq", &pkg]).map(|r| r.lines()).unwrap_or_default();
        let names = candidates(&pkg, &files);
        let home = home().map(|h| home_matches(&h, &names)).unwrap_or_default();
        let units = units_in(&files).into_iter().map(|(n, u)| unit_state(&n, u)).collect();
        let text = info.stdout_text();
        let pacnew = backup_files(&text).into_iter().filter(|p| Path::new(&format!("{p}.pacnew")).exists()).collect();
        let processes = processes_of(&files);
        let off = off_record(&pkg);
        Ok(PkgDetails { name: pkg, foreign, info: text, files, home, units, pacnew, processes, off_record: off })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A unit's own name rule (no paths, no options).
pub fn valid_unit(name: &str) -> bool {
    name.len() <= 128
        && [".service", ".timer", ".socket", ".path"].iter().any(|s| name.ends_with(s))
        && !name.starts_with('-')
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b"@._-:".contains(&b))
}

/// Its last 80 log lines.
#[tauri::command]
pub async fn unit_log(name: String, user: bool) -> Result<String, String> {
    if !valid_unit(&name) {
        return Err(format!("not a unit name: {name}"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut argv = vec!["journalctl"];
        if user {
            argv.push("--user");
        }
        argv.extend(["-u", &name, "-n", "80", "--no-pager", "-o", "short-iso"]);
        run(&argv).map(|r| r.joined()).ok_or_else(|| "journalctl did not answer".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlatpakDetails {
    info: String,
    permissions: String,
    overrides: String, // what you changed (flatpak override --user)
    data: Option<String>, // ~/.var/app/<id>
}

#[tauri::command]
pub async fn flatpak_details(id: String) -> Result<FlatpakDetails, String> {
    if !valid_flatpak(&id) {
        return Err(format!("not a flatpak id: {id}"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let info = run(&["flatpak", "info", &id]).filter(|r| r.ok()).ok_or(format!("{id} is not installed"))?;
        let permissions = run(&["flatpak", "info", "--show-permissions", &id]).map(|r| r.stdout_text()).unwrap_or_default();
        let overrides = run(&["flatpak", "override", "--user", "--show", &id]).map(|r| r.stdout_text()).unwrap_or_default();
        let data = home().map(|h| h.join(".var/app").join(&id)).filter(|p| p.is_dir()).map(|p| p.to_string_lossy().into_owned());
        Ok(FlatpakDetails { info: info.stdout_text(), permissions, overrides, data })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_files_and_units_are_read() {
        let qii = "Install Reason  : Explicitly installed\nBackup Files    : /etc/pacman.conf [modified]\n                  /etc/makepkg.conf [unmodified]\nExtended Data   : pkgtype=pkg\n";
        assert_eq!(backup_files(qii), vec!["/etc/pacman.conf", "/etc/makepkg.conf"]);
        assert!(backup_files("Backup Files    : None\n").is_empty());
        assert!(valid_unit("plasma-dolphin.service") && valid_unit("getty@tty1.service"));
        for bad in ["x", "-x.service", "../x.service", "a b.service", "x.service;id"] {
            assert!(!valid_unit(bad), "{bad}");
        }
    }

    /// What a page finds on this machine (run by hand: cargo test live_pages -- --ignored --nocapture).
    #[test]
    #[ignore]
    fn live_pages() {
        for pkg in ["dolphin", "vscodium-bin", "docker", "containerd", "tor"] {
            let files: Vec<String> = run(&["pacman", "-Qlq", pkg]).map(|r| r.lines()).unwrap_or_default();
            let home = home_matches(&home().unwrap(), &candidates(pkg, &files));
            let units: Vec<_> = units_in(&files).into_iter().map(|(n, u)| { let s = unit_state(&n, u); format!("{} {} {}", s.name, s.enabled, s.active) }).collect();
            println!("{pkg}: {} files, home {:?}, units {:?}", files.len(), home.iter().map(|h| (&h.path, &h.place)).collect::<Vec<_>>(), units);
            let procs = processes_of(&files);
            println!("  {} processes: {:?}", procs.len(), procs.iter().take(4).map(|p| (p.pid, &p.name, p.uid, p.parent)).collect::<Vec<_>>());
        }
    }

    #[test]
    fn finds_its_own_running_process() {
        // this test binary is a process whose program file is a file we can name
        let me = std::env::current_exe().unwrap().to_string_lossy().into_owned();
        let found = processes_of(&[me]);
        assert!(found.iter().any(|p| p.pid == std::process::id() as i32), "{found:?}");
        assert!(processes_of(&["/usr/bin/surely-not-running-xyz".into()]).is_empty());
    }

    #[test]
    fn names_are_checked() {
        for ok in ["vlc", "vscodium-bin", "lib32-glibc", "gtk+", "python3.12", "kf6-ki18n", "foo@bar"] {
            assert!(valid_pkg(ok), "{ok}");
        }
        for bad in ["", "-Rns", ".", "..", "a b", "a;b", "a/b", "$(id)"] {
            assert!(!valid_pkg(bad), "{bad}");
        }
        assert!(valid_flatpak("org.gimp.GIMP"));
        for bad in ["gimp", "org..x", "-org.a.b", "org.a.b;rm", "org.a/b.c"] {
            assert!(!valid_flatpak(bad), "{bad}");
        }
    }

    #[test]
    fn finds_its_folders_and_units() {
        let files: Vec<String> = ["/usr/bin/", "/usr/bin/codium", "/usr/lib/systemd/user/plasma-x.service", "/usr/lib/systemd/system/x@.service", "/usr/lib/systemd/system/x.timer"]
            .map(String::from)
            .to_vec();
        assert_eq!(candidates("vscodium-bin", &files), vec!["codium", "vscodium", "vscodium-bin"]);
        assert_eq!(units_in(&files), vec![("plasma-x.service".to_string(), true), ("x.timer".to_string(), false)]);

        let home = std::env::temp_dir().join(format!("am-home-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        for d in [".config/VSCodium", ".config/vscodium-other", ".cache/vscodium", ".config/autostart"] {
            std::fs::create_dir_all(home.join(d)).unwrap();
        }
        std::fs::write(home.join(".config/codiumrc"), "").unwrap();
        std::fs::write(home.join(".config/autostart/codium.desktop"), "").unwrap();
        let got: Vec<_> = home_matches(&home, &candidates("vscodium-bin", &files))
            .into_iter()
            .map(|h| (h.path.trim_start_matches(home.to_str().unwrap()).to_string(), h.place))
            .collect();
        assert_eq!(
            got,
            vec![
                ("/.config/VSCodium".into(), "settings".into()),
                ("/.config/codiumrc".into(), "settings".into()),
                ("/.cache/vscodium".into(), "cache".into()),
                ("/.config/autostart/codium.desktop".into(), "autostart".into()),
            ]
        );
        std::fs::remove_dir_all(&home).unwrap();
    }
}
