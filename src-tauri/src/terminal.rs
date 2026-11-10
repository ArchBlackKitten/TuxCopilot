// Your own terminal, for "Where commands run" (Settings): which are installed, which one your
// desktop prefers, and how each is told to open a window that runs one script.

use serde::Serialize;
use std::path::Path;

/// The terminals TuxCopilot knows how to start, in the order they are offered.
pub const KNOWN: &[(&str, &str)] = &[
    ("kitty", "kitty"),
    ("wezterm", "WezTerm"),
    ("konsole", "Konsole"),
    ("alacritty", "Alacritty"),
    ("foot", "foot"),
    ("ghostty", "Ghostty"),
    ("gnome-terminal", "GNOME Terminal"),
    ("xterm", "xterm"),
];

pub fn installed(id: &str) -> bool {
    KNOWN.iter().any(|(k, _)| *k == id) && ["/usr/bin", "/usr/local/bin", "/bin"].iter().any(|d| Path::new(d).join(id).is_file())
}

/// How to open `id` running `bash <script>` in a new window titled `title`.
pub fn argv(id: &str, title: &str, script: &str) -> Option<Vec<String>> {
    let v: Vec<&str> = match id {
        "kitty" => vec!["kitty", "--title", title, "bash", script],
        "wezterm" => vec!["wezterm", "start", "--always-new-process", "--", "bash", script],
        "konsole" => vec!["konsole", "--separate", "-e", "bash", script],
        "alacritty" => vec!["alacritty", "--title", title, "-e", "bash", script],
        "foot" => vec!["foot", "--title", title, "bash", script],
        "ghostty" => vec!["ghostty", "-e", "bash", script],
        "gnome-terminal" => vec!["gnome-terminal", "--title", title, "--", "bash", script],
        "xterm" => vec!["xterm", "-T", title, "-e", "bash", script],
        _ => return None,
    };
    Some(v.into_iter().map(String::from).collect())
}

/// The desktop's own choice: $TERMINAL, KDE's TerminalApplication, xdg-terminals.list.
pub fn preferred(env_terminal: Option<&str>, kdeglobals: Option<&str>, xdg_list: Option<&str>) -> Option<String> {
    let known = |s: &str| -> Option<String> {
        let first = s.split_whitespace().next()?;
        let base = first.rsplit('/').next()?.trim_end_matches(".desktop");
        let base = base.rsplit('.').next().unwrap_or(base).to_lowercase(); // org.wezfurlong.wezterm → wezterm
        KNOWN.iter().find(|(k, _)| *k == base).map(|(k, _)| k.to_string())
    };
    env_terminal.and_then(known)
        .or_else(|| kdeglobals.and_then(|t| t.lines().find_map(|l| l.trim().strip_prefix("TerminalApplication=")).and_then(known)))
        .or_else(|| xdg_list.and_then(|t| t.lines().map(str::trim).find(|l| !l.is_empty() && !l.starts_with('#')).and_then(known)))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Terminals {
    installed: Vec<(String, String)>, // (id, name)
    preferred: Option<String>,
}

impl Terminals {
    /// Your desktop's terminal, else the first one installed.
    pub fn preferred_installed(&self) -> Option<String> {
        self.preferred.clone().or_else(|| self.installed.first().map(|(k, _)| k.clone()))
    }
}

#[tauri::command]
pub fn terminals() -> Terminals {
    let home = std::env::var("HOME").unwrap_or_default();
    let read = |p: String| std::fs::read_to_string(p).ok();
    let pref = preferred(
        std::env::var("TERMINAL").ok().as_deref(),
        read(format!("{home}/.config/kdeglobals")).as_deref(),
        read(format!("{home}/.config/xdg-terminals.list")).as_deref(),
    );
    Terminals {
        installed: KNOWN.iter().filter(|(k, _)| installed(k)).map(|(k, n)| (k.to_string(), n.to_string())).collect(),
        preferred: pref.filter(|p| installed(p)),
    }
}

/// The browsers that run inside a terminal and can show today's chat sites (they run
/// JavaScript; w3m, lynx and links don't), best first: browsh shows the page with your own
/// Firefox, which Arch keeps updated; carbonyl brings its own Chromium, from 2023.
pub const BROWSERS: &[&str] = &["browsh", "carbonyl"];

fn terminal_browser_found() -> Option<&'static str> {
    BROWSERS.iter().copied().find(|b| ["/usr/bin", "/usr/local/bin"].iter().any(|d| Path::new(d).join(b).is_file()))
}

/// The terminal browser installed, if any — the dialog says so before you press Send.
#[tauri::command]
pub fn terminal_browser() -> Option<String> {
    terminal_browser_found().map(String::from)
}

