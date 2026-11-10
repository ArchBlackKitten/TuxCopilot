// Who may control your keyboard and mouse — a three-way switch, against xdotool or any app taking
// remote control of input. Read without a password:
// KWin's own settings for X11 programs (kwinrc [Xwayland]: XwaylandEisNoPrompt, the always-allowed
// list), and /dev/uinput — where a program can make a fake keyboard or mouse and type without
// any window asking (opened to your account by a udev rule with TAG+="uaccess", e.g. a tablet
// driver's). Changing them is a command, shown first.
//
// A deny-all: KDE has none, and there was a door with no
// window at all: KWin's own D-Bus `org.kde.KWin.EIS.RemoteDesktop.connectToEIS` hands a keyboard
// and mouse to any program of yours (tried with no devices asked for, then hung up). The deny-all
// is built from three locks, each checked here: a session-bus rule refusing that door (and, in
// Block, the portal's RemoteDesktop and InputCapture), Xwayland started without XTEST (what
// xdotool types through), and /dev/uinput closed.

use serde::Serialize;
use std::path::Path;

pub const OUR_RULE: &str = "/etc/udev/rules.d/72-tuxcopilot-uinput.rules";
pub const BUS_RULE: &str = "/etc/dbus-1/session.d/tuxcopilot-input.conf";
pub const XWAYLAND: &str = "/usr/local/bin/Xwayland"; // found before /usr/bin on the PATH: KWin starts it by name
/// What Block changes for these, said before you choose it (the screen has the words).
pub const AFFECTED: &[&str] = &["onboard", "xdotool", "rustdesk", "rustdesk-bin", "keepassxc", "input-leap", "barrier", "deskflow", "krdp"];

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InputControl {
    pub no_prompt: bool,            // KWin lets every X11 program control input without asking
    pub allowed_apps: Vec<String>,  // programs KWin always allows ("always allow apps claiming to be …")
    pub uinput_open: bool,          // your account can write /dev/uinput (a fake keyboard, no window)
    pub uinput_givers: Vec<String>, // the packages whose udev rules open it to you
    pub our_rule: bool,             // TuxCopilot's rule that closes it is in place
    pub ydotool_on: bool,           // ydotool's background service runs or starts with your session
    pub bus_rule: String,           // "" none, "kwin" KWin's windowless door refused, "all" the portal's too
    pub door_shut: Option<bool>,    // KWin's door refuses right now (None: no KWin to ask)
    pub xtest_wrapper: bool,        // TuxCopilot's Xwayland (without XTEST) is in place
    pub xtest_foreign: bool,        // something else sits at /usr/local/bin/Xwayland: left alone
    pub xtest_off_now: Option<bool>, // the running Xwayland has no XTEST (None: none running)
    pub krdp_on: bool,              // KDE's Remote Desktop server starts with your session
    pub affected: Vec<String>,      // of AFFECTED, the ones installed
}

/// Which doors the bus rule's text refuses.
pub fn bus_rule_level(text: &str) -> &'static str {
    match (text.contains("/org/kde/KWin/EIS/RemoteDesktop"), text.contains("org.freedesktop.portal.RemoteDesktop")) {
        (true, true) => "all",
        (true, false) => "kwin",
        _ => "",
    }
}

/// A process's argv (NUL-separated) has `-extension XTEST`.
pub fn argv_drops_xtest(cmdline: &[u8]) -> bool {
    let args: Vec<&[u8]> = cmdline.split(|b| *b == 0).collect();
    args.windows(2).any(|w| w[0] == b"-extension" && w[1] == b"XTEST")
}

/// The running Xwayland servers: only their names are read for every process, and the
/// command line only of those named Xwayland (never anyone's environment).
fn xtest_off_now() -> Option<bool> {
    let mut seen = None;
    for e in std::fs::read_dir("/proc").ok()?.filter_map(|e| e.ok()) {
        let pid = e.file_name();
        if !pid.to_string_lossy().bytes().all(|b| b.is_ascii_digit()) {
            continue;
        }
        if std::fs::read_to_string(e.path().join("comm")).is_ok_and(|c| c.trim() == "Xwayland") {
            let off = std::fs::read(e.path().join("cmdline")).is_ok_and(|c| argv_drops_xtest(&c));
            seen = Some(seen.unwrap_or(true) && off);
        }
    }
    seen
}

/// Asking KWin's door to describe itself (it hands nothing out): refused means shut.
fn door_shut() -> Option<bool> {
    let r = crate::probe::exec(
        &["busctl".into(), "--user".into(), "introspect".into(), "org.kde.KWin".into(), "/org/kde/KWin/EIS/RemoteDesktop".into()],
        std::time::Duration::from_secs(5),
    )?;
    if r.ok() {
        return Some(false);
    }
    r.joined().to_lowercase().replace(' ', "").contains("accessdenied").then_some(true)
}

/// kwinrc's [Xwayland] values for the two keys (KDE's ini: "key=value", lists comma-separated).
pub fn parse_kwinrc(text: &str) -> (bool, Vec<String>) {
    let mut in_group = false;
    let (mut no_prompt, mut apps) = (false, vec![]);
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            in_group = line == "[Xwayland]";
            continue;
        }
        if !in_group {
            continue;
        }
        if let Some(v) = line.strip_prefix("XwaylandEisNoPrompt=") {
            no_prompt = v.trim() == "true";
        } else if let Some(v) = line.strip_prefix("XwaylandEisNoPromptApps=") {
            apps = v.split(',').map(|a| a.trim().to_string()).filter(|a| !a.is_empty()).collect();
        }
    }
    (no_prompt, apps)
}

