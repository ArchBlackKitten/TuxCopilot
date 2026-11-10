// The app's only network reach: GET requests to the package and repository sites that the
// source symbols and the README lookup point at. HTTPS only, these hosts only, redirects
// included. What is sent is a package or repo name; nothing stored here ever leaves.

use serde::Serialize;
use std::collections::HashMap;
use std::time::Duration;

pub const ALLOWED_HOSTS: &[&str] = &[
    "archlinux.org",
    "aur.archlinux.org",
    "github.com",
    "api.github.com",
    "raw.githubusercontent.com",
    "ollama.com",
    "www.ollama.com",
    "flathub.org",
    "snapcraft.io",
    "gitlab.torproject.org",
];

const MAX_BODY: usize = 5 * 1024 * 1024;

pub fn url_allowed(url: &reqwest::Url) -> bool {
    url.scheme() == "https" && url.host_str().is_some_and(|h| ALLOWED_HOSTS.contains(&h))
}

pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !url_allowed(attempt.url()) {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .expect("http client")
}

#[derive(Serialize)]
pub struct HttpResponse {
    ok: bool,
    status: u16,
    url: String,
    text: String,
}

#[tauri::command]
pub async fn http_get(
    http: tauri::State<'_, reqwest::Client>,
    url: String,
    headers: HashMap<String, String>,
    timeout_ms: Option<u64>,
) -> Result<HttpResponse, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    if !url_allowed(&parsed) {
        return Err(format!("not an allowed host: {url}"));
    }
    let mut req = http.get(parsed).timeout(Duration::from_millis(timeout_ms.unwrap_or(8000).min(30_000)));
    for (k, v) in &headers {
        // only the request shaping the lookups use
        if matches!(k.to_ascii_lowercase().as_str(), "user-agent" | "accept") {
            req = req.header(k, v);
        }
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status();
    let final_url = res.url().to_string();
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    let body = &bytes[..bytes.len().min(MAX_BODY)];
    Ok(HttpResponse {
        ok: status.is_success(),
        status: status.as_u16(),
        url: final_url,
        text: String::from_utf8_lossy(body).into_owned(),
    })
}

/// Hands an http(s) page to the desktop's browser.
#[tauri::command]
pub async fn open_external(url: String) -> Result<(), String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("only http(s) links open externally".into());
    }
    spawn_reaped("xdg-open", &[parsed.as_str()]).map(|_| ()).map_err(|e| format!("xdg-open: {e}"))
}

/// Starts a program that finishes by itself (xdg-open hands the link over and ends), and waits for
/// it on a thread: otherwise each one stays behind as a finished ("zombie") process until
/// TuxCopilot closes. Its pid, for the test.
pub fn spawn_reaped<S: AsRef<std::ffi::OsStr>>(program: &str, args: &[S]) -> std::io::Result<u32> {
    let mut child = std::process::Command::new(program)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()?;
    let pid = child.id();
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(pid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_opened_link_leaves_no_finished_process_behind() {
        let pid = spawn_reaped("true", &["x"]).unwrap();
        let stat = format!("/proc/{pid}/stat");
        let mut gone = false;
        for _ in 0..100 {
            // gone, or (pid reused) not a zombie
            match std::fs::read_to_string(&stat) {
                Err(_) => {
                    gone = true;
                    break;
                }
                Ok(t) if !t.split(") ").nth(1).is_some_and(|r| r.starts_with('Z')) && !t.contains("(true)") => {
                    gone = true;
                    break;
                }
                _ => std::thread::sleep(std::time::Duration::from_millis(20)),
            }
        }
        assert!(gone, "pid {pid} was left as a zombie");
        assert!(spawn_reaped("/nonexistent/program", &["x"]).is_err());
    }

    #[test]
    fn https_to_listed_hosts_only() {
        let ok = |u: &str| url_allowed(&reqwest::Url::parse(u).unwrap());
        assert!(ok("https://archlinux.org/packages/search/json/?name=firefox"));
        assert!(ok("https://raw.githubusercontent.com/sharkdp/bat/HEAD/README.md"));
        assert!(!ok("http://archlinux.org/"), "plain http refused");
        assert!(!ok("https://archlinux.org.evil.example/"));
        assert!(!ok("https://example.com/"));
        assert!(!ok("file:///etc/passwd"));
    }
}
