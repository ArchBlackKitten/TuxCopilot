// The screen lock: does the computer lock by itself, after
// how long, after sleep, how soon a password is needed, what closing the lid does, and does the
// login screen log in by itself. KDE's own settings (kscreenlockerrc, powerdevilrc) and the login
// screen's (greetd's initial_session, SDDM's [Autologin]), read without a password. A key KDE never
// wrote means KDE's default.

use serde::Serialize;
use std::path::Path;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScreenLock {
    pub autolock: bool,          // locks by itself when idle (KDE: true)
    pub timeout_min: u32,        // after so many minutes (KDE: 5)
    pub lock_on_resume: bool,    // locks when waking from sleep (KDE: true)
    pub grace_s: u32,            // seconds after locking that no password is needed (KDE: 5)
    pub laptop: bool,
    pub lid: Vec<(String, u32)>, // per power profile: PowerDevil's lid action (KDE: 1, sleep)
    pub autologin: Option<String>, // where the login screen logs in by itself, if it does
}

/// A KDE ini file's value: `[group]` lines and `key=value`, the last one counting.
pub fn ini_value(text: &str, group: &str, key: &str) -> Option<String> {
    let mut in_group = false;
    let mut out = None;
    for l in text.lines().map(str::trim) {
        if l.starts_with('[') {
            in_group = l == format!("[{group}]");
        } else if in_group {
            if let Some(v) = l.strip_prefix(&format!("{key}=")) {
                out = Some(v.trim().to_string());
            }
        }
    }
    out
}

/// powerdevilrc's lid actions: each `[<profile>][SuspendAndShutdown]` group's LidAction.
pub fn lid_actions(text: &str) -> Vec<(String, u32)> {
    let mut group = String::new();
    let mut out = vec![];
    for l in text.lines().map(str::trim) {
        if l.starts_with('[') {
            group = l.to_string();
        } else if let Some(v) = l.strip_prefix("LidAction=") {
            let profile = group.trim_start_matches('[').split(']').next().unwrap_or("").to_string();
            if let Ok(n) = v.trim().parse() {
                out.retain(|(p, _): &(String, u32)| *p != profile);
                out.push((profile, n));
            }
        }
    }
    out
}

/// greetd (a `[initial_session]` table) or SDDM (`[Autologin]` with a User=).
pub fn autologin_in(name: &str, text: &str) -> bool {
    if name.ends_with(".toml") {
        return text.lines().any(|l| l.trim() == "[initial_session]");
    }
    ini_value(text, "Autologin", "User").is_some_and(|u| !u.is_empty())
}

#[tauri::command]
pub async fn screen_lock() -> ScreenLock {
    tauri::async_runtime::spawn_blocking(|| {
        let home = std::env::var("HOME").unwrap_or_default();
        let read = |p: &str| std::fs::read_to_string(p).unwrap_or_default();
        let kl = read(&format!("{home}/.config/kscreenlockerrc"));
        let get = |k: &str| ini_value(&kl, "Daemon", k);
        let mut configs: Vec<String> = vec!["/etc/sddm.conf".into()];
        for d in ["/etc/sddm.conf.d", "/etc/greetd"] {
            if let Ok(rd) = std::fs::read_dir(d) {
                configs.extend(rd.flatten().map(|e| e.path().to_string_lossy().into_owned()));
            }
        }
        ScreenLock {
            autolock: get("Autolock").map_or(true, |v| v == "true"),
            timeout_min: get("Timeout").and_then(|v| v.parse().ok()).unwrap_or(5),
            lock_on_resume: get("LockOnResume").map_or(true, |v| v == "true"),
            grace_s: get("LockGrace").and_then(|v| v.parse().ok()).unwrap_or(5),
            laptop: Path::new("/proc/acpi/button/lid").exists(),
            lid: lid_actions(&read(&format!("{home}/.config/powerdevilrc"))),
            autologin: configs.into_iter().find(|p| autologin_in(p, &read(p))),
        }
    })
    .await
    .unwrap_or(ScreenLock { autolock: true, timeout_min: 5, lock_on_resume: true, grace_s: 5, laptop: false, lid: vec![], autologin: None })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kdes_settings_and_the_login_screens_are_read() {
        let kl = "[Daemon]\nLockGrace=0\nTimeout=10\n[Greeter]\nTimeout=99\n";
        assert_eq!(ini_value(kl, "Daemon", "Timeout"), Some("10".into()));
        assert_eq!(ini_value(kl, "Daemon", "Autolock"), None, "not written: KDE's default");
        let pd = "[AC][SuspendAndShutdown]\nLidAction=32\n[Battery][SuspendAndShutdown]\nLidAction=1\n[LowBattery][SuspendAndShutdown]\nLidAction=1\n";
        assert_eq!(lid_actions(pd), vec![("AC".into(), 32), ("Battery".into(), 1), ("LowBattery".into(), 1)]);
        assert!(autologin_in("/etc/greetd/x.toml", "[default_session]\ncommand = \"g\"\n[initial_session]\ncommand = \"startplasma\"\nuser = \"me\"\n"));
        assert!(!autologin_in("/etc/greetd/cosmic-greeter.toml", "[default_session]\ncommand = \"cosmic-greeter-start\"\n"));
        assert!(autologin_in("/etc/sddm.conf.d/a.conf", "[Autologin]\nUser=me\nSession=plasma\n"));
        assert!(!autologin_in("/etc/sddm.conf", "[Autologin]\nRelogin=false\nUser=\n"));
    }

    /// This computer: `cargo test this_computer_screenlock -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn this_computer_screenlock() {
        println!("{:?}", tauri::async_runtime::block_on(screen_lock()));
    }
}
