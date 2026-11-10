// A way back if an update breaks starting. Read without a
// password: the kernels installed (each /usr/lib/modules/<version>/ with a vmlinuz names its package
// in pkgbase), the one running, which start menu is installed (by its package — the menu itself sits
// in /boot, which only root may read), whether that menu can start a snapshot (limine-snapper-sync,
// grub-btrfs), and whether a kernel's headers are installed (a second kernel then wants its own).
// What the menu really lists is read as root only when you press "Check the start menu" (boot.ts).

use serde::Serialize;
use std::path::Path;
use std::time::Duration;

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Kernel {
    pub package: String, // linux-cachyos-lts
    pub version: String, // 6.12.40-1-cachyos-lts
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BootFacts {
    pub kernels: Vec<Kernel>,
    pub running: Option<String>, // the package of the kernel running now
    pub loader: String,          // "limine" | "grub" | "refind" | "" (none of these: systemd-boot, or not known)
    pub snapshot_menu: bool,     // the start menu lists snapshots (limine-snapper-sync, grub-btrfs)
    pub snapper: bool,           // snapper is installed (snapshots are taken)
    pub headers: bool,           // some kernel's headers are installed
    pub cachyos: bool,           // CachyOS (its kernels are linux-cachyos-*)
}

/// The kernels in /usr/lib/modules: a folder with a vmlinuz, its pkgbase naming the package.
pub fn kernels_in(modules: &Path) -> Vec<Kernel> {
    let mut out: Vec<Kernel> = std::fs::read_dir(modules)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().join("vmlinuz").is_file())
        .filter_map(|e| {
            let package = std::fs::read_to_string(e.path().join("pkgbase")).ok()?.trim().to_string();
            (!package.is_empty()).then(|| Kernel { package, version: e.file_name().to_string_lossy().into_owned() })
        })
        .collect();
    out.sort_by(|a, b| a.package.cmp(&b.package));
    out
}

/// Which start menu, from the packages installed (`pacman -Qq`).
pub fn loader_of(packages: &[&str]) -> &'static str {
    ["limine", "grub", "refind"].into_iter().find(|p| packages.contains(p)).unwrap_or("")
}

pub fn facts_from(kernels: Vec<Kernel>, release: &str, packages: &str, os_release: &str) -> BootFacts {
    let pk: Vec<&str> = packages.lines().map(str::trim).collect();
    let running = kernels.iter().find(|k| k.version == release.trim()).map(|k| k.package.clone());
    let loader = loader_of(&pk).to_string();
    BootFacts {
        snapshot_menu: (loader == "limine" && pk.contains(&"limine-snapper-sync")) || (loader == "grub" && pk.contains(&"grub-btrfs")),
        snapper: pk.contains(&"snapper"),
        headers: pk.iter().any(|p| p.starts_with("linux") && p.ends_with("-headers") && *p != "linux-api-headers"),
        cachyos: os_release.lines().any(|l| l.trim() == "ID=cachyos") || kernels.iter().any(|k| k.package.starts_with("linux-cachyos")),
        kernels,
        running,
        loader,
    }
}

#[tauri::command]
pub async fn boot_facts() -> Result<BootFacts, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let run = |argv: &[&str]| crate::probe::exec(&argv.iter().map(|s| s.to_string()).collect::<Vec<_>>(), Duration::from_secs(15));
        let packages = run(&["pacman", "-Qq"]).filter(|r| r.ok()).ok_or("pacman couldn't list the packages")?.stdout_text();
        let release = run(&["uname", "-r"]).map(|r| r.stdout_trim()).unwrap_or_default();
        let os = std::fs::read_to_string("/etc/os-release").unwrap_or_default();
        Ok(facts_from(kernels_in(Path::new("/usr/lib/modules")), &release, &packages, &os))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kernels_are_the_folders_with_a_vmlinuz() {
        let root = std::env::temp_dir().join(format!("tux-boot-{}", std::process::id()));
        for (dir, pkg, vmlinuz) in [("7.1.5-1-cachyos", "linux-cachyos", true), ("6.12.40-1-cachyos-lts", "linux-cachyos-lts\n", true), ("7.0.9-1-cachyos", "linux-cachyos", false)] {
            let d = root.join(dir);
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(d.join("pkgbase"), pkg).unwrap();
            if vmlinuz {
                std::fs::write(d.join("vmlinuz"), "").unwrap();
            }
        }
        std::fs::create_dir_all(root.join("extramodules-x")).unwrap(); // no pkgbase, no vmlinuz
        let k = kernels_in(&root);
        assert_eq!(k, [Kernel { package: "linux-cachyos".into(), version: "7.1.5-1-cachyos".into() }, Kernel { package: "linux-cachyos-lts".into(), version: "6.12.40-1-cachyos-lts".into() }], "an old kernel's leftover modules aren't a kernel");
        for dir in ["7.1.5-1-cachyos", "6.12.40-1-cachyos-lts", "7.0.9-1-cachyos"] {
            let d = root.join(dir);
            let _ = std::fs::remove_file(d.join("vmlinuz"));
            std::fs::remove_file(d.join("pkgbase")).unwrap();
            std::fs::remove_dir(d).unwrap();
        }
        std::fs::remove_dir(root.join("extramodules-x")).unwrap();
        std::fs::remove_dir(&root).unwrap();
    }

    #[test]
    fn this_kind_of_computer_read_from_its_packages() {
        let k = vec![Kernel { package: "linux-cachyos".into(), version: "7.1.5-1-cachyos".into() }, Kernel { package: "linux-cachyos-lts".into(), version: "6.12.40-1-cachyos-lts".into() }];
        let f = facts_from(k.clone(), "7.1.5-1-cachyos\n", "limine\nlimine-snapper-sync\nsnapper\nlinux-api-headers\nlinux-cachyos-headers\n", "NAME=\"CachyOS Linux\"\nID=cachyos\n");
        assert_eq!((f.running.as_deref(), f.loader.as_str(), f.snapshot_menu, f.snapper, f.headers, f.cachyos), (Some("linux-cachyos"), "limine", true, true, true, true));
        // Arch with GRUB, one kernel, no headers (linux-api-headers is not a kernel's)
        let a = facts_from(vec![Kernel { package: "linux".into(), version: "6.17.1-arch1-1".into() }], "6.17.1-arch1-1", "grub\nlimine-snapper-sync\nlinux-api-headers\n", "ID=arch\n");
        assert_eq!((a.loader.as_str(), a.snapshot_menu, a.headers, a.cachyos), ("grub", false, false, false), "limine-snapper-sync does nothing for GRUB");
        assert!(facts_from(vec![], "", "grub\ngrub-btrfs\n", "").snapshot_menu);
        assert_eq!(facts_from(vec![], "x", "systemd\n", "").loader, "", "systemd-boot is part of systemd: not known from a package");
        assert_eq!(facts_from(k.clone(), "6.1.0-other", "", "").running, None, "a kernel running that isn't installed (just updated, not restarted)");
        assert_eq!(facts_from(k, "7.1.5-1-cachyos-rc1", "", "").running, None, "a version that only starts the same is another kernel");
    }

    /// This computer, read-only: `cargo test this_computer_boot -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn this_computer_boot() {
        println!("{:?}", tauri::async_runtime::block_on(boot_facts()));
    }
}
