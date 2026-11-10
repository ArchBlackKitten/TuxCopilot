// What is "the system" on THIS machine: learned from the installed OS, not a hand-written
// list. App Manager refuses to plan the removal of anything found here.
//
// Seeds, each read from where the OS itself keeps it:
//   base               the Arch base meta-package
//   kernels            owners of /usr/lib/modules/*/vmlinuz, plus packages built for them
//   bootloader         the installed loader package(s) and their helpers (/boot needs root)
//   boot image         mkinitcpio / dracut / booster
//   firmware           linux-firmware*, microcode, sof-firmware
//   package manager    pacman, the keyrings in /usr/share/pacman/keyrings, the mirror lists
//                      in /etc/pacman.d, the installed AUR helper
//   admin rights       sudo / doas
//   your shell         from /etc/passwd
//   login screen       /etc/systemd/system/display-manager.service
//   desktops           every installed session (wayland-sessions, xsessions), its package
//                      and the package groups it belongs to (plasma, xfce4, cosmic…)
//   boot services      units enabled under /etc/systemd/system/*.wants that the machine
//                      needs to run (network, time, power, disks, the system's own units).
//                      An app you enabled yourself (Tor, Docker, a printer service, sshd)
//                      is yours, not the system: the system is the base the machine needs
//                      to run
//   the distribution   its own packages (cachyos-*, eos-*, manjaro-*…) — from os-release,
//                      or from the OS the user picked in Settings
//
// Then everything those seeds depend on (pacman's "Depends On", through "Provides"), so a
// library the desktop needs is protected because the desktop needs it.

use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use crate::db::{now_iso, setting_get, setting_set, Db};

/// The distributions Settings offers. `prefixes`: package-name prefixes that are the distro's
/// own; `extras`: its own packages that don't share the prefix.
pub struct Distro {
    pub id: &'static str,
    pub name: &'static str,
    prefixes: &'static [&'static str],
    extras: &'static [&'static str],
}

pub const DISTROS: &[Distro] = &[
    Distro { id: "arch", name: "Arch Linux", prefixes: &[], extras: &["archlinux-keyring", "pacman-mirrorlist"] },
    Distro { id: "cachyos", name: "CachyOS", prefixes: &["cachyos-"], extras: &["chwd"] },
    Distro { id: "endeavouros", name: "EndeavourOS", prefixes: &["endeavouros-", "eos-"], extras: &["reflector-simple"] },
    Distro { id: "manjaro", name: "Manjaro", prefixes: &["manjaro-", "mhwd"], extras: &["pamac-gtk", "pamac-gtk3", "pamac-cli", "pacman-mirrors"] },
    Distro { id: "garuda", name: "Garuda Linux", prefixes: &["garuda-"], extras: &["chaotic-keyring", "chaotic-mirrorlist"] },
    Distro { id: "artix", name: "Artix Linux", prefixes: &["artix-"], extras: &[] },
    Distro { id: "other", name: "Other Arch-based", prefixes: &[], extras: &[] },
];

const AUR_HELPERS: &[&str] = &["yay", "yay-bin", "paru", "paru-bin", "pikaur", "trizen", "aura", "pamac-aur"];
const BOOTLOADERS: &[&str] = &["grub", "limine", "refind", "syslinux", "systemd-boot-manager", "efibootmgr"];
const BOOT_IMAGE: &[&str] = &["mkinitcpio", "dracut", "booster"];
const ADMIN: &[&str] = &["sudo", "sudo-rs", "doas", "opendoas"];

// ── pacman's database ────────────────────────────────────────────────────

#[derive(Default, Debug)]
pub struct Pkg {
    pub groups: Vec<String>,
    pub depends: Vec<String>,
    pub provides: Vec<String>,
    pub required_by: Vec<String>,
    pub optional_for: Vec<String>,
    pub explicit: bool, // "Install Reason: Explicitly installed"
    pub size: u64, // "Installed Size", in bytes
}

