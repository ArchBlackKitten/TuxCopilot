// A command's own --help, for its page in Commands: only commands in TuxCopilot's catalogue
// (src/lib/commands/catalog.json, read here at build time — one list for both sides) or ones
// you added through "Ask AI to refresh" that are installed programs, run without a terminal
// or input, in English, for a few seconds at most.

use crate::db::Db;
use crate::probe::exec;
use std::time::Duration;

const CATALOG: &str = include_str!("../../src/lib/commands/catalog.json");

pub fn catalogue_names() -> Vec<String> {
    let v: serde_json::Value = serde_json::from_str(CATALOG).expect("catalog.json is valid JSON");
    v["commands"].as_array().map(|a| a.iter().filter_map(|c| c["name"].as_str().map(String::from)).collect()).unwrap_or_default()
}

/// The commands you added (the setting commands.added), by name.
pub fn added_names(json: Option<&str>) -> Vec<String> {
    let v: serde_json::Value = json.and_then(|j| serde_json::from_str(j).ok()).unwrap_or_default();
    v["added"].as_array().map(|a| a.iter().filter_map(|c| c["name"].as_str().map(String::from)).collect()).unwrap_or_default()
}

/// An added command is asked only when it is a plain name and an installed program.
fn installed_program(name: &str) -> bool {
    !name.is_empty()
        && name.chars().all(|c| c.is_ascii_alphanumeric() || "._+-".contains(c))
        && !name.starts_with(['-', '.'])
        && ["/usr/bin", "/usr/local/bin"].iter().any(|d| std::path::Path::new(d).join(name).is_file())
}

const BUILTINS: &[&str] = &["cd", "echo"];

#[tauri::command]
pub async fn command_help(db: tauri::State<'_, Db>, name: String) -> Result<String, String> {
    let added = crate::db::setting_get(&db.lock().unwrap(), "commands.added");
    help_for(name, added).await
}

