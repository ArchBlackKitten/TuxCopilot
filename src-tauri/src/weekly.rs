// Fluff's weekly checkup, only with your permission. Off until you switch it on: then a timer of yours (systemd --user, no password)
// runs `tuxcopilot --weekly-checkup` once a week, even with TuxCopilot closed. It opens no window
// and no database (the lock is never touched); it only reads — failed services, settings files
// waiting after updates, a pacman lock left behind, a disk filling up — and sends a desktop
// notification only when something needs you. Troubleshoot says what each one means.

use std::path::{Path, PathBuf};

pub const UNIT: &str = "tuxcopilot-checkup";

/// Failed services Fluff knows are harmless (known-failures.ts, `harmless: true`): not worth a
/// notification. A test keeps the two lists the same.
pub const HARMLESS: &[&str] = &[
    "drkonqi-coredump-pickup.service",
    "drkonqi-sentry-postman.service",
    "systemd-networkd-wait-online.service",
    "NetworkManager-wait-online.service",
    "reflector.service",
    "man-db.service",
    "pkgfile-update.service",
    "xdg-desktop-portal-hyprland.service",
    "xdg-desktop-portal-wlr.service",
    "xdg-desktop-portal-gnome.service",
    "xdg-desktop-portal-cosmic.service",
    "xdg-desktop-portal-xapp.service",
    "xdg-desktop-portal-lxqt.service",
];

/// What the notification says; None when all is calm (no notification).
pub fn summary(failed: &[String], waiting: usize, lock_left: bool, disk: Option<(u64, u64)>, wrong_passwords: usize) -> Option<String> {
    let mut out = vec![];
    if wrong_passwords > 0 {
        out.push(format!("{wrong_passwords} wrong password{} this week (sudo, the lock screen, SSH…)", if wrong_passwords == 1 { "" } else { "s" }));
    }
    let failed: Vec<&String> = failed.iter().filter(|f| !HARMLESS.contains(&f.as_str())).collect();
    match failed.len() {
        0 => {}
        1 => out.push(format!("A service failed: {}", failed[0])),
        n => out.push(format!("{n} services failed: {}", failed.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", "))),
    }
    if lock_left {
        out.push("pacman's lock was left behind, so installs and updates can't run".into());
    }
    if let Some((free, total)) = disk {
        // the checkup's own rule (checkup.ts): under 10 %, or under 5 GB
        if total > 0 && (free * 10 < total || free < 5_000_000_000) {
            out.push(format!("The system disk is nearly full: {:.1} GB free", free as f64 / 1e9));
        }
    }
    if waiting > 0 {
        out.push(format!("{waiting} settings file{} waiting after updates", if waiting == 1 { "" } else { "s" }));
    }
    (!out.is_empty()).then(|| format!("{}.\nOpen TuxCopilot → Troubleshoot: each one says what it means.", out.join(".\n")))
}

/// A level that slipped (marks.rs) is said first: the Security section says what moved.
pub fn with_slips(summary: Option<String>, slips: &[String]) -> Option<String> {
    if slips.is_empty() {
        return summary;
    }
    let first = format!("{}.\nOpen TuxCopilot → Security: it says what moved, and puts it back with one button.", slips.join(".\n"));
    Some(match summary {
        Some(s) => format!("{first}\n{s}"),
        None => first,
    })
}

/// `tuxcopilot --weekly-checkup`, from the timer.
pub fn run_weekly_checkup() {
    let mut failed: Vec<String> = [false, true].into_iter().flat_map(crate::services::list).filter(|s| s.state == "failed").map(|s| s.name).collect();
    failed.sort();
    let lock_left = Path::new("/var/lib/pacman/db.lck").exists() && !crate::checkup::pacman_running();
    let wrong = tauri::async_runtime::block_on(crate::logins::login_failures(7)).failures.len();
    let slips = crate::marks::marks_file().map(|p| crate::marks::slipped(&crate::marks::load(&p), crate::marks::facts)).unwrap_or_default();
    let Some(text) = with_slips(summary(&failed, crate::checkup::waiting_files().len(), lock_left, crate::checkup::disk(), wrong), &slips) else {
        println!("Fluff's weekly checkup: all is calm.");
        return;
    };
    println!("Fluff's weekly checkup:\n{text}");
    let argv: Vec<String> = ["notify-send", "--app-name=TuxCopilot", "--icon=tuxcopilot", "Fluff's weekly checkup", &text].map(String::from).to_vec();
    if crate::probe::exec(&argv, std::time::Duration::from_secs(10)).is_none_or(|r| !r.ok()) {
        eprintln!("Fluff couldn't show the notification (notify-send, from libnotify).");
    }
}