/// "10.15 MiB" → bytes.
pub fn parse_size(v: &str) -> u64 {
    let mut it = v.split_whitespace();
    let n: f64 = it.next().and_then(|x| x.parse().ok()).unwrap_or(0.0);
    let mult = match it.next().unwrap_or("B") {
        "KiB" => 1024.0,
        "MiB" => 1024.0 * 1024.0,
        "GiB" => 1024.0 * 1024.0 * 1024.0,
        "TiB" => 1024.0_f64.powi(4),
        _ => 1.0,
    };
    (n * mult).round() as u64
}

/// `pacman -Qi` (LC_ALL=C): "Key   : value" blocks; continuation lines start with spaces.
pub fn parse_qi(text: &str) -> HashMap<String, Pkg> {
    let mut out = HashMap::new();
    let (mut name, mut pkg, mut key) = (None::<String>, Pkg::default(), String::new());
    let mut flush = |name: &mut Option<String>, pkg: &mut Pkg| {
        if let Some(n) = name.take() {
            out.insert(n, std::mem::take(pkg));
        }
    };
    let list = |v: &str| -> Vec<String> {
        if v.trim() == "None" { vec![] } else { v.split_whitespace().map(dep_name).collect() }
    };
    for line in text.lines() {
        if line.trim().is_empty() {
            flush(&mut name, &mut pkg);
            continue;
        }
        let (k, v) = if line.starts_with(char::is_whitespace) {
            (key.clone(), line)
        } else if let Some((k, v)) = line.split_once(" : ").or_else(|| line.split_once(':')) {
            key = k.trim().to_string();
            (key.clone(), v)
        } else {
            continue;
        };
        match k.as_str() {
            "Name" => name = Some(v.trim().to_string()),
            "Groups" => pkg.groups.extend(list(v)),
            "Depends On" => pkg.depends.extend(list(v)),
            "Provides" => pkg.provides.extend(list(v)),
            "Required By" => pkg.required_by.extend(list(v)),
            "Optional For" => pkg.optional_for.extend(list(v)),
            "Install Reason" => pkg.explicit = v.trim().starts_with("Explicitly"),
            "Installed Size" => pkg.size = parse_size(v),
            _ => {}
        }
    }
    flush(&mut name, &mut pkg);
    out
}

/// "glibc>=2.38" → "glibc"; "sh=5.2" → "sh".
fn dep_name(d: &str) -> String {
    d.split(|c| matches!(c, '<' | '>' | '=' | ':')).next().unwrap_or(d).to_string()
}

// ── the profile ──────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CorePkg {
    pub package: String,
    pub reason: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OsOption {
    id: String,
    name: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SystemProfile {
    pub os_id: String,            // the OS in effect
    pub os_name: String,
    pub os_chosen: bool,          // picked in Settings rather than detected
    pub detected_os_id: String,   // what /etc/os-release says
    pub detected_os_name: String,
    pub os_options: Vec<OsOption>,
    pub desktop: Option<String>,  // the session you are in now
    pub session_type: Option<String>, // wayland | x11 | tty (XDG_SESSION_TYPE)
    pub sessions: Vec<String>,    // every desktop you can log into
    pub kernels: Vec<String>,
    pub bootloaders: Vec<String>,
    pub login_screen: Option<String>,
    pub shell: Option<String>,
    pub core: Vec<CorePkg>,
    pub detected_at: String,
}

fn os_release() -> HashMap<String, String> {
    std::fs::read_to_string("/etc/os-release")
        .unwrap_or_default()
        .lines()
        .filter_map(|l| l.split_once('='))
        .map(|(k, v)| (k.to_string(), v.trim_matches('"').to_string()))
        .collect()
}

/// Package owning each path (`pacman -Qo`, batched).
fn owners(paths: &[PathBuf]) -> HashMap<PathBuf, String> {
    let mut map = HashMap::new();
    for chunk in paths.chunks(200) {
        let Ok(out) = Command::new("pacman").arg("-Qo").args(chunk).env("LC_ALL", "C").output() else { break };
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            if let Some((file, rest)) = line.split_once(" is owned by ") {
                if let Some(pkg) = rest.split_whitespace().next() {
                    map.insert(PathBuf::from(file), pkg.to_string());
                }
            }
        }
    }
    map
}

