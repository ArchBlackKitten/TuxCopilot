// Security → Network, the firewall: which firewall is on (firewalld, ufw — Arch turns none on by itself),
// and for firewalld, each zone in use: its connections and what it lets in.
//
// Read from firewalld's own files (/etc/firewalld over /usr/lib/firewalld, both readable by
// anyone) and NetworkManager (which zone each connection uses) — never with firewall-cmd,
// which asks for your password even to read on some systems.
// Only a change you choose asks for a password: it runs as a command, shown first.

use crate::probe::exec;
use serde::Serialize;
use std::path::Path;
use std::time::Duration;

const ETC: &str = "/etc/firewalld";
const LIB: &str = "/usr/lib/firewalld";

#[derive(Serialize, Debug, PartialEq, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Zone {
    pub name: String,
    pub short: String,
    pub description: String,
    pub default: bool,
    pub target: String,
    pub connections: Vec<String>, // the network connections (or interfaces) in this zone
    pub services: Vec<String>,
    pub ports: Vec<String>, // 8080/tcp, 1714-1764/udp
    pub masquerade: bool,
    pub changed: bool, // you (or a tool) changed it: it is in /etc/firewalld
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirewallState {
    pub firewalld_installed: bool,
    pub firewalld_on: bool,
    pub ufw_installed: bool,
    pub ufw_on: bool,
    pub default_zone: Option<String>,
    pub zones: Vec<Zone>, // the zones in use, the default one first
    pub service_ports: Vec<(String, String, Vec<String>)>, // service, its name, what it opens
    pub networks: Vec<Network>, // NetworkManager's active connections
    pub preset_zones: Vec<Zone>, // the zones Fluff's presets use (public, home, drop), in use or not
}

/// One active network connection, and the zone it asks for ("" = the default zone).
#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Network {
    pub name: String,
    pub uuid: String,
    pub device: String,
    pub kind: String,
    pub zone: String,
}

/// The zones Fluff's presets set up.
pub const PRESET_ZONES: [&str; 3] = ["public", "home", "drop"];

/// The value of `attr="…"` in `tag`.
fn attr(tag: &str, attr: &str) -> Option<String> {
    let key = format!("{attr}=\"");
    let start = tag.find(&key)? + key.len();
    Some(tag[start..].split('"').next()?.to_string())
}

/// Every `<name …>` tag in the text.
fn tags<'a>(xml: &'a str, name: &str) -> Vec<&'a str> {
    let open = format!("<{name}");
    xml.match_indices(&open)
        .filter(|(i, _)| xml[i + open.len()..].starts_with([' ', '/', '>', '\n', '\t']))
        .filter_map(|(i, _)| xml[i..].find('>').map(|e| &xml[i..i + e + 1]))
        .collect()
}

fn text_of(xml: &str, name: &str) -> String {
    let (open, close) = (format!("<{name}>"), format!("</{name}>"));
    xml.find(&open).and_then(|s| xml[s + open.len()..].find(&close).map(|e| xml[s + open.len()..s + open.len() + e].trim().to_string())).unwrap_or_default()
}

/// A zone file → the zone (name from the file name).
pub fn parse_zone(name: &str, xml: &str) -> Zone {
    Zone {
        name: name.into(),
        short: text_of(xml, "short"),
        description: text_of(xml, "description"),
        target: tags(xml, "zone").first().and_then(|t| attr(t, "target")).unwrap_or_else(|| "default".into()),
        connections: tags(xml, "interface").iter().filter_map(|t| attr(t, "name")).chain(tags(xml, "source").iter().filter_map(|t| attr(t, "address"))).collect(),
        services: tags(xml, "service").iter().filter_map(|t| attr(t, "name")).collect(),
        ports: tags(xml, "port").iter().filter_map(|t| Some(format!("{}/{}", attr(t, "port")?, attr(t, "protocol")?))).collect(),
        masquerade: !tags(xml, "masquerade").is_empty(),
        ..Default::default()
    }
}

/// A service file → its name and the ports it opens.
pub fn parse_service(xml: &str) -> (String, Vec<String>) {
    (text_of(xml, "short"), tags(xml, "port").iter().filter_map(|t| Some(format!("{}/{}", attr(t, "port")?, attr(t, "protocol")?))).collect())
}

