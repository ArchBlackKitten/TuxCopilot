// A snapshot before TuxCopilot changes the system. snap-pac
// already takes a pair around every pacman run; TuxCopilot's own changes to system files (the
// firewall, DNS, the input locks, a merged .pacnew, services) get a snapper pre/post pair too, so
// `snapper undochange <pre>..<post>` puts back what changed between them (that change's files, and
// anything else that changed one at the same moment — snapshot.ts). Ready when snapper has a config
// for / — read without a password (`snapper list-configs`; the snapshots themselves need root).

use crate::probe::exec;
use std::time::Duration;

/// `snapper --csvout --no-headers list-configs --columns config,subvolume` → a config named
/// root for the subvolume /.
pub fn has_root_config(csv: &str) -> bool {
    csv.lines().any(|l| l.trim() == "root,/")
}

#[tauri::command]
pub async fn snapshot_ready() -> bool {
    tauri::async_runtime::spawn_blocking(|| {
        let argv: Vec<String> = ["snapper", "--csvout", "--no-headers", "list-configs", "--columns", "config,subvolume"].map(String::from).to_vec();
        exec(&argv, Duration::from_secs(10)).is_some_and(|r| r.ok() && has_root_config(&r.stdout_text()))
    })
    .await
    .unwrap_or(false)
}

// ── Fluff's own record of its pairs ("Undo this change") ─────────────
// The after-step writes "pre<TAB>post<TAB>when<TAB>TuxCopilot: label" to
// ~/.local/state/tuxcopilot/snapshots.tsv; snapper itself lists snapshots only to root. The record
// is yours, so the undo command checks as root that the pair is really TuxCopilot's first.

#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FluffSnapshot {
    pub pre: u32,
    pub post: u32,
    pub when: String,
    pub label: String,
}

/// The record's lines, newest first; odd lines left out.
pub fn parse_record(text: &str) -> Vec<FluffSnapshot> {
    let mut out: Vec<FluffSnapshot> = text
        .lines()
        .filter_map(|l| {
            let f: Vec<&str> = l.split('\t').collect();
            let (pre, post) = (f.first()?.parse().ok()?, f.get(1)?.parse().ok()?);
            let label = f.get(3)?.strip_prefix("TuxCopilot: ")?.to_string();
            (post > pre).then(|| FluffSnapshot { pre, post, when: f.get(2).unwrap_or(&"").to_string(), label })
        })
        .collect();
    out.reverse();
    out.truncate(200);
    out
}

#[tauri::command]
pub async fn fluff_snapshots() -> Vec<FluffSnapshot> {
    tauri::async_runtime::spawn_blocking(|| {
        let home = std::env::var("HOME").unwrap_or_default();
        parse_record(&std::fs::read_to_string(format!("{home}/.local/state/tuxcopilot/snapshots.tsv")).unwrap_or_default())
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_only_with_a_config_for_the_whole_system() {
        assert!(has_root_config("root,/\n"));
        assert!(has_root_config("home,/home\nroot,/\n"));
        assert!(!has_root_config("home,/home\n"));
        assert!(!has_root_config("root,/mnt\n"), "a config named root for another disk");
        assert!(!has_root_config(""));
    }

    #[test]
    fn fluffs_record_is_read_newest_first_and_odd_lines_left_out() {
        let r = parse_record("41\t42\t2026-11-05T10:00:00\tTuxCopilot: Firewall: public\nx\ty\n44\t43\tz\tTuxCopilot: backwards\n45\t46\tz\tnot ours\n47\t48\t2026-11-05T11:00:00\tTuxCopilot: DNS: Quad9\n");
        assert_eq!(r.len(), 2);
        assert_eq!((r[0].pre, r[0].post, r[0].label.as_str()), (47, 48, "DNS: Quad9"));
        assert_eq!(r[1].when, "2026-11-05T10:00:00");
    }

    /// This computer: `cargo test this_computer_snapshot -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn this_computer_snapshot() {
        println!("snapshot ready: {}", tauri::async_runtime::block_on(snapshot_ready()));
    }
}
