// A level that slips. The level you chose in each
// Security sub-section is kept in your locked database (security.chosen, saved on Apply), but the
// weekly checkup opens no database — so on Apply TuxCopilot also writes this small file for it:
// each watched sub-section's level, and a fingerprint (sha256) of the settings that level is made
// of. The fingerprint says nothing about the settings themselves. Once a week the checkup takes
// the fingerprints again; one that differs is said in its notification ("Security → Devices
// changed since you chose Good security"), and TuxCopilot's window then says exactly what moved.
//
// What a fingerprint covers is only what stays put by itself: never the networks you are on,
// a stick that is plugged in, failed logins, or what a running KWin or Xwayland answers now.
// As it comes (or no level) is not watched.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const AREAS: &[(&str, &str)] = &[("network", "Network"), ("devices", "Devices"), ("accounts", "Accounts & login"), ("system", "System")];
pub const WATCHED: &[(&str, &str)] = &[("good", "Good security"), ("secured", "Secured"), ("hardened", "Hardened")];

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
pub struct Mark {
    pub level: String,
    pub mark: String,
}

/// ~/.local/state/tuxcopilot/security-marks.json (or $XDG_STATE_HOME's).
pub fn marks_file() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_STATE_HOME").filter(|v| !v.is_empty()).map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|h| Path::new(&h).join(".local/state")))?;
    Some(base.join("tuxcopilot/security-marks.json"))
}

