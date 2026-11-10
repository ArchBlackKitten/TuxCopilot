// Programs talking to the internet now: every established
// connection to another computer, by program — `ss`, as you: your own programs are named; the
// system's aren't (only root may see which). Addresses only: looking up their names would itself
// ask the internet. Connections inside this computer (127.0.0.1, ::1) are left out.

use serde::Serialize;
use std::time::Duration;

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Conn {
    pub proto: String, // tcp / udp
    pub local: String,
    pub peer: String,  // address:port
    pub program: String, // "" when only root may see it
    pub pid: Option<u32>,
    pub package: String, // the package its program comes from ("" unknown)
}

/// The address part of "addr:port" / "[v6]:port" / "addr%iface:port".
pub fn host_of(ep: &str) -> &str {
    let h = ep.rsplit_once(':').map_or(ep, |(h, _)| h);
    let h = h.trim_start_matches('[').trim_end_matches(']');
    h.split('%').next().unwrap_or(h)
}

pub fn loopback(host: &str) -> bool {
    host.starts_with("127.") || host == "::1" || host == "::ffff:127.0.0.1" || host == "localhost"
}

/// `ss -tunpH state established`: Netid Recv-Q Send-Q Local Peer [users:(("name",pid=N,fd=M))]
pub fn parse_ss(text: &str) -> Vec<Conn> {
    text.lines()
        .filter_map(|l| {
            let w: Vec<&str> = l.split_whitespace().collect();
            if w.len() < 5 {
                return None;
            }
            let (proto, local, peer) = (w[0], w[3], w[4]);
            if loopback(host_of(peer)) || peer.ends_with(":*") {
                return None;
            }
            let users = w.get(5).copied().unwrap_or("");
            let program = users.split("((\"").nth(1).and_then(|r| r.split('"').next()).unwrap_or("").to_string();
            let pid = users.split("pid=").nth(1).and_then(|r| r.split(|c: char| !c.is_ascii_digit()).next()).and_then(|p| p.parse().ok());
            Some(Conn { proto: proto.into(), local: local.into(), peer: peer.into(), program, pid, package: String::new() })
        })
        .collect()
}

#[tauri::command]
pub async fn connections() -> Vec<Conn> {
    tauri::async_runtime::spawn_blocking(|| {
        let argv: Vec<String> = ["ss", "-tunpH", "state", "established"].map(String::from).to_vec();
        let mut out = crate::probe::exec(&argv, Duration::from_secs(10)).map(|r| parse_ss(&r.stdout_text())).unwrap_or_default();
        // the package each program comes from: its executable (yours, so readable), asked of pacman
        let mut known: std::collections::HashMap<u32, String> = Default::default();
        for c in &mut out {
            let Some(pid) = c.pid else { continue };
            let pkg = known.entry(pid).or_insert_with(|| {
                std::fs::read_link(format!("/proc/{pid}/exe"))
                    .ok()
                    .and_then(|exe| crate::probe::exec(&["pacman".into(), "-Qqo".into(), exe.to_string_lossy().into_owned()], Duration::from_secs(5)))
                    .filter(|r| r.ok())
                    .map(|r| r.stdout_trim())
                    .unwrap_or_default()
            });
            c.package = pkg.clone();
        }
        out
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connections_are_read_and_the_computers_own_left_out() {
        let ss = concat!(
            "tcp 0 0 192.168.0.9:43622 140.82.112.4:443 users:((\"codium\",pid=1234,fd=55))\n",
            "tcp 0 0 127.0.0.1:38276 127.0.0.1:5173 users:((\"WebKitNetworkPr\",pid=9,fd=15))\n",
            "udp 0 0 192.168.0.9%wlan0:68 192.168.0.1:67\n",
            "tcp 0 0 [2001:db8::5]:51000 [2606:4700::1111]:853\n",
            "tcp 0 0 [::1]:1 [::1]:2\n",
            "short line\n",
        );
        let c = parse_ss(ss);
        assert_eq!(c.len(), 3);
        assert_eq!((c[0].program.as_str(), c[0].pid, c[0].peer.as_str()), ("codium", Some(1234), "140.82.112.4:443"));
        assert_eq!((c[1].program.as_str(), c[1].pid), ("", None), "the system's: only root may see which");
        assert_eq!(host_of(&c[2].peer), "2606:4700::1111");
        assert_eq!(host_of("192.168.0.9%wlan0:68"), "192.168.0.9");
    }

    /// This computer (counts only): `cargo test this_computer_conns -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn this_computer_conns() {
        let c = tauri::async_runtime::block_on(connections());
        println!("{} connections, {} named, packages {:?}", c.len(), c.iter().filter(|x| !x.program.is_empty()).count(), c.iter().map(|x| x.package.as_str()).filter(|p| !p.is_empty()).collect::<std::collections::BTreeSet<_>>());
    }
}
