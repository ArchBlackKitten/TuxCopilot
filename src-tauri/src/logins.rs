// Failed password attempts: sudo, su, the login and lock
// screens, polkit's password windows, SSH — read from the system journal (your account may read it
// through the wheel group), as far back as the journal keeps (on CachyOS 50 MB: a few days), and
// said with how far back that is. Only when, where, which account and from where; never more.

use serde::Serialize;
use std::time::Duration;

pub const PATTERN: &str = "authentication failure|incorrect password attempt|Failed password|Invalid user|FAILED LOGIN";

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub when: String,  // short-iso
    pub place: String, // sudo, su, lock screen, login screen, password window, ssh, console, other
    pub user: String,  // the account it was for ("" unknown)
    pub from: String,  // a network address, for ssh ("" none)
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Failures {
    pub failures: Vec<Failure>,
    pub since: Option<String>, // the journal's oldest entry: nothing older can be seen
    pub kept: bool,            // TuxCopilot's file that keeps a month of the journal is there (logins.ts JOURNAL_KEEP)
}

pub const JOURNAL_KEEP: &str = "/etc/systemd/journald.conf.d/tuxcopilot-keep.conf";

fn after<'a>(l: &'a str, key: &str) -> Option<&'a str> {
    let i = l.find(key)? + key.len();
    l[i..].split(|c: char| c.is_whitespace() || c == ',' || c == ';').next().filter(|v| !v.is_empty())
}

/// One journal line (short-iso) → a failure; a sudo summary line ("3 incorrect password attempts")
/// counts as its attempts' place, not as more attempts.
pub fn parse_failure(line: &str) -> Option<Failure> {
    let mut w = line.splitn(3, ' ');
    let when = w.next()?.to_string();
    let _host = w.next()?;
    let rest = w.next()?;
    if rest.contains("incorrect password attempt") {
        return None; // pam_unix's own lines count each attempt; this one only sums them
    }
    let service = rest.find("pam_unix(").and_then(|i| rest[i + 9..].split(':').next()).unwrap_or("");
    let prog = rest.split(|c| c == '[' || c == ':').next().unwrap_or("");
    let place = match (service, prog) {
        ("sudo", _) | (_, "sudo") => "sudo",
        ("su", _) | ("su-l", _) | (_, "su") => "su",
        ("kde", _) | ("kde-fingerprint", _) | (_, "kscreenlocker_greet") => "lock screen",
        ("sddm", _) | ("plasmalogin", _) | ("gdm-password", _) | ("lightdm", _) => "login screen",
        ("polkit-1", _) => "password window",
        (_, "sshd") | (_, "sshd-session") => "ssh",
        ("login", _) | (_, "login") => "console",
        _ => "other",
    };
    let user = after(rest, " user=").or_else(|| after(rest, "Failed password for invalid user ")).or_else(|| after(rest, "Failed password for ")).or_else(|| after(rest, "Invalid user ")).unwrap_or("");
    let from = after(rest, "rhost=").or_else(|| after(rest, " from ")).unwrap_or("");
    Some(Failure { when, place: place.into(), user: user.into(), from: from.into() })
}

/// `journalctl --list-boots`: the first entry of the oldest boot.
pub fn oldest_entry(list_boots: &str) -> Option<String> {
    let line = list_boots.lines().find(|l| l.trim_start().starts_with('-') || l.trim_start().starts_with('0'))?;
    let cols: Vec<&str> = line.split_whitespace().collect();
    // IDX BOOT-ID  Day YYYY-MM-DD HH:MM:SS TZ  Day YYYY-MM-DD …
    let i = cols.iter().position(|c| c.len() == 10 && c.as_bytes().get(4) == Some(&b'-'))?;
    Some(format!("{} {}", cols[i], cols.get(i + 1)?))
}

#[tauri::command]
pub async fn login_failures(days: u32) -> Failures {
    tauri::async_runtime::spawn_blocking(move || {
        let since = format!("-{}d", days.clamp(1, 365));
        let argv: Vec<String> = ["journalctl", "--since", &since, "-q", "--no-pager", "-o", "short-iso", "-g", PATTERN].map(String::from).to_vec();
        let failures = crate::probe::exec(&argv, Duration::from_secs(60)).map(|r| r.stdout_text().lines().filter_map(parse_failure).collect()).unwrap_or_default();
        let boots: Vec<String> = ["journalctl", "--list-boots", "--no-pager"].map(String::from).to_vec();
        let since = crate::probe::exec(&boots, Duration::from_secs(20)).and_then(|r| oldest_entry(&r.stdout_text()));
        Failures { failures, since, kept: std::path::Path::new(JOURNAL_KEEP).exists() }
    })
    .await
    .unwrap_or(Failures { failures: vec![], since: None, kept: false })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_failure_is_said_by_where_whom_and_from_where() {
        let f = |l: &str| parse_failure(l).unwrap();
        let s = f("2026-11-03T21:04:00+0000 host sudo[123]: pam_unix(sudo:auth): authentication failure; logname=penguin uid=1000 euid=0 tty=/dev/pts/1 ruser=penguin rhost=  user=penguin");
        assert_eq!((s.place.as_str(), s.user.as_str(), s.from.as_str()), ("sudo", "penguin", ""));
        assert_eq!(s.when, "2026-11-03T21:04:00+0000");
        assert_eq!(f("2026-11-03T21:05:00+0000 host kscreenlocker_greet[9]: pam_unix(kde:auth): authentication failure; logname= uid=1000 euid=1000 tty= ruser= rhost=  user=penguin").place, "lock screen");
        assert_eq!(f("t host sddm-helper[9]: pam_unix(sddm:auth): authentication failure; user=penguin").place, "login screen");
        assert_eq!(f("t host polkit-agent-helper-1[9]: pam_unix(polkit-1:auth): authentication failure; user=penguin").place, "password window");
        let ssh = f("t host sshd-session[77]: Failed password for invalid user admin from 203.0.113.9 port 51234 ssh2");
        assert_eq!((ssh.place.as_str(), ssh.user.as_str(), ssh.from.as_str()), ("ssh", "admin", "203.0.113.9"));
        let ssh2 = f("t host sshd[77]: Failed password for root from 198.51.100.4 port 22 ssh2");
        assert_eq!((ssh2.user.as_str(), ssh2.from.as_str()), ("root", "198.51.100.4"));
        assert_eq!(parse_failure("t host sudo[1]: penguin : 3 incorrect password attempts ; TTY=pts/1 ; COMMAND=/usr/bin/true"), None, "a sum, not more attempts");
        assert_eq!(parse_failure("short"), None);
    }

    #[test]
    fn how_far_back_the_journal_reaches() {
        let lb = "IDX BOOT ID                          FIRST ENTRY                 LAST ENTRY\n -2 1f2e3d4c5b6a79881f2e3d4c5b6a7988 Fri 2026-10-31 18:22:15 -05 Sat 2026-11-01 20:00:00 -05\n  0 aa Wed 2026-11-04 08:00:00 -05 Wed 2026-11-05 10:00:00 -05\n";
        assert_eq!(oldest_entry(lb), Some("2026-10-31 18:22:15".into()));
        assert_eq!(oldest_entry("No boots\n"), None);
    }

    /// This computer (counts only): `cargo test this_computer_logins -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn this_computer_logins() {
        let f = tauri::async_runtime::block_on(login_failures(30));
        println!("failures {} since {:?}", f.failures.len(), f.since);
    }
}
