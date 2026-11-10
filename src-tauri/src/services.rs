// Services (the Services section): every systemd service of the system and of your user —
// what runs, what failed, what is dormant, what was never started — read from systemd itself.
//
//   running        active and running
//   ran once       active, exited: it did its work at boot and finished, as designed
//   failed         stopped with an error
//   dead           killed (Kill sends SIGKILL; systemd records Result=signal)
//   dormant        switched on (enabled) but not running: a timer, a socket or a request starts it
//   off            loaded but stopped and switched off
//   never started  installed, but systemd has never loaded it
//   on demand      static: no switch of its own, other units start it
//   blocked        masked
//
// The buttons (On / Off / Kill) are commands the window shows before they run; this only reads.

use crate::probe::exec;
use serde::Serialize;
use std::collections::HashMap;
use std::time::Duration;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub name: String,
    pub description: String,
    pub user: bool,           // a service of your user (systemctl --user), not the system's
    pub state: &'static str,  // see above
    pub enabled: String,      // enabled / disabled / static / masked / indirect / … ("" unknown)
    pub since: Option<String>, // when it last became active
    pub result: String,        // how it last ended: success / timeout / exit-code / core-dump / start-limit-hit / … ("" unknown)
}

/// `systemctl show` output: blocks of Key=Value, separated by blank lines.
pub fn parse_show(text: &str) -> Vec<HashMap<String, String>> {
    text.split("\n\n")
        .map(|block| {
            block
                .lines()
                .filter_map(|l| l.split_once('=').map(|(k, v)| (k.to_string(), v.to_string())))
                .collect::<HashMap<_, _>>()
        })
        .filter(|m| m.contains_key("Id"))
        .collect()
}

/// `systemctl list-unit-files --type=service`: name → state (templates `foo@.service` left out).
pub fn parse_unit_files(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|l| {
            let mut it = l.split_whitespace();
            let (name, state) = (it.next()?, it.next()?);
            (name.ends_with(".service") && !name.contains("@.")).then(|| (name.to_string(), state.to_string()))
        })
        .collect()
}

pub fn state_of(p: &HashMap<String, String>) -> &'static str {
    let g = |k: &str| p.get(k).map(String::as_str).unwrap_or("");
    match (g("ActiveState"), g("SubState"), g("UnitFileState")) {
        (_, _, "masked") | (_, _, "masked-runtime") => "blocked",
        ("failed", _, _) if g("Result") == "signal" => "dead",
        ("failed", _, _) => "failed",
        ("active", "exited", _) => "ran once",
        ("active", _, _) | ("activating", _, _) | ("reloading", _, _) | ("deactivating", _, _) => "running",
        (_, _, "enabled") | (_, _, "enabled-runtime") | (_, _, "linked") | (_, _, "alias") => "dormant",
        (_, _, "static") | (_, _, "indirect") | (_, _, "generated") | (_, _, "transient") => "on demand",
        _ => "off",
    }
}

fn systemctl(user: bool, args: &[&str]) -> Option<String> {
    let mut argv = vec!["systemctl".to_string()];
    if user {
        argv.push("--user".into());
    }
    argv.extend(args.iter().map(|s| s.to_string()));
    argv.push("--no-pager".into());
    exec(&argv, Duration::from_secs(20)).filter(|r| r.ok()).map(|r| r.stdout_text())
}