fn files_in(dir: &str, keep: impl Fn(&Path) -> bool) -> Vec<PathBuf> {
    std::fs::read_dir(dir)
        .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| keep(p)).collect())
        .unwrap_or_default()
}

fn desktop_name(file: &Path) -> String {
    std::fs::read_to_string(file)
        .ok()
        .and_then(|t| t.lines().find_map(|l| l.strip_prefix("Name=").map(str::to_string)))
        .unwrap_or_else(|| file.file_stem().unwrap_or_default().to_string_lossy().into_owned())
}

/// A boot service the machine needs to run — not one you added for an app you use.
pub fn machine_needs(unit: &str) -> bool {
    const NEEDED: &[&str] = &[
        // the network
        "NetworkManager", "iwd", "wpa_supplicant", "systemd-networkd", "systemd-resolved", "dhcpcd", "connman", "netctl",
        // the clock
        "systemd-timesyncd", "chronyd", "ntpd",
        // the system's own: logins, devices, journal, swap/zram, D-Bus, permissions
        "systemd-", "getty@", "dbus", "polkit",
        // power and disks
        "upower", "power-profiles-daemon", "tlp", "thermald", "udisks2", "lvm2", "cryptsetup",
    ];
    NEEDED.iter().any(|n| unit.starts_with(n))
}

/// Every unit enabled to start at boot, as the path systemd links to.
fn enabled_units() -> Vec<(String, PathBuf)> {
    let mut out = vec![];
    for wants in files_in("/etc/systemd/system", |p| p.is_dir() && p.extension().is_some_and(|x| x == "wants")) {
        for link in files_in(wants.to_str().unwrap_or_default(), |_| true) {
            if let Ok(target) = std::fs::read_link(&link) {
                let unit = link.file_name().unwrap_or_default().to_string_lossy().into_owned();
                out.push((unit, target));
            }
        }
    }
    out
}

fn current_shell() -> Option<String> {
    // SAFETY: getuid has no failure mode and touches no memory.
    let uid = unsafe { libc::getuid() };
    std::fs::read_to_string("/etc/passwd").ok()?.lines().find_map(|l| {
        let f: Vec<&str> = l.split(':').collect();
        (f.len() >= 7 && f[2].parse::<u32>().ok() == Some(uid)).then(|| f[6].to_string())
    })
}

/// The OS in effect: the Settings choice when there is one, else os-release.
fn effective_os(choice: Option<&str>, rel: &HashMap<String, String>) -> (&'static Distro, bool) {
    if let Some(d) = choice.and_then(|c| DISTROS.iter().find(|d| d.id == c)) {
        return (d, true);
    }
    let id = rel.get("ID").map(String::as_str).unwrap_or("");
    let like = rel.get("ID_LIKE").map(String::as_str).unwrap_or("");
    let d = DISTROS
        .iter()
        .find(|d| d.id == id)
        .or_else(|| (id == "arch" || like.split_whitespace().any(|l| l == "arch")).then(|| &DISTROS[DISTROS.len() - 1]))
        .unwrap_or(&DISTROS[DISTROS.len() - 1]);
    (d, false)
}

/// pacman's whole local database, parsed (one `pacman -Qi`, ~0.4 s).
pub fn read_db() -> HashMap<String, Pkg> {
    let qi = Command::new("pacman").arg("-Qi").env("LC_ALL", "C").output().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default();
    parse_qi(&qi)
}