/// The udev rules (from packages) that give the person at the computer /dev/uinput.
fn uinput_givers() -> Vec<String> {
    let Ok(rd) = std::fs::read_dir("/usr/lib/udev/rules.d") else { return vec![] };
    let mut out: Vec<String> = rd
        .filter_map(|e| e.ok())
        .filter(|e| std::fs::read_to_string(e.path()).is_ok_and(|t| t.lines().any(|l| !l.trim_start().starts_with('#') && l.contains("uinput") && l.contains("uaccess"))))
        .filter_map(|e| {
            let r = crate::probe::exec(&["pacman".into(), "-Qqo".into(), e.path().to_string_lossy().into_owned()], std::time::Duration::from_secs(5))?;
            r.ok().then(|| r.stdout_trim())
        })
        .collect();
    out.sort();
    out.dedup();
    out
}

#[tauri::command]
pub async fn input_control() -> Result<InputControl, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let home = std::env::var("HOME").unwrap_or_default();
        let (no_prompt, allowed_apps) = parse_kwinrc(&std::fs::read_to_string(format!("{home}/.config/kwinrc")).unwrap_or_default());
        let dev = std::ffi::CString::new("/dev/uinput").expect("no NUL");
        // SAFETY: access(2) on a constant path.
        let uinput_open = unsafe { libc::access(dev.as_ptr(), libc::W_OK) } == 0;
        let ydotool_on = ["is-active", "is-enabled"].iter().any(|v| {
            crate::probe::exec(&["systemctl".into(), "--user".into(), (*v).into(), "ydotool.service".into()], std::time::Duration::from_secs(5))
                .is_some_and(|r| matches!(r.stdout_trim().as_str(), "active" | "enabled"))
        });
        let wrapper = std::fs::read_to_string(XWAYLAND).ok();
        let krdp_on = crate::probe::exec(
            &["systemctl".into(), "--user".into(), "is-enabled".into(), "app-org.kde.krdpserver.service".into()],
            std::time::Duration::from_secs(5),
        )
        .is_some_and(|r| r.stdout_trim() == "enabled");
        let mut q: Vec<String> = vec!["pacman".into(), "-Qq".into()];
        q.extend(AFFECTED.iter().map(|s| s.to_string()));
        // pacman answers a name another package provides with that package (rustdesk: rustdesk-bin)
        let mut affected = crate::probe::exec(&q, std::time::Duration::from_secs(5)).map(|r| r.lines()).unwrap_or_default();
        affected.sort();
        affected.dedup();
        InputControl {
            no_prompt,
            allowed_apps,
            uinput_open,
            uinput_givers: uinput_givers(),
            our_rule: Path::new(OUR_RULE).exists(),
            ydotool_on,
            bus_rule: bus_rule_level(&std::fs::read_to_string(BUS_RULE).unwrap_or_default()).into(),
            door_shut: door_shut(),
            xtest_wrapper: wrapper.as_deref().is_some_and(|w| w.contains("TuxCopilot") && w.contains("-extension XTEST")),
            xtest_foreign: wrapper.as_deref().is_some_and(|w| !w.contains("TuxCopilot")) || (Path::new(XWAYLAND).exists() && wrapper.is_none()),
            xtest_off_now: xtest_off_now(),
            krdp_on,
            affected,
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kwins_settings_are_read_from_their_group_only() {
        let rc = "[Xwayland]\nScale=1\nXwaylandEisNoPrompt=true\nXwaylandEisNoPromptApps=xdotool, steam\n\n[Other]\nXwaylandEisNoPrompt=false\n";
        assert_eq!(parse_kwinrc(rc), (true, vec!["xdotool".to_string(), "steam".to_string()]));
        assert_eq!(parse_kwinrc("[Xwayland]\nScale=1\n"), (false, vec![]));
        assert_eq!(parse_kwinrc("[Other]\nXwaylandEisNoPrompt=true\n"), (false, vec![]), "another group's key is not KWin's");
        assert_eq!(parse_kwinrc("[Xwayland]\nXwaylandEisNoPromptApps=\n"), (false, vec![]));
    }

    #[test]
    fn the_locks_are_read_from_what_is_written() {
        let kwin = "<deny send_destination=\"org.kde.KWin\" send_path=\"/org/kde/KWin/EIS/RemoteDesktop\"/>";
        let portal = "<deny send_destination=\"org.freedesktop.portal.Desktop\" send_interface=\"org.freedesktop.portal.RemoteDesktop\"/>";
        assert_eq!(bus_rule_level(""), "");
        assert_eq!(bus_rule_level(kwin), "kwin");
        assert_eq!(bus_rule_level(&format!("{kwin}{portal}")), "all");
        assert_eq!(bus_rule_level(portal), "", "the portal refused but KWin's door open is not a lock");
        assert!(argv_drops_xtest(b"/usr/bin/Xwayland\0:1\0-rootless\0-extension\0XTEST\0"));
        assert!(!argv_drops_xtest(b"/usr/bin/Xwayland\0:1\0-rootless\0"));
        assert!(!argv_drops_xtest(b"/usr/bin/Xwayland\0+extension\0XTEST\0"), "+extension turns it on");
        assert!(!argv_drops_xtest(b"/usr/bin/Xwayland\0-extension\0XTESTX\0"));
    }

    /// This computer, as it is: run by hand — cargo test this_computer_input -- --ignored --nocapture
    #[test]
    #[ignore]
    fn this_computer_input() {
        println!("{:?}", tauri::async_runtime::block_on(input_control()).unwrap());
    }
}
