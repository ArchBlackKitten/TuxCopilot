// Firmware updates, through fwupd: its daemon answers your
// account without a password. Read offline, from fwupd's own list (LVFS's metadata, as last
// fetched): what each part of the computer runs and what is offered, how old that list is, whether
// fwupd refreshes it by itself, whether Secure Boot is on (it decides what the key updates mean),
// and whether fwupd-efi is installed (some BIOS updates need it).

use serde::Serialize;
use std::time::Duration;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareUpdate {
    pub device_id: String,
    pub name: String,
    pub plugin: String, // uefi_capsule (the BIOS), uefi_dbx / uefi_kek / uefi_db (Secure Boot's keys), nvme, tpm, …
    pub current: String,
    pub version: String,
    pub summary: String,
    pub urgency: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Firmware {
    pub updates: Vec<FirmwareUpdate>,
    pub list_date: Option<i64>, // LVFS's list, as last fetched (unix seconds)
    pub refresh_timer: bool,
    pub secure_boot: Option<bool>,
    pub fwupd_efi: bool,
    pub available: bool, // fwupd answered
}

/// `fwupdmgr get-updates --json`: each device's first (newest) release.
pub fn parse_updates(json: &str) -> Vec<FirmwareUpdate> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(json) else { return vec![] };
    let s = |x: &serde_json::Value, k: &str| x.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    v.get("Devices")
        .and_then(|d| d.as_array())
        .map(|ds| {
            ds.iter()
                .filter_map(|d| {
                    let r = d.get("Releases")?.as_array()?.first()?;
                    Some(FirmwareUpdate {
                        device_id: s(d, "DeviceId"),
                        name: s(d, "Name"),
                        plugin: s(d, "Plugin"),
                        current: s(d, "Version"),
                        version: s(r, "Version"),
                        summary: s(r, "Summary"),
                        urgency: s(r, "Urgency"),
                    })
                })
                .filter(|u| !u.device_id.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// `fwupdmgr get-remotes --json`: when LVFS's list was last fetched.
pub fn lvfs_date(json: &str) -> Option<i64> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    v.get("Remotes")?.as_array()?.iter().find(|r| r.get("Id").and_then(|i| i.as_str()) == Some("lvfs"))?.get("Mtime")?.as_i64().filter(|m| *m > 0)
}

/// `bootctl status`: "Secure Boot: enabled" / "disabled".
pub fn secure_boot(bootctl: &str) -> Option<bool> {
    let l = bootctl.lines().find(|l| l.trim_start().starts_with("Secure Boot:"))?;
    let v = l.split(':').nth(1)?.trim();
    Some(v.starts_with("enabled"))
}

fn run(argv: &[&str], secs: u64) -> Option<crate::probe::ExecResult> {
    crate::probe::exec(&argv.iter().map(|s| s.to_string()).collect::<Vec<_>>(), Duration::from_secs(secs))
}

#[tauri::command]
pub async fn firmware_state() -> Firmware {
    tauri::async_runtime::spawn_blocking(|| {
        let ups = run(&["fwupdmgr", "get-updates", "--json", "--no-unreported-check", "--no-metadata-check"], 90);
        let available = ups.as_ref().is_some_and(|r| r.stdout_text().trim_start().starts_with('{'));
        Firmware {
            updates: ups.map(|r| parse_updates(&r.stdout_text())).unwrap_or_default(),
            list_date: run(&["fwupdmgr", "get-remotes", "--json"], 30).and_then(|r| lvfs_date(&r.stdout_text())),
            refresh_timer: run(&["systemctl", "is-enabled", "fwupd-refresh.timer"], 5).is_some_and(|r| r.stdout_trim() == "enabled"),
            secure_boot: run(&["bootctl", "status", "--no-pager"], 10).and_then(|r| secure_boot(&r.stdout_text())),
            fwupd_efi: std::path::Path::new("/usr/lib/fwupd/efi").exists() || run(&["pacman", "-Qq", "fwupd-efi"], 5).is_some_and(|r| r.ok()),
            available,
        }
    })
    .await
    .unwrap_or(Firmware { updates: vec![], list_date: None, refresh_timer: false, secure_boot: None, fwupd_efi: false, available: false })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fwupds_answers_are_read() {
        let j = r#"{"Devices":[{"Name":"System Firmware","DeviceId":"0123456789abcd","Plugin":"uefi_capsule","Version":"1.40.0","Releases":[{"Version":"1.52.0","Summary":"Firmware for the Example Laptop","Urgency":"high"},{"Version":"1.51.0"}]},{"Name":"No releases","DeviceId":"x","Releases":[]}]}"#;
        let u = parse_updates(j);
        assert_eq!(u.len(), 1);
        assert_eq!((u[0].current.as_str(), u[0].version.as_str(), u[0].urgency.as_str(), u[0].plugin.as_str()), ("1.40.0", "1.52.0", "high", "uefi_capsule"));
        assert_eq!(parse_updates("No updates available"), vec![]);
        assert_eq!(lvfs_date(r#"{"Remotes":[{"Id":"vendor-directory","Mtime":5},{"Id":"lvfs","Mtime":1787700000}]}"#), Some(1787700000));
        assert_eq!(secure_boot("  Firmware: UEFI 2.70\n  Secure Boot: disabled (unknown)\n"), Some(false));
        assert_eq!(secure_boot("Secure Boot: enabled (user)\n"), Some(true));
        assert_eq!(secure_boot("nothing"), None);
    }

    /// This computer: `cargo test this_computer_firmware -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn this_computer_firmware() {
        let f = tauri::async_runtime::block_on(firmware_state());
        println!("available {} list {:?} timer {} sb {:?} efi {}", f.available, f.list_date, f.refresh_timer, f.secure_boot, f.fwupd_efi);
        for u in &f.updates {
            println!("  {} {} -> {} ({}, {})", u.name, u.current, u.version, u.plugin, u.urgency);
        }
    }
}
