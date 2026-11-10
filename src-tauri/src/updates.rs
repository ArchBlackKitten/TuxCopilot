// Safe updates (the Updates section): what an update would bring, read without touching the
// system's package lists (checkupdates works on a copy; yay -Qua asks the AUR), when the last
// full update ran (pacman's log), whether a snapshot is taken before each update (btrfs,
// snapper's root config, snap-pac's hooks, limine-snapper-sync), and how old the mirror list is.

use crate::probe::exec;
use serde::Serialize;
use std::path::Path;
use std::time::Duration;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    pub name: String,
    pub from: String,
    pub to: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatesFacts {
    pub repo: Option<Vec<Update>>, // None: checkupdates could not tell (offline, or missing)
    pub repo_error: Option<String>,
    pub aur: Option<Vec<Update>>, // None: no yay, or the AUR didn't answer
    pub last_upgrade: Option<String>, // "2026-10-24T13:06:34+0000"
    pub btrfs: bool,
    pub snapper_root: bool,
    pub snap_pac: bool,
    pub limine_snapper: bool,
    pub mirrorlist_days: Option<u64>,
    pub reflector: bool,
    pub reflector_timer: bool,
    pub cachyos_mirrors: bool,       // CachyOS's cachyos-rate-mirrors: it ranks all the lists, Arch's and CachyOS's
    pub cachyos_mirrors_timer: bool, // and its timer keeps them fresh
}

/// `name old -> new` lines (checkupdates, yay -Qua; yay may add ` [5d23h]`).
pub fn parse_updates(text: &str) -> Vec<Update> {
    text.lines()
        .filter_map(|l| {
            let mut w = l.split_whitespace();
            let (name, from, arrow, to) = (w.next()?, w.next()?, w.next()?, w.next()?);
            (arrow == "->").then(|| Update { name: name.into(), from: from.into(), to: to.into() })
        })
        .collect()
}

/// The newest "starting full system upgrade" in pacman's log.
pub fn last_upgrade(log: &str) -> Option<String> {
    log.lines().rev().find(|l| l.contains("[PACMAN] starting full system upgrade")).and_then(|l| l.strip_prefix('[')?.split(']').next().map(String::from))
}

fn run(argv: &[&str], secs: u64) -> Option<crate::probe::ExecResult> {
    exec(&argv.iter().map(|s| s.to_string()).collect::<Vec<_>>(), Duration::from_secs(secs))
}

fn installed(bin: &str) -> bool {
    ["/usr/bin", "/usr/local/bin"].iter().any(|d| Path::new(d).join(bin).is_file())
}

/// The tail of pacman's log is enough to find the last full update (the log only grows).
fn log_tail(path: &str, bytes: u64) -> String {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(path) else { return String::new() };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let _ = f.seek(SeekFrom::Start(len.saturating_sub(bytes)));
    let mut buf = Vec::new();
    let _ = f.read_to_end(&mut buf);
    String::from_utf8_lossy(&buf).into_owned()
}

#[tauri::command]
pub async fn updates_facts() -> Result<UpdatesFacts, String> {
    tauri::async_runtime::spawn_blocking(|| {
        // checkupdates: 0 = updates listed, 2 = none, anything else = it couldn't tell
        let (repo, repo_error) = match run(&["checkupdates", "--nocolor"], 120) {
            Some(r) if r.ok() => (Some(parse_updates(&r.stdout_text())), None),
            Some(r) if r.code() == Some(2) => (Some(vec![]), None),
            Some(r) => (None, Some(r.joined().trim().to_string())),
            None => (None, Some(if installed("checkupdates") { "checkupdates took too long (no network?)".into() } else { "checkupdates is missing (it comes with pacman-contrib)".into() })),
        };
        let aur = installed("yay").then(|| run(&["yay", "-Qua", "--color=never"], 60)).flatten().filter(|r| r.ok() || r.stdout_text().is_empty()).map(|r| parse_updates(&r.stdout_text()));
        let hooks = std::fs::read_dir("/usr/share/libalpm/hooks").map(|d| d.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect::<Vec<_>>()).unwrap_or_default();
        let fstype = run(&["findmnt", "-no", "FSTYPE", "/"], 5).map(|r| r.stdout_trim()).unwrap_or_default();
        let age = std::fs::metadata("/etc/pacman.d/mirrorlist").and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).map(|d| d.as_secs() / 86_400);
        let mut log = log_tail("/var/log/pacman.log", 4 * 1024 * 1024);
        if last_upgrade(&log).is_none() {
            log = std::fs::read_to_string("/var/log/pacman.log").unwrap_or_default();
        }
        UpdatesFacts {
            repo,
            repo_error,
            aur,
            last_upgrade: last_upgrade(&log),
            btrfs: fstype == "btrfs",
            snapper_root: Path::new("/etc/snapper/configs/root").exists(),
            snap_pac: hooks.iter().any(|h| h.contains("snap-pac-pre")),
            limine_snapper: installed("limine-snapper-sync"),
            mirrorlist_days: age,
            reflector: installed("reflector"),
            reflector_timer: run(&["systemctl", "is-enabled", "reflector.timer"], 5).is_some_and(|r| r.stdout_trim() == "enabled"),
            cachyos_mirrors: installed("cachyos-rate-mirrors"),
            cachyos_mirrors_timer: run(&["systemctl", "is-enabled", "cachyos-rate-mirrors.timer"], 5).is_some_and(|r| r.stdout_trim() == "enabled"),
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_an_update_brings_is_read_from_both_tools() {
        let u = parse_updates("blender 17:5.2.3-3 -> 17:5.2.3-5\nvscodium-bin 1.121.03429-1 -> 1.143.17232-1 [2h45m]\n:: warning line\n\n");
        assert_eq!(u, vec![
            Update { name: "blender".into(), from: "17:5.2.3-3".into(), to: "17:5.2.3-5".into() },
            Update { name: "vscodium-bin".into(), from: "1.121.03429-1".into(), to: "1.143.17232-1".into() },
        ]);
    }

    #[test]
    fn the_last_full_update_is_the_newest_one_in_the_log() {
        let log = "[2026-06-29T19:35:58+0000] [PACMAN] starting full system upgrade\n[2026-06-30T10:00:00+0000] [ALPM] installed x\n[2026-10-24T13:06:34+0000] [PACMAN] starting full system upgrade\n[2026-10-25T09:00:00+0000] [PACMAN] Running 'pacman -S foo'\n";
        assert_eq!(last_upgrade(log).as_deref(), Some("2026-10-24T13:06:34+0000"));
        assert_eq!(last_upgrade("[2026-01-01T00:00:00+0000] [ALPM] installed x\n"), None);
    }

    /// The real computer (counts only): `cargo test this_computer_updates -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn this_computer_updates() {
        let f = tauri::async_runtime::block_on(updates_facts()).unwrap();
        println!(
            "repo {:?} aur {:?} last {:?} btrfs {} snapper {} snap-pac {} limine {} mirrorlist {:?} days reflector {} timer {} cachyos-rate-mirrors {} timer {}",
            f.repo.as_ref().map(Vec::len), f.aur.as_ref().map(Vec::len), f.last_upgrade, f.btrfs, f.snapper_root, f.snap_pac, f.limine_snapper, f.mirrorlist_days, f.reflector, f.reflector_timer, f.cachyos_mirrors, f.cachyos_mirrors_timer
        );
    }
}
