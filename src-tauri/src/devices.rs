// Security: USB sticks, USB disks and SD cards (Allow / Ask / Block), and the groups
// that hand out root (docker's too), out and back in.
//
// Read without a password: what polkit answers *you* right now for opening a removable drive and
// for unlocking an encrypted one (pkcheck: 0 allowed, 2 asks for your password, 1 refused; the two
// differing is "mixed") — the rule file itself sits in
// /etc/polkit-1/rules.d, which only polkit may read; the driver rule in /etc/modprobe.d; which
// storage drivers are loaded; whether the system itself starts from USB or an SD card (then Block
// is refused); and /etc/group with this login's own groups.

use serde::Serialize;
use std::path::Path;
use std::time::Duration;

pub const DRIVER_RULE: &str = "/etc/modprobe.d/tuxcopilot-storage.conf";
pub const STORAGE_DRIVERS: &[&str] = &["usb_storage", "uas", "mmc_block"];

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StorageControl {
    pub mount: String,          // polkit, for you, now: "yes" | "ask" | "no" | "mixed" | "" (couldn't ask)
    pub driver_rule: bool,      // TuxCopilot's rule refusing the drivers is there
    pub loaded: Vec<String>,    // of the storage drivers, the ones loaded now (a stick or card is in)
    pub system_removable: bool, // / or /boot is on USB or an SD card: never Block
}

/// pkcheck's exit code → what it means.
pub fn pk_answer(code: Option<i32>) -> &'static str {
    match code {
        Some(0) => "yes",
        Some(2) => "ask",
        Some(1) => "no",
        _ => "",
    }
}

/// The actions storage-control.ts's OWN_SEAT names: opening a removable drive, unlocking an encrypted one.
pub const OWN_SEAT: &[&str] = &["org.freedesktop.udisks2.filesystem-mount", "org.freedesktop.udisks2.encrypted-unlock"];

/// polkit's answers for both → one: the same answer, or "mixed"; any not given is "" (couldn't ask).
pub fn both(answers: &[&str]) -> String {
    if answers.contains(&"") {
        String::new()
    } else if answers.windows(2).all(|w| w[0] == w[1]) {
        answers.first().copied().unwrap_or("").to_string()
    } else {
        "mixed".to_string()
    }
}

/// `lsblk -s -n -r -o NAME,TRAN <device>` (the device and what it sits on): any part on USB or an SD card.
pub fn on_removable(lsblk: &str) -> bool {
    lsblk.lines().any(|l| {
        let mut w = l.split_whitespace();
        let (name, tran) = (w.next().unwrap_or(""), w.next().unwrap_or(""));
        tran == "usb" || tran == "mmc" || name.starts_with("mmcblk")
    })
}

fn exec(argv: &[&str], secs: u64) -> Option<crate::probe::ExecResult> {
    crate::probe::exec(&argv.iter().map(|s| s.to_string()).collect::<Vec<_>>(), Duration::from_secs(secs))
}

#[tauri::command]
pub async fn storage_control() -> StorageControl {
    tauri::async_runtime::spawn_blocking(|| {
        let me = std::process::id().to_string();
        let answers: Vec<&str> = OWN_SEAT.iter().map(|a| pk_answer(exec(&["pkcheck", "--action-id", a, "--process", &me], 10).and_then(|r| r.code()))).collect();
        let mount = both(&answers);
        let modules = std::fs::read_to_string("/proc/modules").unwrap_or_default();
        let loaded = STORAGE_DRIVERS.iter().filter(|d| modules.lines().any(|l| l.split(' ').next() == Some(**d))).map(|d| d.to_string()).collect();
        let system_removable = ["/", "/boot"].iter().any(|m| {
            exec(&["findmnt", "-n", "-o", "SOURCE", "--target", m], 5)
                .map(|r| r.stdout_trim())
                .filter(|s| s.starts_with("/dev/"))
                .is_some_and(|dev| exec(&["lsblk", "-s", "-n", "-r", "-o", "NAME,TRAN", &dev], 5).is_some_and(|r| on_removable(&r.stdout_text())))
        });
        StorageControl { mount, driver_rule: Path::new(DRIVER_RULE).exists(), loaded, system_removable }
    })
    .await
    .unwrap_or(StorageControl { mount: String::new(), driver_rule: false, loaded: vec![], system_removable: true })
}

