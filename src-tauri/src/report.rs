// A plain report for a helper. The report itself is put
// together in the window (report.ts) from what Fluff already reads; this only says the names it
// must leave out — your user name, your home folder and this computer's name — so a word from the
// machine that carries one (a path, a journal line) is cleaned before you see the report.

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct ReportNames {
    pub user: String,
    pub home: String,
    pub host: String,
}

pub fn names_from(user: Option<String>, home: Option<String>, host: Option<String>) -> ReportNames {
    let clean = |v: Option<String>| v.map(|s| s.trim().to_string()).unwrap_or_default();
    ReportNames { user: clean(user), home: clean(home), host: clean(host) }
}

#[tauri::command]
pub fn report_names() -> ReportNames {
    names_from(std::env::var("USER").ok(), std::env::var("HOME").ok(), std::fs::read_to_string("/proc/sys/kernel/hostname").ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_trimmed_and_none_is_empty() {
        assert_eq!(names_from(Some("kit".into()), Some("/home/kit".into()), Some("archbox\n".into())), ReportNames { user: "kit".into(), home: "/home/kit".into(), host: "archbox".into() });
        assert_eq!(names_from(None, None, None), ReportNames { user: "".into(), home: "".into(), host: "".into() });
    }
}