pub fn detect(choice: Option<&str>) -> SystemProfile {
    let rel = os_release();
    let (distro, chosen) = effective_os(choice, &rel);
    let db = read_db();
    let installed = |p: &str| db.contains_key(p);

    // (package, why). Names that are not installed are dropped by the walk below.
    let mut seeds: Vec<(String, String)> = vec![];

    seeds.push(("base".to_string(), "the Arch base system".into()));
    seeds.push(("pacman".to_string(), "the package manager".into()));
    for a in ADMIN {
        seeds.push((a.to_string(), "how you get admin rights".into()));
    }
    for h in AUR_HELPERS {
        seeds.push((h.to_string(), "how you install from the AUR".into()));
    }

    // kernels and what is built for them
    let vmlinuz: Vec<PathBuf> = files_in("/usr/lib/modules", |p| p.is_dir()).into_iter().map(|d| d.join("vmlinuz")).filter(|p| p.exists()).collect();
    let mut kernels: Vec<String> = owners(&vmlinuz).into_values().collect();
    kernels.sort();
    kernels.dedup();
    for k in &kernels {
        seeds.push((k.to_string(), "your kernel".into()));
        let pre = format!("{k}-");
        for p in db.keys().filter(|p| p.starts_with(&pre)) {
            seeds.push((p.clone(), format!("built for your kernel ({k})")));
        }
    }

    // booting
    let bootloaders: Vec<String> = BOOTLOADERS.iter().filter(|b| installed(b)).map(|b| b.to_string()).collect();
    for b in &bootloaders {
        seeds.push((b.to_string(), "your bootloader".into()));
        let pre = format!("{b}-");
        for p in db.keys().filter(|p| p.starts_with(&pre)) {
            seeds.push((p.clone(), format!("part of your bootloader setup ({b})")));
        }
    }
    for b in BOOT_IMAGE {
        seeds.push((b.to_string(), "builds the image your computer boots from".into()));
    }
    for p in db.keys().filter(|p| p.starts_with("linux-firmware") || p.ends_with("-ucode") || *p == "sof-firmware") {
        seeds.push((p.clone(), "firmware your hardware loads at boot".into()));
    }

    // pacman's trust and mirrors, from the files pacman itself reads
    let mut trust = files_in("/usr/share/pacman/keyrings", |p| p.is_file());
    trust.extend(files_in("/etc/pacman.d", |p| p.is_file()));
    for pkg in owners(&trust).into_values() {
        seeds.push((pkg, "lets pacman trust and download packages".into()));
    }

    // your shell
    let shell = current_shell();
    if let Some(s) = &shell {
        for pkg in owners(&[PathBuf::from(s)]).into_values() {
            seeds.push((pkg, format!("your login shell ({s})")));
        }
    }

    // login screen
    let dm = std::fs::read_link("/etc/systemd/system/display-manager.service").ok();
    let login_screen = dm.as_ref().and_then(|t| owners(&[t.clone()]).into_values().next());
    if let Some(l) = &login_screen {
        seeds.push((l.to_string(), "your login screen".into()));
    }

    // every desktop you can log into, its package and the groups that package belongs to
    let mut session_files = files_in("/usr/share/wayland-sessions", |p| p.extension().is_some_and(|x| x == "desktop"));
    session_files.extend(files_in("/usr/share/xsessions", |p| p.extension().is_some_and(|x| x == "desktop")));
    let mut sessions = vec![];
    for (file, pkg) in owners(&session_files) {
        let name = desktop_name(&file);
        sessions.push(name.clone());
        seeds.push((pkg.clone(), format!("the {name} desktop")));
        for g in db.get(&pkg).map(|p| p.groups.clone()).unwrap_or_default() {
            for (member, info) in &db {
                if info.groups.contains(&g) {
                    seeds.push((member.clone(), format!("part of the {name} desktop")));
                }
            }
        }
    }
    sessions.sort();
    sessions.dedup();

    // services started at boot
    let units = enabled_units();
    let unit_owner = owners(&units.iter().map(|(_, t)| t.clone()).collect::<Vec<_>>());
    for (unit, target) in &units {
        if let Some(pkg) = unit_owner.get(target) {
            if machine_needs(unit) {
                seeds.push((pkg.clone(), format!("keeps the machine running ({unit})")));
            }
        }
    }

    // the distribution's own packages
    for p in db.keys() {
        if distro.prefixes.iter().any(|pre| p.starts_with(pre)) || distro.extras.contains(&p.as_str()) {
            seeds.push((p.clone(), format!("part of {}", distro.name)));
        }
    }

    // …and everything they depend on
    let mut provided: HashMap<&str, &str> = HashMap::new();
    for (name, info) in &db {
        for p in &info.provides {
            provided.entry(p.as_str()).or_insert(name.as_str());
        }
    }
    let mut core: BTreeMap<String, String> = BTreeMap::new();
    let mut queue: VecDeque<(String, String)> = VecDeque::new();
    for (p, why) in seeds {
        if db.contains_key(&p) && !core.contains_key(&p) {
            core.insert(p.clone(), why);
            queue.push_back((p.clone(), p));
        }
    }
    let mut visited: HashSet<String> = core.keys().cloned().collect();
    while let Some((pkg, root)) = queue.pop_front() {
        for dep in db.get(&pkg).map(|p| p.depends.clone()).unwrap_or_default() {
            let real = if db.contains_key(&dep) { dep.clone() } else { provided.get(dep.as_str()).map(|s| s.to_string()).unwrap_or_default() };
            if real.is_empty() || !visited.insert(real.clone()) {
                continue;
            }
            let why = format!("needed by {root} ({})", core.get(&root).cloned().unwrap_or_default());
            core.insert(real.clone(), why);
            queue.push_back((real, root.clone()));
        }
    }

    let detected = DISTROS.iter().find(|d| Some(d.id) == rel.get("ID").map(String::as_str));
    SystemProfile {
        os_id: distro.id.into(),
        os_name: if distro.id == "other" && !chosen { rel.get("NAME").cloned().unwrap_or_else(|| distro.name.into()) } else { distro.name.into() },
        os_chosen: chosen,
        detected_os_id: rel.get("ID").cloned().unwrap_or_default(),
        detected_os_name: detected.map(|d| d.name.to_string()).or_else(|| rel.get("NAME").cloned()).unwrap_or_else(|| "unknown".into()),
        os_options: DISTROS.iter().map(|d| OsOption { id: d.id.into(), name: d.name.into() }).collect(),
        desktop: std::env::var("XDG_CURRENT_DESKTOP").ok().filter(|s| !s.is_empty()),
        session_type: std::env::var("XDG_SESSION_TYPE").ok().filter(|s| !s.is_empty()),
        sessions,
        kernels,
        bootloaders,
        login_screen,
        shell,
        core: core.into_iter().map(|(package, reason)| CorePkg { package, reason }).collect(),
        detected_at: now_iso(),
    }
}

