// Fluff's security check (Apps): the installed packages Arch's security tracker lists as
// vulnerable — security.archlinux.org's issues (the same list arch-audit reads), each matched
// against what is installed here with pacman's own version order (vercmp). Only the tracker's
// public list is fetched; nothing about this computer is sent.

use crate::probe::exec;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

const TRACKER: &str = "https://security.archlinux.org/issues/all.json";

#[derive(Deserialize, Debug, Clone)]
pub struct Issue {
    pub name: String, // AVG-1234
    pub packages: Vec<String>,
    pub status: String, // "Vulnerable" | "Fixed" | "Not affected" | "Unknown"
    pub severity: String, // "Critical" | "High" | "Medium" | "Low" | "Unknown"
    #[serde(rename = "type")]
    pub kind: String, // "arbitrary code execution", "denial of service", …
    pub affected: String,
    pub fixed: Option<String>,
    pub issues: Vec<String>, // CVE-…
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub package: String,
    pub installed: String,
    pub group: String, // AVG-1234
    pub severity: String,
    pub kind: String,
    pub fixed: Option<String>, // the version that fixes it (None: no fix yet)
    pub cves: Vec<String>,
    pub explicit: bool, // an app you installed (pacman -Qe), not a part other apps need
}

/// pacman's own version order: <0 when a is older than b.
fn vercmp(a: &str, b: &str) -> Option<i32> {
    exec(&["vercmp".into(), a.into(), b.into()], Duration::from_secs(5)).and_then(|r| r.stdout_trim().parse().ok())
}

/// `pacman -Q` lines → name → version.
pub fn installed_from(q: &str) -> HashMap<String, String> {
    q.lines().filter_map(|l| l.split_once(' ')).map(|(n, v)| (n.to_string(), v.trim().to_string())).collect()
}

/// Is `installed` within the issue: not older than its affected version, older than its fix.
pub fn affects(issue: &Issue, installed: &str, cmp: &dyn Fn(&str, &str) -> Option<i32>) -> bool {
    if issue.status == "Not affected" {
        return false;
    }
    if cmp(installed, &issue.affected).is_none_or(|c| c < 0) {
        return false;
    }
    match &issue.fixed {
        Some(f) if !f.is_empty() => cmp(installed, f).is_some_and(|c| c < 0),
        _ => issue.status == "Vulnerable",
    }
}

pub fn findings(issues: &[Issue], installed: &HashMap<String, String>, explicit: &std::collections::HashSet<String>, cmp: &dyn Fn(&str, &str) -> Option<i32>) -> Vec<Finding> {
    let rank = |s: &str| ["Critical", "High", "Medium", "Low"].iter().position(|x| *x == s).unwrap_or(4);
    let mut out: Vec<Finding> = issues
        .iter()
        .flat_map(|i| i.packages.iter().filter_map(move |p| installed.get(p).map(|v| (i, p, v))))
        .filter(|(i, _, v)| affects(i, v, cmp))
        .map(|(i, p, v)| Finding { package: p.clone(), installed: v.clone(), group: i.name.clone(), severity: i.severity.clone(), kind: i.kind.clone(), fixed: i.fixed.clone().filter(|f| !f.is_empty()), cves: i.issues.clone(), explicit: explicit.contains(p) })
        .collect();
    out.sort_by(|a, b| rank(&a.severity).cmp(&rank(&b.severity)).then(a.package.cmp(&b.package)));
    out
}