/// firewalld.conf's DefaultZone.
pub fn default_zone(conf: &str) -> Option<String> {
    conf.lines().find_map(|l| l.trim().strip_prefix("DefaultZone=")).map(|z| z.trim().to_string()).filter(|z| !z.is_empty())
}

fn plain_name(n: &str) -> bool {
    !n.is_empty() && n.len() <= 64 && n.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
}

/// The file for a zone or service: yours (/etc) over the default (/usr/lib).
fn read(kind: &str, name: &str) -> Option<(String, bool)> {
    if !plain_name(name) {
        return None;
    }
    std::fs::read_to_string(format!("{ETC}/{kind}/{name}.xml")).map(|t| (t, true)).or_else(|_| std::fs::read_to_string(format!("{LIB}/{kind}/{name}.xml")).map(|t| (t, false))).ok()
}

fn run(argv: &[&str]) -> Option<crate::probe::ExecResult> {
    exec(&argv.iter().map(|s| s.to_string()).collect::<Vec<_>>(), Duration::from_secs(10))
}

/// NetworkManager's active connections and the zone each asks for ("" = the default zone).
fn connection_zones() -> Vec<Network> {
    let active = run(&["nmcli", "-t", "-f", "NAME,UUID,DEVICE,TYPE", "connection", "show", "--active"]).map(|r| r.stdout_text()).unwrap_or_default();
    active
        .lines()
        .filter_map(|l| {
            // nmcli -t escapes ":" inside a field as "\:"
            let parts: Vec<String> = l.replace("\\:", "\u{1}").split(':').map(|p| p.replace('\u{1}', ":")).collect();
            let [name, uuid, device, kind] = parts.as_slice() else { return None };
            if kind == "loopback" {
                return None;
            }
            let zone = run(&["nmcli", "-g", "connection.zone", "connection", "show", "uuid", uuid]).map(|r| r.stdout_trim()).unwrap_or_default();
            Some(Network { name: name.clone(), uuid: uuid.clone(), device: device.clone(), kind: kind.clone(), zone })
        })
        .collect()
}

#[tauri::command]
pub async fn firewall_state() -> Result<FirewallState, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let has = |b: &str| ["/usr/bin", "/usr/sbin", "/usr/local/bin"].iter().any(|d| Path::new(d).join(b).is_file());
        let active = |u: &str| run(&["systemctl", "is-active", u]).is_some_and(|r| r.stdout_trim() == "active");
        let firewalld_on = active("firewalld.service");
        let default = std::fs::read_to_string(format!("{ETC}/firewalld.conf")).ok().and_then(|c| default_zone(&c));
        let mut zones: Vec<Zone> = vec![];
        let mut service_ports = vec![];
        let mut networks = vec![];
        let mut preset_zones = vec![];
        if firewalld_on {
            let mut uses: Vec<(String, String)> = vec![]; // zone, connection
            for n in connection_zones() {
                let label = format!("{} ({})", n.name, n.device);
                // Docker puts its own networks in its zone while it runs
                let zone = if n.zone.is_empty() && (n.device == "docker0" || n.device.starts_with("br-")) && read("zones", "docker").is_some() { "docker".to_string() } else { n.zone.clone() };
                uses.push((if zone.is_empty() { default.clone().unwrap_or_default() } else { zone }, label));
                networks.push(n);
            }
            for n in PRESET_ZONES {
                if let Some((xml, changed)) = read("zones", n) {
                    let mut z = parse_zone(n, &xml);
                    z.changed = changed;
                    z.default = default.as_deref() == Some(n);
                    preset_zones.push(z);
                }
            }
            let mut names: Vec<String> = uses.iter().map(|(z, _)| z.clone()).chain(default.clone()).collect();
            names.sort();
            names.dedup();
            for n in names {
                let Some((xml, changed)) = read("zones", &n) else { continue };
                let mut z = parse_zone(&n, &xml);
                z.changed = changed;
                z.default = default.as_deref() == Some(n.as_str());
                z.connections.extend(uses.iter().filter(|(zn, _)| *zn == n).map(|(_, c)| c.clone()));
                zones.push(z);
            }
            zones.sort_by_key(|z| !z.default);
            let mut seen: Vec<String> = zones.iter().chain(&preset_zones).flat_map(|z| z.services.clone()).collect();
            seen.sort();
            seen.dedup();
            for s in seen {
                if let Some((xml, _)) = read("services", &s) {
                    let (short, ports) = parse_service(&xml);
                    service_ports.push((s, short, ports));
                }
            }
        }
        FirewallState { firewalld_installed: has("firewall-cmd"), firewalld_on, ufw_installed: has("ufw"), ufw_on: active("ufw.service"), default_zone: default, zones, service_ports, networks, preset_zones }
    })
    .await
    .map_err(|e| e.to_string())
}