/// Only a web link: https anywhere, or http to this computer (a local AI such as Ollama's web UI).
pub fn browsable(url: &str) -> bool {
    let local = |r: &str| {
        ["localhost", "127.0.0.1", "[::1]"].iter().any(|h| r.strip_prefix(h).is_some_and(|after| after.is_empty() || after.starts_with([':', '/'])))
    };
    let rest = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://").filter(|r| local(r)));
    matches!(rest, Some(r) if !r.is_empty() && url.len() <= 2048 && url.chars().all(|c| c.is_ascii_graphic()))
}

/// The script your terminal runs: the browser on the link, then a line saying it is over.
pub fn browse_script(browser: &str, url: &str) -> String {
    format!(
        "#!/bin/bash\nprintf '\\033]0;%s\\007' 'TuxCopilot — Ask AI'\n{browser}{flag} {url}\nprintf '\\nThe browser closed. Press Enter to close this window. '\nread -r _\n",
        flag = if browser == "browsh" { " --startup-url" } else { "" },
        url = crate::runner::sh_quote(url)
    )
}

/// Opens your terminal (the one in Settings → Where commands run, else your desktop's, else the
/// first installed) with a terminal browser on `url`. Nothing is recorded: the chat stays yours.
#[tauri::command]
pub fn browse_in_terminal(db: tauri::State<'_, crate::db::Db>, url: String) -> Result<String, String> {
    if !browsable(&url) {
        return Err("Fluff only opens web links (https://…, or http://localhost for an AI on this computer).".into());
    }
    let browser = terminal_browser_found()
        .ok_or("No terminal browser yet. browsh shows chat sites inside a terminal with your Firefox; it is in the AUR: yay -Syu --needed browsh")?;
    let chosen = crate::db::setting_get(&db.lock().unwrap(), "run.terminal").filter(|t| installed(t));
    let all = terminals();
    let term = chosen
        .or(all.preferred)
        .or_else(|| all.installed.first().map(|(k, _)| k.clone()))
        .ok_or("Fluff found no terminal to open (Settings → Where commands run lists the ones it knows).")?;
    let dir = crate::runner::runtime_dir().ok_or("no folder for the browser's script")?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let script = dir.join(format!("browse-{}-{stamp}.sh", std::process::id()));
    std::fs::write(&script, browse_script(browser, &url)).map_err(|e| e.to_string())?;
    let argv = argv(&term, "TuxCopilot — Ask AI", &script.to_string_lossy()).ok_or("unknown terminal")?;
    // waited for on a thread, so a closed window leaves nothing behind
    crate::net::spawn_reaped(&argv[0], &argv[1..]).map_err(|e| format!("{term} did not start: {e}"))?;
    // bash reads a script as it goes, so it is removed only once the window has surely started
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(30));
        let _ = std::fs::remove_file(script);
    });
    Ok(format!("{browser} in {term}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_web_links_are_opened_in_the_terminal_browser() {
        for ok in ["https://chatgpt.com/", "https://chat.mistral.ai/chat", "http://localhost:8080", "http://127.0.0.1/", "http://[::1]:3000/x"] {
            assert!(browsable(ok), "{ok}");
        }
        for bad in ["http://example.com", "http://localhost.evil.com", "file:///etc/passwd", "https://", "javascript:alert(1)", "https://a b", "--help", ""] {
            assert!(!browsable(bad), "{bad}");
        }
        // a quote is allowed in a link, so the link is always quoted for the shell, never run
        let s = browse_script("carbonyl", "https://x/';rm -rf ~;'");
        assert!(s.contains(r#"carbonyl 'https://x/'\'';rm -rf ~;'\'''"#), "{s}");
        assert!(browse_script("browsh", "https://duck.ai/").contains("\nbrowsh --startup-url 'https://duck.ai/'\n"), "browsh takes the link after --startup-url");
    }

    #[test]
    fn the_desktops_choice_is_read() {
        assert_eq!(preferred(None, Some("[General]\nTerminalApplication=kitty\n"), None).as_deref(), Some("kitty"));
        assert_eq!(preferred(Some("/usr/bin/alacritty"), Some("TerminalApplication=kitty"), None).as_deref(), Some("alacritty"));
        assert_eq!(preferred(None, None, Some("# mine\norg.wezfurlong.wezterm.desktop\n")).as_deref(), Some("wezterm"));
        assert_eq!(preferred(Some("my-own-term"), None, None), None);
    }

    #[test]
    fn every_known_terminal_runs_the_script_in_a_window() {
        for (id, _) in KNOWN {
            let a = argv(id, "T", "/run/x.sh").unwrap();
            assert_eq!(a[0], *id);
            assert_eq!(a[a.len() - 2..], ["bash", "/run/x.sh"]);
        }
        assert!(argv("rm", "T", "x").is_none());
    }
}
