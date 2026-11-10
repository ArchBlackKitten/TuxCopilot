// USBGuard: a USB stick that
// pretends to be a keyboard ("BadUSB") types commands faster than you can see. With USBGuard on,
// a USB device that wasn't plugged in when you switched it on is blocked until you allow it.
// Read without a password: whether it is installed, running, starting at boot, and — through a
// "list only" access file TuxCopilot gives your account (it can't allow anything) — the devices it
// blocked. /etc/usbguard itself is root's alone, so the commands check its files as root.

use serde::Serialize;
use std::path::Path;
use std::time::Duration;

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UsbDevice {
    pub number: u32,           // USBGuard's own number for it (what allow-device takes)
    pub id: String,            // vendor:product
    pub name: String,
    pub interfaces: Vec<String>, // class:subclass:protocol
    pub port: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsbGuard {
    pub installed: bool,
    pub active: bool,
    pub enabled: bool,
    pub blocked: Option<Vec<UsbDevice>>, // None: it couldn't be asked (not running, or no access)
}

/// The value after `key` in a USBGuard rule: a "quoted" string, a { list }, or one word.
fn value_after(rule: &str, key: &str) -> Option<String> {
    let at = rule.find(&format!(" {key} "))? + key.len() + 2;
    let rest = &rule[at..];
    if let Some(q) = rest.strip_prefix('"') {
        let mut out = String::new();
        let mut chars = q.chars();
        while let Some(c) = chars.next() {
            match c {
                '\\' => out.extend(chars.next()),
                '"' => return Some(out),
                c => out.push(c),
            }
        }
        None
    } else if let Some(l) = rest.strip_prefix('{') {
        Some(l[..l.find('}')?].trim().to_string())
    } else {
        rest.split_whitespace().next().map(String::from)
    }
}

/// `usbguard list-devices -b`: "12: block id 046d:c31c serial "" name "USB Keyboard" … with-interface { 03:01:01 03:00:00 } …"
pub fn parse_devices(text: &str) -> Vec<UsbDevice> {
    text.lines()
        .filter_map(|l| {
            let (n, rule) = l.split_once(": ")?;
            let rule = format!(" {rule} ");
            Some(UsbDevice {
                number: n.trim().parse().ok()?,
                id: value_after(&rule, "id")?,
                name: value_after(&rule, "name").unwrap_or_default(),
                interfaces: value_after(&rule, "with-interface").map(|v| v.split_whitespace().map(String::from).collect()).unwrap_or_default(),
                port: value_after(&rule, "via-port").unwrap_or_default(),
            })
        })
        .collect()
}

fn run(argv: &[&str]) -> Option<crate::probe::ExecResult> {
    crate::probe::exec(&argv.iter().map(|s| s.to_string()).collect::<Vec<_>>(), Duration::from_secs(10))
}

#[tauri::command]
pub async fn usbguard_state() -> UsbGuard {
    tauri::async_runtime::spawn_blocking(|| {
        let installed = Path::new("/usr/bin/usbguard").exists();
        let sc = |v: &str| run(&["systemctl", v, "usbguard.service"]).is_some_and(|r| matches!(r.stdout_trim().as_str(), "active" | "enabled"));
        let active = installed && sc("is-active");
        let blocked = if active { run(&["usbguard", "list-devices", "--blocked"]).filter(|r| r.ok()).map(|r| parse_devices(&r.stdout_text())) } else { None };
        UsbGuard { installed, active, enabled: installed && sc("is-enabled"), blocked }
    })
    .await
    .unwrap_or(UsbGuard { installed: false, active: false, enabled: false, blocked: None })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocked_devices_are_read_from_usbguards_own_lines() {
        let text = concat!(
            "12: block id 046d:c31c serial \"\" name \"USB \\\"Pro\\\" Keyboard\" hash \"abc=\" parent-hash \"def=\" via-port \"1-2\" with-interface { 03:01:01 03:00:00 } with-connect-type \"hotplug\"\n",
            "13: block id 0781:5581 serial \"4C53\" name \"Ultra\" hash \"x\" parent-hash \"y\" via-port \"2-1\" with-interface 08:06:50 with-connect-type \"hotplug\"\n",
            "not a device line\n",
        );
        let d = parse_devices(text);
        assert_eq!(d.len(), 2);
        assert_eq!(d[0], UsbDevice { number: 12, id: "046d:c31c".into(), name: "USB \"Pro\" Keyboard".into(), interfaces: vec!["03:01:01".into(), "03:00:00".into()], port: "1-2".into() });
        assert_eq!((d[1].number, d[1].interfaces.clone(), d[1].name.as_str()), (13, vec!["08:06:50".to_string()], "Ultra"));
        assert_eq!(value_after(" a name \"x\" ", "id"), None);
        assert_eq!(value_after(" id 1:2 hash \"h\" ", "hash"), Some("h".into()), "parent-hash is not hash");
    }

    /// This computer: `cargo test this_computer_usbguard -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn this_computer_usbguard() {
        println!("{:?}", tauri::async_runtime::block_on(usbguard_state()));
    }
}