/// DNS as systemd-resolved has it: whether it runs, what `resolvectl status` says (read by the
/// screen), and TuxCopilot's own settings file if there is one. Asks for no password.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsState {
    pub resolved_on: bool,
    pub status: String,
    pub ours: Option<String>,
}

pub const DNS_FILE: &str = "/etc/systemd/resolved.conf.d/tuxcopilot-dns.conf";

#[tauri::command]
pub async fn dns_state() -> Result<DnsState, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let resolved_on = run(&["systemctl", "is-active", "systemd-resolved.service"]).is_some_and(|r| r.stdout_trim() == "active");
        let status = if resolved_on { run(&["resolvectl", "status", "--no-pager"]).map(|r| r.stdout_text()).unwrap_or_default() } else { String::new() };
        DnsState { resolved_on, status, ours: std::fs::read_to_string(DNS_FILE).ok() }
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_zone_is_read_from_its_file() {
        let z = parse_zone("public", "<?xml version=\"1.0\"?>\n<zone>\n  <short>Public</short>\n  <description>For use in public areas.</description>\n  <service name=\"ssh\"/>\n  <service name=\"dhcpv6-client\"/>\n  <port port=\"8080\" protocol=\"tcp\"/>\n  <interface name=\"wlan0\"/>\n  <forward/>\n</zone>\n");
        assert_eq!(z.short, "Public");
        assert_eq!(z.target, "default");
        assert_eq!(z.services, ["ssh", "dhcpv6-client"]);
        assert_eq!(z.ports, ["8080/tcp"]);
        assert_eq!(z.connections, ["wlan0"]);
        assert!(!z.masquerade);
        let d = parse_zone("docker", "<zone version=\"1.0\" target=\"ACCEPT\">\n  <short>docker</short>\n  <masquerade/>\n</zone>");
        assert_eq!((d.target.as_str(), d.masquerade), ("ACCEPT", true));
        assert!(parse_zone("x", "<zone><services/></zone>").services.is_empty(), "<services> is not <service>");
    }

    #[test]
    fn services_and_the_default_zone() {
        assert_eq!(parse_service("<service>\n  <short>KDE Connect</short>\n  <port port=\"1714-1764\" protocol=\"tcp\"/>\n  <port port=\"1714-1764\" protocol=\"udp\"/>\n</service>"), ("KDE Connect".into(), vec!["1714-1764/tcp".into(), "1714-1764/udp".into()]));
        assert_eq!(default_zone("# comment\nDefaultZone=public\nLogDenied=off\n").as_deref(), Some("public"));
        assert_eq!(default_zone("DefaultZone=\n"), None);
        assert!(read("zones", "../../etc/shadow").is_none() && !plain_name("a b"));
    }

    #[test]
    fn reading_never_runs_firewall_cmd() {
        // firewall-cmd may ask for a password even to read: this file only checks it exists
        let src = include_str!("firewall.rs");
        let code = &src[..src.find("#[cfg(test)]").unwrap()];
        assert!(!code.contains("[\"firewall-cmd\""), "firewall-cmd is never run here");
        assert_eq!(code.matches("\"firewall-cmd\"").count(), 1, "only has(\"firewall-cmd\")");
    }

    /// The real computer (no password asked): `cargo test this_computer_firewall -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn this_computer_firewall() {
        let f = tauri::async_runtime::block_on(firewall_state()).unwrap();
        println!("firewalld {} on {} · ufw {} on {} · default {:?} · zones {:?}", f.firewalld_installed, f.firewalld_on, f.ufw_installed, f.ufw_on, f.default_zone, f.zones.iter().map(|z| (&z.name, z.default, &z.services, z.connections.len())).collect::<Vec<_>>());
        println!("preset zones {:?} · networks {:?}", f.preset_zones.iter().map(|z| (&z.name, &z.target, &z.services)).collect::<Vec<_>>(), f.networks.iter().map(|n| (&n.kind, &n.device, &n.zone)).collect::<Vec<_>>());
    }
}