pub fn fingerprint(text: &str) -> String {
    openssl::sha::sha256(text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

fn sorted(mut v: Vec<String>) -> Vec<String> {
    v.sort();
    v
}

/// The settings a sub-section's level is made of, as text: the same text whenever they are the same.
/// None: Fluff couldn't read them (then nothing is said about that sub-section).
pub fn facts(area: &str) -> Option<String> {
    let v = match area {
        "network" => {
            let f = tauri::async_runtime::block_on(crate::firewall::firewall_state()).ok()?;
            let dns = tauri::async_runtime::block_on(crate::firewall::dns_state()).ok()?;
            let zone = f.zones.iter().find(|z| z.default).map(|z| serde_json::json!({ "target": z.target, "services": sorted(z.services.clone()), "ports": sorted(z.ports.clone()) }));
            serde_json::json!({ "firewalld": f.firewalld_on, "ufw": f.ufw_on, "zone": f.default_zone, "def": zone, "resolved": dns.resolved_on, "dns": dns.ours })
        }
        "devices" => {
            let s = tauri::async_runtime::block_on(crate::devices::storage_control());
            let i = tauri::async_runtime::block_on(crate::inputctl::input_control()).ok()?;
            let u = tauri::async_runtime::block_on(crate::usbguard::usbguard_state());
            if s.mount.is_empty() {
                return None; // polkit didn't answer: no guess
            }
            serde_json::json!({
                "mount": s.mount, "drivers": s.driver_rule,
                "noPrompt": i.no_prompt, "allowed": sorted(i.allowed_apps), "uinput": i.uinput_open, "ourRule": i.our_rule,
                "ydotool": i.ydotool_on, "bus": i.bus_rule, "xtest": i.xtest_wrapper, "krdp": i.krdp_on,
                "usbguard": [u.installed, u.active, u.enabled],
            })
        }
        "accounts" => {
            let l = tauri::async_runtime::block_on(crate::screenlock::screen_lock());
            let groups = sorted(tauri::async_runtime::block_on(crate::devices::my_groups()).into_iter().filter(|g| g.listed).map(|g| g.name).collect());
            serde_json::json!({ "autolock": l.autolock, "timeout": l.timeout_min, "resume": l.lock_on_resume, "grace": l.grace_s, "kept": Path::new(crate::logins::JOURNAL_KEEP).exists(), "groups": groups })
        }
        "system" => {
            let k = tauri::async_runtime::block_on(crate::kernel::kernel_settings());
            serde_json::json!({ "kernel": k.values, "file": k.file_there, "weekly": tauri::async_runtime::block_on(crate::weekly::weekly_state()).on })
        }
        _ => return None,
    };
    Some(v.to_string())
}

pub fn load(path: &Path) -> BTreeMap<String, Mark> {
    std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// The new file's marks: each area given, at a watched level, gets its fingerprint now; any other
/// level (As it comes, or none) stops being watched. Areas not given are left as they are.
pub fn merged(mut saved: BTreeMap<String, Mark>, levels: &BTreeMap<String, String>, facts: impl Fn(&str) -> Option<String>) -> BTreeMap<String, Mark> {
    for (area, level) in levels {
        if !AREAS.iter().any(|(a, _)| a == area) {
            continue;
        }
        match (WATCHED.iter().any(|(l, _)| l == level), facts(area)) {
            (true, Some(text)) => {
                saved.insert(area.clone(), Mark { level: level.clone(), mark: fingerprint(&text) });
            }
            (true, None) => {} // couldn't read: the old mark stays
            (false, _) => {
                saved.remove(area);
            }
        }
    }
    saved
}

/// The sub-sections whose settings changed since their level was chosen, in words.
pub fn slipped(saved: &BTreeMap<String, Mark>, facts: impl Fn(&str) -> Option<String>) -> Vec<String> {
    AREAS
        .iter()
        .filter_map(|(area, name)| {
            let m = saved.get(*area)?;
            let level = WATCHED.iter().find(|(l, _)| *l == m.level)?.1;
            let now = facts(area)?;
            (fingerprint(&now) != m.mark).then(|| format!("Security → {name} changed since you chose {level}"))
        })
        .collect()
}

/// Written whole, then moved into place; only you can read it.
pub fn write(path: &Path, marks: &BTreeMap<String, Mark>) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let dir = path.parent().ok_or("no folder for the marks")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let tmp = path.with_extension("json.new");
    let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&tmp).map_err(|e| format!("{}: {e}", tmp.display()))?;
    f.write_all(serde_json::to_string_pretty(marks).map_err(|e| e.to_string())?.as_bytes()).and_then(|_| f.sync_all()).map_err(|e| format!("{}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("{}: {e}", path.display()))
}

/// Apply (the levels you chose), and the window seeing a level still holds (its fingerprint taken
/// again, so a harmless change isn't said every week): writes only when something differs.
#[tauri::command]
pub async fn security_marks_save(levels: BTreeMap<String, String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = marks_file().ok_or("no home folder")?;
        let saved = load(&path);
        let next = merged(saved.clone(), &levels, facts);
        if next == saved {
            return Ok(());
        }
        write(&path, &next)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const FACTS: fn(&str) -> Option<String> = |a| match a {
        "network" => Some("zone public".into()),
        "devices" => Some("storage ask".into()),
        "accounts" => None, // couldn't read
        _ => Some("kernel recommended".into()),
    };
    fn levels(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(a, l)| (a.to_string(), l.to_string())).collect()
    }

    #[test]
    fn chosen_levels_are_fingerprinted_and_as_it_comes_isnt_watched() {
        let m = merged(BTreeMap::new(), &levels(&[("network", "good"), ("devices", "hardened"), ("system", "arch"), ("nowhere", "good")]), FACTS);
        assert_eq!(m.keys().collect::<Vec<_>>(), ["devices", "network"]);
        assert_eq!(m["network"], Mark { level: "good".into(), mark: fingerprint("zone public") });
        assert_eq!(fingerprint("zone public").len(), 64);
        // As it comes later: no longer watched; a sub-section not given is left alone
        let m2 = merged(m.clone(), &levels(&[("devices", "arch")]), FACTS);
        assert_eq!(m2.keys().collect::<Vec<_>>(), ["network"]);
        // couldn't read: the old mark stays, never a guess
        let had = BTreeMap::from([("accounts".to_string(), Mark { level: "good".into(), mark: "old".into() })]);
        assert_eq!(merged(had.clone(), &levels(&[("accounts", "secured")]), FACTS), had);
    }

    #[test]
    fn a_change_is_said_by_sub_section_and_level() {
        let m = merged(BTreeMap::new(), &levels(&[("network", "good"), ("devices", "secured"), ("system", "hardened")]), FACTS);
        assert_eq!(slipped(&m, FACTS), Vec::<String>::new());
        let moved = |a: &str| if a == "devices" { Some("storage allow".into()) } else { FACTS(a) };
        assert_eq!(slipped(&m, moved), ["Security → Devices changed since you chose Secured"]);
        let unread = |a: &str| if a == "devices" { None } else { FACTS(a) };
        assert_eq!(slipped(&m, unread), Vec::<String>::new(), "couldn't read: nothing said");
        let odd = BTreeMap::from([("network".to_string(), Mark { level: "arch".into(), mark: "x".into() })]);
        assert_eq!(slipped(&odd, FACTS), Vec::<String>::new(), "only a watched level is said");
    }

    #[test]
    fn the_file_is_yours_alone_and_written_whole() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("tux-marks-{}", std::process::id()));
        let path = dir.join("tuxcopilot/security-marks.json");
        let m = merged(BTreeMap::new(), &levels(&[("network", "good")]), FACTS);
        write(&path, &m).unwrap();
        assert_eq!(load(&path), m);
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        assert!(!path.with_extension("json.new").exists());
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_dir(path.parent().unwrap()).unwrap();
        std::fs::remove_dir(&dir).unwrap();
        assert!(load(&path).is_empty(), "no file: nothing watched");
    }

    #[test]
    fn what_a_fingerprint_covers_never_moves_by_itself() {
        let code = include_str!("marks.rs");
        let facts = &code[code.find("pub fn facts").unwrap()..code.find("pub fn load").unwrap()];
        for volatile in ["networks", "connections", "loaded", "blocked", "failures", "door_shut", "xtest_off_now", "this_login", "others", "status", ".last"] {
            assert!(!facts.contains(volatile), "{volatile} changes by itself: it must not be in a fingerprint");
        }
    }
}

#[cfg(test)]
mod on_this_computer {
    /// Read-only (the app's own readers): each fingerprint, taken twice, is the same.
    #[test]
    #[ignore]
    fn fingerprints_hold_still() {
        for (area, _) in super::AREAS {
            let (a, b) = (super::facts(area).map(|t| super::fingerprint(&t)), super::facts(area).map(|t| super::fingerprint(&t)));
            println!("{area}: {}", a.as_deref().map(|m| &m[..12]).unwrap_or("couldn't read"));
            assert_eq!(a, b, "{area}");
        }
    }
}