// ── your groups (any group, wheel too) ─────

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub name: String,
    pub gid: u32,
    pub listed: bool,      // /etc/group lists you (sudo reads this at once; a login, from the next one)
    pub this_login: bool,  // this login has it now
    pub primary: bool,     // your own group (your files are made in it): never taken away
    pub others: usize,     // how many other people are in it (for wheel: someone else who can sudo)
}

/// Every group in /etc/group, as it stands for `user`.
pub fn groups_of(etc_group: &str, user: &str, primary_gid: u32, this_login: &[u32]) -> Vec<Group> {
    etc_group
        .lines()
        .filter_map(|l| {
            let f: Vec<&str> = l.split(':').collect();
            if f.len() < 4 || f[0].is_empty() {
                return None;
            }
            let gid: u32 = f[2].parse().ok()?;
            let members: Vec<&str> = f[3].split(',').map(str::trim).filter(|m| !m.is_empty()).collect();
            Some(Group {
                name: f[0].to_string(),
                gid,
                listed: members.contains(&user) || gid == primary_gid,
                this_login: this_login.contains(&gid),
                primary: gid == primary_gid,
                others: members.iter().filter(|m| **m != user).count(),
            })
        })
        .collect()
}

fn this_login_groups() -> Vec<u32> {
    // SAFETY: getgroups with a buffer of the size it reported first
    let n = unsafe { libc::getgroups(0, std::ptr::null_mut()) };
    let mut v = vec![0 as libc::gid_t; n.max(0) as usize];
    if n > 0 {
        let got = unsafe { libc::getgroups(n, v.as_mut_ptr()) };
        v.truncate(got.max(0) as usize);
    }
    v.push(unsafe { libc::getgid() });
    v
}

#[tauri::command]
pub async fn my_groups() -> Vec<Group> {
    tauri::async_runtime::spawn_blocking(|| {
        let etc = std::fs::read_to_string("/etc/group").unwrap_or_default();
        let user = std::env::var("USER").unwrap_or_default();
        groups_of(&etc, &user, unsafe { libc::getgid() }, &this_login_groups())
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn polkits_answers_in_words() {
        assert_eq!([pk_answer(Some(0)), pk_answer(Some(2)), pk_answer(Some(1)), pk_answer(Some(127)), pk_answer(None)], ["yes", "ask", "no", "", ""]);
    }

    #[test]
    fn opening_and_unlocking_read_as_one_answer() {
        assert_eq!(both(&["ask", "ask"]), "ask");
        assert_eq!(both(&["no", "no"]), "no");
        assert_eq!(both(&["yes", "ask"]), "mixed");
        assert_eq!(both(&["yes", ""]), "", "one unanswered: couldn't ask, never a guess");
    }

    #[test]
    fn a_system_on_usb_or_an_sd_card_is_seen() {
        assert!(!on_removable("luks-6073 \nnvme0n1p7 nvme\nnvme0n1 nvme\n"));
        assert!(on_removable("sda2 usb\nsda usb\n"));
        assert!(on_removable("mmcblk0p2 \nmmcblk0 \n"), "an SD card or eMMC, whatever lsblk calls its transport");
        assert!(on_removable("x mmc\n"));
        assert!(!on_removable(""));
    }

    #[test]
    fn every_group_is_read_as_it_stands_for_you() {
        let g = "root:x:0:root\nwheel:x:998:penguin,alice\ndocker:x:961:alice,penguin\nlibvirt:x:960:\ndockerx:x:1:\npenguin:x:1000:\nbroken line\n";
        let all = groups_of(g, "penguin", 1000, &[998, 961, 1000]);
        let by = |n: &str| all.iter().find(|x| x.name == n).unwrap();
        assert_eq!(all.len(), 6, "the broken line is left out");
        assert_eq!(by("wheel"), &Group { name: "wheel".into(), gid: 998, listed: true, this_login: true, primary: false, others: 1 });
        assert!(by("docker").listed && by("docker").this_login);
        assert!(!by("libvirt").listed && !by("libvirt").this_login);
        assert!(!by("dockerx").listed, "a name beginning the same is not it");
        assert!(by("penguin").primary && by("penguin").listed, "your own group, even with no members listed");
        assert_eq!(by("root").others, 1);
    }

    /// This computer: `cargo test this_computer_devices -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn this_computer_devices() {
        println!("{:?}", tauri::async_runtime::block_on(storage_control()));
        for g in tauri::async_runtime::block_on(my_groups()).into_iter().filter(|g| g.listed || g.this_login) {
            println!("{g:?}");
        }
    }
}
