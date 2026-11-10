// How much disk the apps take: every package's installed size (pacman's own record), what
// removing each app would free (itself and the dependencies only it needs — the same rule as
// its removal plan, `pacman -Rs`), and the package caches. Read-only.

use crate::system::{read_db, Pkg};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSize {
    name: String,
    own: u64,
    frees: u64, // itself + what would leave with it
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskReport {
    packages_total: u64,
    packages_count: usize,
    apps: Vec<AppSize>, // largest first
    pacman_cache: u64,
    aur_cache: u64,
}

pub fn app_sizes(db: &HashMap<String, Pkg>, apps: &[String]) -> Vec<AppSize> {
    let mut out: Vec<AppSize> = apps
        .iter()
        .filter_map(|a| {
            let own = db.get(a)?.size;
            let deps: u64 = crate::deps::children(db, a).iter().filter_map(|c| db.get(c)).map(|p| p.size).sum();
            Some(AppSize { name: a.clone(), own, frees: own + deps })
        })
        .collect();
    out.sort_by(|a, b| b.frees.cmp(&a.frees).then(a.name.cmp(&b.name)));
    out
}

/// Sum of the files under `dir` (symlinks not followed; stops counting after 200 000 entries).
pub fn dir_size(dir: &Path) -> u64 {
    let mut total = 0;
    let mut stack = vec![dir.to_path_buf()];
    let mut seen = 0;
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.filter_map(|e| e.ok()) {
            seen += 1;
            if seen > 200_000 {
                return total;
            }
            let Ok(m) = e.path().symlink_metadata() else { continue };
            if m.is_dir() {
                stack.push(e.path());
            } else if m.is_file() {
                total += m.len();
            }
        }
    }
    total
}

#[tauri::command]
pub async fn disk_report(apps: Vec<String>) -> Result<DiskReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = read_db();
        let home = std::env::var("HOME").map(PathBuf::from).unwrap_or_default();
        DiskReport {
            packages_total: db.values().map(|p| p.size).sum(),
            packages_count: db.len(),
            apps: app_sizes(&db, &apps),
            pacman_cache: dir_size(Path::new("/var/cache/pacman/pkg")),
            aur_cache: dir_size(&home.join(".cache/yay")),
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::system::{parse_qi, parse_size};

    #[test]
    fn sizes_are_read_and_an_app_frees_its_own_dependencies() {
        assert_eq!(parse_size("10.15 MiB"), 10_643_046);
        assert_eq!(parse_size("512.00 B"), 512);
        assert_eq!(parse_size("1.50 GiB"), 1_610_612_736);
        let qi = "Name : app\nDepends On : lib  shared\nRequired By : None\nInstall Reason : Explicitly installed\nInstalled Size : 2.00 MiB\n\n\
                  Name : lib\nDepends On : None\nRequired By : app\nInstall Reason : Installed as a dependency for another package\nInstalled Size : 1.00 MiB\n\n\
                  Name : shared\nDepends On : None\nRequired By : app  other\nInstall Reason : Installed as a dependency for another package\nInstalled Size : 5.00 MiB\n\n\
                  Name : other\nDepends On : shared\nRequired By : None\nInstall Reason : Explicitly installed\nInstalled Size : 1.00 KiB\n";
        let db = parse_qi(qi);
        let s = app_sizes(&db, &["app".into(), "other".into(), "missing".into()]);
        // app frees itself + lib (only it needs lib); shared stays for `other`
        assert_eq!(s.iter().map(|a| (a.name.as_str(), a.own, a.frees)).collect::<Vec<_>>(), vec![("app", 2 << 20, 3 << 20), ("other", 1024, 1024)]);
    }

    /// On this machine (by hand: cargo test live_disk -- --ignored --nocapture).
    #[test]
    #[ignore]
    fn live_disk() {
        let db = read_db();
        let total: u64 = db.values().map(|p| p.size).sum();
        let s = app_sizes(&db, &["vscodium-bin".into(), "dolphin".into(), "docker".into(), "ollama".into(), "tor".into()]);
        println!("TOTAL {} packages {} bytes", db.len(), total);
        for a in s {
            println!("APP {} own {} frees {}", a.name, a.own, a.frees);
        }
        println!("CACHE pacman {} aur {}", dir_size(Path::new("/var/cache/pacman/pkg")), dir_size(&PathBuf::from(std::env::var("HOME").unwrap()).join(".cache/yay")));
    }

    #[test]
    fn a_folder_is_summed() {
        let d = std::env::temp_dir().join(format!("am-du-{}", std::process::id()));
        std::fs::create_dir_all(d.join("a/b")).unwrap();
        std::fs::write(d.join("x"), vec![0u8; 100]).unwrap();
        std::fs::write(d.join("a/b/y"), vec![0u8; 50]).unwrap();
        assert_eq!(dir_size(&d), 150);
        assert_eq!(dir_size(&d.join("nope")), 0);
        std::fs::remove_dir_all(&d).unwrap();
    }
}