// ── commands ─────────────────────────────────────────────────────────────

pub struct ProfileCache(pub Mutex<Option<SystemProfile>>);

const CHOICE_KEY: &str = "os.choice";

fn compute(db: &Db) -> SystemProfile {
    let choice = setting_get(&db.lock().unwrap(), CHOICE_KEY).filter(|c| !c.is_empty());
    detect(choice.as_deref())
}

/// The learned system. `refresh` re-reads the machine; otherwise the last result is reused.
#[tauri::command]
pub async fn system_profile(db: tauri::State<'_, Db>, cache: tauri::State<'_, ProfileCache>, refresh: bool) -> Result<SystemProfile, String> {
    if !refresh {
        if let Some(p) = cache.0.lock().unwrap().clone() {
            return Ok(p);
        }
    }
    let db = db.inner().clone();
    let p = tauri::async_runtime::spawn_blocking(move || compute(&db)).await.map_err(|e| e.to_string())?;
    *cache.0.lock().unwrap() = Some(p.clone());
    Ok(p)
}

/// Settings: pick the OS by hand (`None` or "" = detect it), then re-learn.
#[tauri::command]
pub async fn os_choice_set(db: tauri::State<'_, Db>, cache: tauri::State<'_, ProfileCache>, id: Option<String>) -> Result<SystemProfile, String> {
    let id = id.unwrap_or_default();
    if !id.is_empty() && !DISTROS.iter().any(|d| d.id == id) {
        return Err(format!("unknown OS: {id}"));
    }
    setting_set(&db.lock().unwrap(), CHOICE_KEY, &id).map_err(|e| e.to_string())?;
    let db = db.inner().clone();
    let p = tauri::async_runtime::spawn_blocking(move || compute(&db)).await.map_err(|e| e.to_string())?;
    *cache.0.lock().unwrap() = Some(p.clone());
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    const QI: &str = "Name            : base\nGroups          : None\nProvides        : None\nDepends On      : glibc>=2.38  sh\n\n\
Name            : bash\nGroups          : None\nProvides        : sh=5.2\nDepends On      : glibc\n\n\
Name            : glibc\nGroups          : None\nProvides        : None\nDepends On      : None\n\n\
Name            : plasma-workspace\nGroups          : plasma\nProvides        : None\nDepends On      : kwin\n                  kio\n\n";

    #[test]
    fn pacman_qi_is_read_with_versions_provides_and_wrapped_lines() {
        let db = parse_qi(QI);
        assert_eq!(db["base"].depends, ["glibc", "sh"]);
        assert_eq!(db["bash"].provides, ["sh"]);
        assert_eq!(db["plasma-workspace"].groups, ["plasma"]);
        assert_eq!(db["plasma-workspace"].depends, ["kwin", "kio"], "continuation line kept");
        assert!(db["glibc"].depends.is_empty());
    }

    #[test]
    fn the_os_comes_from_settings_first_then_os_release() {
        let rel: HashMap<String, String> = [("ID".into(), "cachyos".into()), ("ID_LIKE".into(), "arch".into())].into();
        assert_eq!(effective_os(None, &rel).0.id, "cachyos");
        let (d, chosen) = effective_os(Some("manjaro"), &rel);
        assert_eq!((d.id, chosen), ("manjaro", true));
        let unknown: HashMap<String, String> = [("ID".into(), "someos".into()), ("ID_LIKE".into(), "arch".into())].into();
        assert_eq!(effective_os(None, &unknown).0.id, "other");
        assert_eq!(effective_os(Some("not-a-distro"), &rel).0.id, "cachyos", "a bad choice falls back to detection");
    }

    /// Against the real machine: what an Arch install must always count as core.
    #[test]
    fn this_machine_protects_its_own_core() {
        if !Path::new("/usr/bin/pacman").exists() {
            return;
        }
        let p = detect(None);
        let core: HashSet<&str> = p.core.iter().map(|c| c.package.as_str()).collect();
        for must in ["base", "glibc", "pacman", "systemd", "bash"] {
            assert!(core.contains(must), "{must} not detected as core");
        }
        assert!(!p.kernels.is_empty(), "no kernel found");
        for k in &p.kernels {
            assert!(core.contains(k.as_str()));
        }
    }

    #[test]
    fn only_services_the_machine_needs_make_a_package_system() {
        for yes in ["NetworkManager.service", "systemd-timesyncd.service", "getty@tty1.service", "dbus-broker.service", "power-profiles-daemon.service"] {
            assert!(machine_needs(yes), "{yes}");
        }
        // apps you chose and enabled: yours, not the system
        for no in ["tor.service", "docker.service", "cups.service", "cups.socket", "sshd.service", "ollama.service", "snapd.socket", "avahi-daemon.service"] {
            assert!(!machine_needs(no), "{no}");
        }
    }

    /// Diagnostic: `cargo test system_report -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn system_report() {
        let p = detect(None);
        println!("OS {} (detected {}), desktop {:?}\nsessions {:?}\nkernels {:?}\nbootloaders {:?}\nlogin {:?}\nshell {:?}\ncore: {} packages",
            p.os_name, p.detected_os_name, p.desktop, p.sessions, p.kernels, p.bootloaders, p.login_screen, p.shell, p.core.len());
        for c in p.core.iter().filter(|c| !c.reason.starts_with("needed by")) {
            println!("  {:<32} {}", c.package, c.reason);
        }
    }
}