async fn help_for(name: String, added: Option<String>) -> Result<String, String> {
    if !catalogue_names().contains(&name) {
        if !added_names(added.as_deref()).contains(&name) {
            return Err(format!("{name} is not in TuxCopilot's catalogue"));
        }
        if !installed_program(&name) {
            return Err(format!("{name} is not installed on this computer."));
        }
    }
    if BUILTINS.contains(&name.as_str()) {
        return Ok(format!("{name} is built into the shell, not a program of its own. In bash, `help {name}` describes it."));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let argv = vec![name.clone(), "--help".to_string()];
        match exec(&argv, Duration::from_secs(5)) {
            None => Err(format!("{name} is not installed on this computer (or did not answer).")),
            Some(r) => Ok(clean_help(&r.joined())),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Help as words: without the terminal's link codes (OSC 8), bold and colour (CSI), or
/// typewriter bold (a letter, a backspace, the letter again — as `less --help` writes it), or \\r.
/// coreutils adds links and bold whenever TERM is set, even when nothing shows them.
pub fn clean_help(text: &str) -> String {
    let c: Vec<char> = text.chars().collect();
    let mut out: Vec<char> = Vec::with_capacity(c.len());
    let mut i = 0;
    while i < c.len() {
        match c[i] {
            '\u{1b}' if c.get(i + 1) == Some(&']') => {
                // OSC: up to BEL or ESC \
                i += 2;
                while i < c.len() && c[i] != '\u{7}' && !(c[i] == '\u{1b}' && c.get(i + 1) == Some(&'\\')) {
                    i += 1;
                }
                i += if c.get(i) == Some(&'\u{7}') { 1 } else { 2 };
            }
            '\u{1b}' if c.get(i + 1) == Some(&'[') => {
                // CSI: parameters, then one final letter
                i += 2;
                while i < c.len() && !('@'..='~').contains(&c[i]) {
                    i += 1;
                }
                i += 1;
            }
            '\u{1b}' => i += 2,
            '\r' => i += 1, // ssh ends its lines \r\n
            '\u{8}' => {
                out.pop(); // typewriter bold or underline: the letter before is struck over
                i += 1;
            }
            ch => {
                out.push(ch);
                i += 1;
            }
        }
    }
    out.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn help_is_words_without_the_terminals_codes() {
        let ls = "  \u{1b}]8;;https://www.gnu.org/software/coreutils/manual/coreutils.html#ls-a\u{1b}\\\u{1b}[1m-a, --all\u{1b}[0m\u{1b}]8;;\u{1b}\\\n";
        assert_eq!(clean_help(ls), "  -a, --all\n");
        assert_eq!(clean_help("S\u{8}SU\u{8}UM\u{8}MM\u{8}MA\u{8}AR\u{8}RY\u{8}Y of less"), "SUMMARY of less");
        assert_eq!(clean_help("_\u{8}f_\u{8}i_\u{8}l_\u{8}e"), "file", "typewriter underline");
        assert_eq!(clean_help("\u{1b}]8;;http://x\u{7}link\u{1b}]8;;\u{7} and \u{1b}[38;5;196mred\u{1b}[m"), "link and red");
        assert_eq!(clean_help("plain — ünïcode\n"), "plain — ünïcode\n");
        assert_eq!(clean_help("cut \u{1b}["), "cut ", "a code cut off at the end");
        assert_eq!(clean_help("unknown option -- -\r\nusage: ssh\r\n"), "unknown option -- -\nusage: ssh\n", "ssh's line ends");
    }

    #[test]
    fn only_catalogue_commands_are_asked() {
        let names = catalogue_names();
        assert!(names.len() > 80 && names.contains(&"mkdir".to_string()));
        assert!(names.iter().all(|n| n.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')), "plain names only");
    }

    /// Every catalogue command's page, as it opens on this computer: real help, not installed,
    /// or an answer too short to be help. Run by hand: cargo test every_page_on_this_computer -- --ignored --nocapture
    #[test]
    #[ignore]
    fn every_page_on_this_computer() {
        let (mut ok, mut missing, mut odd) = (vec![], vec![], vec![]);
        for n in catalogue_names() {
            let started = std::time::Instant::now();
            match tauri::async_runtime::block_on(help_for(n.clone(), None)) {
                Ok(t) if t.chars().any(|c| c.is_control() && c != '\n' && c != '\t') => odd.push(format!("{n}: a control character is left")),
                Ok(t) if t.lines().count() >= 3 => ok.push(n),
                Ok(t) => odd.push(format!("{n} ({} lines: {:?}, {:?})", t.lines().count(), t.chars().take(120).collect::<String>(), started.elapsed())),
                Err(e) if e.contains("not installed") => missing.push(n),
                Err(e) => odd.push(format!("{n}: {e}")),
            }
        }
        println!("help shown: {}\nnot installed here ({}): {}\nodd ({}):\n  {}", ok.len(), missing.len(), missing.join(" "), odd.len(), odd.join("\n  "));
    }

    #[test]
    fn only_catalogue_commands_are_asked_through_the_app() {
        let ask = |n: &str| tauri::async_runtime::block_on(help_for(n.into(), None));
        assert!(ask("rm -rf /").unwrap_err().contains("not in TuxCopilot's catalogue"));
        assert!(ask("mkdir").unwrap().contains("--parents"), "mkdir's real --help");
        assert!(ask("cd").unwrap().contains("built into the shell"));
        assert!(ask("bash").unwrap_err().contains("not in TuxCopilot's catalogue"), "installed, but nobody added it");
    }

    #[test]
    fn an_added_command_is_asked_only_when_it_is_an_installed_program() {
        assert_eq!(added_names(Some(r#"{"refreshed":{},"added":[{"name":"bash"},{"name":"x y"}]}"#)), ["bash", "x y"]);
        assert!(added_names(Some("not json")).is_empty() && added_names(None).is_empty());
        assert!(installed_program("bash"));
        assert!(!installed_program("x y") && !installed_program("../bin/bash") && !installed_program("-bash") && !installed_program("no-such-program-here"));
        let kept = Some(r#"{"refreshed":{},"added":[{"name":"bash"},{"name":"no-such-program-here"}]}"#.to_string());
        let ask = |n: &str| tauri::async_runtime::block_on(help_for(n.into(), kept.clone()));
        assert!(ask("bash").unwrap().contains("GNU bash"), "added and installed: its real --help");
        assert!(ask("no-such-program-here").unwrap_err().contains("not installed"));
        assert!(ask("zsh-not-added").unwrap_err().contains("not in TuxCopilot's catalogue"));
    }
}