pub(crate) fn list(user: bool) -> Vec<Service> {
    let loaded: Vec<String> = systemctl(user, &["list-units", "--type=service", "--all", "--no-legend", "--plain"])
        .unwrap_or_default()
        .lines()
        .filter_map(|l| l.split_whitespace().next().map(String::from))
        .filter(|n| n.ends_with(".service"))
        .collect();
    let mut out = vec![];
    for chunk in loaded.chunks(200) {
        let mut args = vec!["show", "-p", "Id,Description,LoadState,ActiveState,SubState,UnitFileState,Result,Transient,ActiveEnterTimestamp"];
        args.extend(chunk.iter().map(String::as_str));
        for p in parse_show(&systemctl(user, &args).unwrap_or_default()) {
            if p.get("Transient").map(String::as_str) == Some("yes") || p.get("LoadState").map(String::as_str) == Some("not-found") {
                continue; // programs you opened (app-…), and leftovers of removed packages
            }
            out.push(Service {
                name: p["Id"].clone(),
                description: p.get("Description").cloned().unwrap_or_default(),
                user,
                state: state_of(&p),
                enabled: p.get("UnitFileState").cloned().unwrap_or_default(),
                since: p.get("ActiveEnterTimestamp").filter(|t| !t.is_empty() && *t != "n/a").cloned(),
                result: p.get("Result").cloned().unwrap_or_default(),
            });
        }
    }
    let have: std::collections::HashSet<String> = out.iter().map(|s| s.name.clone()).collect();
    for (name, state) in parse_unit_files(&systemctl(user, &["list-unit-files", "--type=service", "--no-legend"]).unwrap_or_default()) {
        if have.contains(&name) || !["enabled", "disabled"].contains(&state.as_str()) {
            continue;
        }
        out.push(Service { name, description: String::new(), user, state: "never started", enabled: state, since: None, result: String::new() });
    }
    out
}

#[tauri::command]
pub async fn services_list() -> Vec<Service> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut all = list(false);
        all.extend(list(true));
        all.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        all
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn props(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn every_service_gets_one_plain_state() {
        let s = |a: &str, sub: &str, file: &str, result: &str| state_of(&props(&[("ActiveState", a), ("SubState", sub), ("UnitFileState", file), ("Result", result)]));
        assert_eq!(s("active", "running", "enabled", "success"), "running");
        assert_eq!(s("active", "exited", "static", "success"), "ran once");
        assert_eq!(s("failed", "failed", "enabled", "exit-code"), "failed");
        assert_eq!(s("failed", "failed", "enabled", "signal"), "dead", "Kill (SIGKILL) reads Dead");
        assert_eq!(s("inactive", "dead", "enabled", "success"), "dormant");
        assert_eq!(s("inactive", "dead", "disabled", "success"), "off");
        assert_eq!(s("inactive", "dead", "static", "success"), "on demand");
        assert_eq!(s("inactive", "dead", "masked", "success"), "blocked");
    }

    #[test]
    fn systemctl_show_and_unit_files_are_read() {
        let show = "Id=sshd.service\nDescription=OpenSSH Daemon\nActiveState=inactive\nSubState=dead\nUnitFileState=disabled\nResult=success\n\nId=cups.service\nDescription=CUPS Scheduler\nActiveState=active\nSubState=running\nUnitFileState=enabled\n";
        let p = parse_show(show);
        assert_eq!(p.len(), 2);
        assert_eq!(p[1]["Description"], "CUPS Scheduler");
        let files = "acpid.service    disabled disabled\nalsa-card-wait@.service static -\ncups.service enabled enabled\n";
        assert_eq!(parse_unit_files(files), vec![("acpid.service".into(), "disabled".into()), ("cups.service".into(), "enabled".into())]);
    }

    /// On a real computer, counts only: `cargo test -- --ignored services_here --nocapture`
    #[test]
    #[ignore]
    fn services_here() {
        let all = tauri::async_runtime::block_on(services_list());
        let mut by: std::collections::BTreeMap<&str, usize> = Default::default();
        for s in &all {
            *by.entry(s.state).or_default() += 1;
        }
        println!("{} services: {by:?}; user {}", all.len(), all.iter().filter(|s| s.user).count());
        for s in all.iter().filter(|s| s.state == "failed") {
            println!("failed: {} ({}), result {}", s.name, if s.user { "yours" } else { "system" }, s.result);
        }
        assert!(all.iter().any(|s| s.state == "running"));
    }
}