#[tauri::command]
pub async fn security_check(http: tauri::State<'_, reqwest::Client>) -> Result<Vec<Finding>, String> {
    let res = http.get(TRACKER).timeout(Duration::from_secs(20)).send().await.map_err(|e| format!("Fluff couldn't reach Arch's security tracker: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("Arch's security tracker answered {}", res.status()));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    let issues: Vec<Issue> = serde_json::from_slice(&bytes).map_err(|e| format!("the tracker's list wasn't readable: {e}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        let q = exec(&["pacman".into(), "-Q".into(), "--color=never".into()], Duration::from_secs(20)).map(|r| r.stdout_text()).unwrap_or_default();
        let e = exec(&["pacman".into(), "-Qqe".into(), "--color=never".into()], Duration::from_secs(20)).map(|r| r.lines().into_iter().collect()).unwrap_or_default();
        findings(&issues, &installed_from(&q), &e, &vercmp)
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn issue(pkg: &str, status: &str, affected: &str, fixed: Option<&str>) -> Issue {
        Issue { name: "AVG-1".into(), packages: vec![pkg.into()], status: status.into(), severity: "High".into(), kind: "arbitrary code execution".into(), affected: affected.into(), fixed: fixed.map(String::from), issues: vec!["CVE-2026-1".into()] }
    }

    #[test]
    fn pacmans_own_version_order_decides() {
        let cmp = |a: &str, b: &str| vercmp(a, b);
        assert!(affects(&issue("php", "Vulnerable", "8.5.10-1", Some("8.5.12-1")), "8.5.11-1", &cmp), "between affected and fixed");
        assert!(!affects(&issue("php", "Fixed", "8.5.10-1", Some("8.5.12-1")), "8.5.12-1", &cmp), "updated to the fix");
        assert!(!affects(&issue("php", "Vulnerable", "8.5.10-1", Some("8.5.12-1")), "8.5.9-1", &cmp), "older than the affected version");
        assert!(affects(&issue("x", "Vulnerable", "1.0-1", None), "1.2-1", &cmp), "no fix yet");
        assert!(!affects(&issue("x", "Not affected", "1.0-1", None), "1.2-1", &cmp));
        assert!(!affects(&issue("x", "Fixed", "1.0-1", Some("2.0-1")), "1:0.5-1", &cmp), "an epoch makes it newer than the fix");
        assert!(affects(&issue("x", "Fixed", "1.0-1", Some("1.0-2")), "1.0-1", &cmp), "the pkgrel counts");
    }

    #[test]
    fn findings_name_what_is_installed_worst_first() {
        let cmp = |a: &str, b: &str| vercmp(a, b);
        let mut low = issue("zlib", "Vulnerable", "1.0-1", None);
        low.severity = "Low".into();
        let mut crit = issue("openssl", "Vulnerable", "3.0-1", Some("3.1-1"));
        crit.severity = "Critical".into();
        let installed = installed_from("zlib 1.2-1\nopenssl 3.0.5-1\nphp 9.0-1\n");
        let explicit = ["zlib".to_string()].into_iter().collect();
        let f = findings(&[low, crit, issue("notinstalled", "Vulnerable", "1-1", None)], &installed, &explicit, &cmp);
        assert_eq!(f.iter().map(|x| (x.package.as_str(), x.severity.as_str(), x.explicit)).collect::<Vec<_>>(), [("openssl", "Critical", false), ("zlib", "Low", true)]);
        assert_eq!(f[0].fixed.as_deref(), Some("3.1-1"));
    }

    /// The real computer (counts only): `cargo test this_computer_security -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn this_computer_security() {
        let http = reqwest::Client::new();
        let issues: Vec<Issue> = tauri::async_runtime::block_on(async { http.get(TRACKER).send().await.unwrap().json_or_bytes().await });
        let q = exec(&["pacman".into(), "-Q".into(), "--color=never".into()], Duration::from_secs(20)).unwrap().stdout_text();
        let f = findings(&issues, &installed_from(&q), &Default::default(), &vercmp);
        println!("{} issues known; {} findings here; fixable {}", issues.len(), f.len(), f.iter().filter(|x| x.fixed.is_some()).count());
    }

    trait JsonOrBytes {
        async fn json_or_bytes(self) -> Vec<Issue>;
    }
    impl JsonOrBytes for reqwest::Response {
        async fn json_or_bytes(self) -> Vec<Issue> {
            serde_json::from_slice(&self.bytes().await.unwrap()).unwrap()
        }
    }
}