fn unit_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| Path::new(&h).join(".config/systemd/user"))
}

#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyState {
    pub on: bool,                 // the timer is switched on
    pub files: bool,              // its two files are there
    pub exe: Option<String>,      // this TuxCopilot, for the timer to run
    pub last: Option<String>,     // when it last ran
}

#[tauri::command]
pub async fn weekly_state() -> WeeklyState {
    tauri::async_runtime::spawn_blocking(|| {
        let sc = |args: &[&str]| {
            let mut argv: Vec<String> = vec!["systemctl".into(), "--user".into()];
            argv.extend(args.iter().map(|s| s.to_string()));
            crate::probe::exec(&argv, std::time::Duration::from_secs(5)).map(|r| r.stdout_trim())
        };
        let timer = format!("{UNIT}.timer");
        let files = unit_dir().is_some_and(|d| d.join(&timer).exists() && d.join(format!("{UNIT}.service")).exists());
        WeeklyState {
            on: sc(&["is-enabled", &timer]).as_deref() == Some("enabled"),
            files,
            exe: std::env::current_exe().ok().map(|p| p.to_string_lossy().into_owned()),
            last: sc(&["show", "-p", "LastTriggerUSec", "--value", &timer]).filter(|t| !t.is_empty() && t != "n/a"),
        }
    })
    .await
    .unwrap_or(WeeklyState { on: false, files: false, exe: None, last: None })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_speaks_only_when_something_needs_you() {
        assert_eq!(summary(&[], 0, false, Some((100_000_000_000, 500_000_000_000)), 0), None);
        assert_eq!(summary(&["drkonqi-coredump-pickup.service".into()], 0, false, None, 0), None, "harmless: no notification");
        assert_eq!(
            summary(&["tor.service".into()], 11, false, None, 0).unwrap(),
            "A service failed: tor.service.\n11 settings files waiting after updates.\nOpen TuxCopilot → Troubleshoot: each one says what it means."
        );
        let s = summary(&["a.service".into(), "b.service".into(), "man-db.service".into()], 1, true, Some((3_000_000_000, 500_000_000_000)), 0).unwrap();
        assert!(s.starts_with("2 services failed: a.service, b.service.\npacman's lock was left behind"), "{s}");
        assert!(s.contains("The system disk is nearly full: 3.0 GB free.\n1 settings file waiting after updates."), "{s}");
        assert!(summary(&[], 0, false, Some((40_000_000_000, 500_000_000_000)), 0).is_some(), "under 10 %");
        assert!(summary(&[], 0, false, Some((60_000_000_000, 500_000_000_000)), 0).is_none());
    }

    #[test]
    fn wrong_passwords_this_week_are_said_first() {
        let s = summary(&[], 0, false, None, 3).unwrap();
        assert_eq!(with_slips(None, &[]), None, "calm: no notification");
        assert_eq!(with_slips(Some("x".into()), &[]), Some("x".into()));
        let slip = vec!["Security → Devices changed since you chose Good security".to_string()];
        assert_eq!(with_slips(None, &slip).unwrap(), "Security → Devices changed since you chose Good security.\nOpen TuxCopilot → Security: it says what moved, and puts it back with one button.");
        assert!(with_slips(Some("A service failed: a.service.\nOpen TuxCopilot → Troubleshoot".into()), &slip).unwrap().ends_with("puts it back with one button.\nA service failed: a.service.\nOpen TuxCopilot → Troubleshoot"));
        assert!(s.starts_with("3 wrong passwords this week (sudo, the lock screen, SSH…)."), "{s}");
        assert!(summary(&[], 0, false, None, 1).unwrap().starts_with("1 wrong password this week"));
        assert_eq!(summary(&[], 0, false, None, 0), None);
    }

    /// This computer, without a notification: `cargo test this_computer_weekly -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn this_computer_weekly() {
        let mut failed: Vec<String> = [false, true].into_iter().flat_map(crate::services::list).filter(|s| s.state == "failed").map(|s| s.name).collect();
        failed.sort();
        println!("{:?}", summary(&failed, crate::checkup::waiting_files().len(), false, crate::checkup::disk(), 0));
        println!("{:?}", tauri::async_runtime::block_on(weekly_state()));
    }
}
