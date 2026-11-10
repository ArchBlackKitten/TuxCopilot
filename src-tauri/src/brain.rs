// Fluff's brain (Settings) and Ask Fluff: a chat with a model Ollama runs on this computer.
// Only Ollama's own address on this computer is asked (127.0.0.1:11434); nothing leaves it.
// Fluff answers; it never runs anything — the screen offers each command to copy or explain.

use serde::{Deserialize, Serialize};
use std::time::Duration;

const OLLAMA_CHAT: &str = "http://127.0.0.1:11434/api/chat";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Message {
    pub role: String, // "system" | "user" | "assistant"
    pub content: String,
}

/// A model name as `ollama list` prints it: `llama3.2:3b`, `qwen2.5-coder:7b`, `hf.co/x/y:q4`.
pub fn valid_model(m: &str) -> bool {
    !m.is_empty() && m.len() <= 200 && !m.starts_with(['-', '.', '/']) && m.chars().all(|c| c.is_ascii_alphanumeric() || "._:/-".contains(c))
}

/// The request Ollama's chat takes (one answer, not a stream).
pub fn chat_body(model: &str, messages: &[Message]) -> serde_json::Value {
    serde_json::json!({ "model": model, "messages": messages, "stream": false, "options": { "temperature": 0.2 } })
}

#[tauri::command]
pub async fn ask_fluff(model: String, messages: Vec<Message>) -> Result<String, String> {
    if !valid_model(&model) {
        return Err(format!("not a model name: {model}"));
    }
    if messages.is_empty() || messages.iter().any(|m| !["system", "user", "assistant"].contains(&m.role.as_str())) {
        return Err("nothing to ask".into());
    }
    // its own client: no redirects, so the answer can only come from Ollama here
    let http = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build().map_err(|e| e.to_string())?;
    let res = http
        .post(OLLAMA_CHAT)
        .timeout(Duration::from_secs(600))
        .header("Content-Type", "application/json")
        .body(chat_body(&model, &messages).to_string())
        .send()
        .await
        .map_err(|e| if e.is_connect() { "Ollama isn't running (start it in the Ollama section)".to_string() } else { e.to_string() })?;
    let status = res.status();
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| format!("Ollama's answer wasn't readable: {e}"))?;
    if !status.is_success() {
        return Err(v["error"].as_str().map(String::from).unwrap_or_else(|| format!("Ollama answered {status}")));
    }
    v["message"]["content"].as_str().map(|s| s.trim().to_string()).ok_or_else(|| "Ollama's answer had no text".into())
}

/// An AI's API address: https anywhere, or http on this computer (LM Studio, llama.cpp…).
pub fn api_url_ok(url: &str) -> bool {
    let Ok(u) = reqwest::Url::parse(url) else { return false };
    match u.scheme() {
        "https" => u.host_str().is_some(),
        "http" => matches!(u.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")),
        _ => false,
    }
}

/// The text of an answer, from the shapes chat APIs use: OpenAI-style (`choices[0].message`),
/// Ollama (`message`), Anthropic-style (`content[0].text`).
pub fn answer_text(v: &serde_json::Value) -> Option<String> {
    v["choices"][0]["message"]["content"].as_str().or_else(|| v["message"]["content"].as_str()).or_else(|| v["content"][0]["text"].as_str()).map(|s| s.trim().to_string())
}

/// One chat to an AI's chat API (OpenAI-compatible: OpenAI, Mistral, OpenRouter, Groq,
/// LM Studio…). The key is used for this request only: never kept, never logged.
#[tauri::command]
pub async fn ask_api(url: String, key: String, model: String, messages: Vec<Message>) -> Result<String, String> {
    if !api_url_ok(&url) {
        return Err("Fluff only sends to an https address (or http on this computer).".into());
    }
    if model.trim().is_empty() || model.len() > 200 || model.contains(char::is_whitespace) {
        return Err("the model's name is missing (the API's page lists them, like gpt-4o-mini or mistral-small-latest)".into());
    }
    if messages.is_empty() || messages.iter().any(|m| !["system", "user", "assistant"].contains(&m.role.as_str())) {
        return Err("nothing to ask".into());
    }
    let http = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build().map_err(|e| e.to_string())?;
    let body = serde_json::json!({ "model": model, "messages": messages, "temperature": 0.2 });
    let mut req = http.post(&url).timeout(Duration::from_secs(300)).header("Content-Type", "application/json").body(body.to_string());
    if !key.trim().is_empty() {
        req = req.header("Authorization", format!("Bearer {}", key.trim()));
    }
    let res = req.send().await.map_err(|e| if e.is_connect() { format!("Fluff couldn't reach {url}") } else { e.to_string() })?;
    let status = res.status();
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| format!("the API answered {status}, but not with JSON (is this the API's address, not its web page?)"))?;
    if !status.is_success() {
        let why = v["error"]["message"].as_str().or_else(|| v["error"].as_str()).unwrap_or("no reason given");
        return Err(format!("the API answered {status}: {why}"));
    }
    answer_text(&v).ok_or_else(|| "the API's answer had no text Fluff knows how to read".into())
}

/// The clipboard's text, read once when you press "Bring the answer back" (never by itself).
#[tauri::command]
pub async fn clipboard_text() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let tries: &[&[&str]] = &[&["wl-paste", "--no-newline"], &["xclip", "-o", "-selection", "clipboard"], &["xsel", "-ob"]];
        for t in tries {
            let argv: Vec<String> = t.iter().map(|s| s.to_string()).collect();
            if let Some(r) = crate::probe::exec(&argv, Duration::from_secs(5)) {
                if r.ok() {
                    let text = r.stdout_text();
                    return if text.len() > 2 * 1024 * 1024 { Err("what you copied is too big for an answer".into()) } else { Ok(text) };
                }
            }
        }
        Err("Fluff couldn't read the clipboard (wl-clipboard or xclip is missing): paste the answer into the box instead".into())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_model_names_are_asked_for() {
        for ok in ["llama3.2:3b", "qwen2.5-coder:7b", "hf.co/bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M", "mistral"] {
            assert!(valid_model(ok), "{ok}");
        }
        for bad in ["", "-h", "../x", "a b", "x;rm", "/abs"] {
            assert!(!valid_model(bad), "{bad}");
        }
    }

    /// A stand-in Ollama on its own port answers one chat (skipped when a real Ollama is running).
    #[test]
    fn fluff_asks_ollama_on_this_computer_and_reads_the_answer() {
        use std::io::{Read, Write};
        let Ok(listener) = std::net::TcpListener::bind("127.0.0.1:11434") else {
            eprintln!("port 11434 is taken (Ollama is running): skipped");
            return;
        };
        let server = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut buf = vec![0u8; 65536];
            let mut got = Vec::new();
            loop {
                let n = s.read(&mut buf).unwrap();
                got.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&got).to_string();
                if let Some(i) = text.find("\r\n\r\n") {
                    let len: usize = text.lines().find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse().unwrap())).unwrap_or(0);
                    if got.len() >= i + 4 + len {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            let body = r#"{"message":{"role":"assistant","content":"  Peep! Use:\n```\nsudo pacman -Syu\n```  "},"done":true}"#;
            write!(s, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            String::from_utf8_lossy(&got).to_string()
        });
        let answer = tauri::async_runtime::block_on(ask_fluff("llama3.2:3b".into(), vec![Message { role: "system".into(), content: "You are Fluff".into() }, Message { role: "user".into(), content: "how do I update?".into() }])).unwrap();
        let request = server.join().unwrap();
        assert!(request.starts_with("POST /api/chat HTTP/1.1"), "{request}");
        assert!(request.contains(r#""model":"llama3.2:3b""#) && request.contains(r#""stream":false"#) && request.contains("how do I update?"));
        assert_eq!(answer, "Peep! Use:\n```\nsudo pacman -Syu\n```");
        assert!(tauri::async_runtime::block_on(ask_fluff("x;rm".into(), vec![])).unwrap_err().contains("not a model name"));
    }

    #[test]
    fn api_addresses_and_answer_shapes() {
        for ok in ["https://api.openai.com/v1/chat/completions", "https://api.mistral.ai/v1/chat/completions", "http://localhost:1234/v1/chat/completions", "http://127.0.0.1:8080/v1/chat/completions"] {
            assert!(api_url_ok(ok), "{ok}");
        }
        for bad in ["http://api.openai.com/v1/chat/completions", "file:///etc/passwd", "ftp://x", "not a url", "http://localhost.evil.com/x"] {
            assert!(!api_url_ok(bad), "{bad}");
        }
        let openai = serde_json::json!({"choices":[{"message":{"role":"assistant","content":" {\"new_commands\":[]} "}}]});
        let ollama = serde_json::json!({"message":{"content":"a"}});
        let anthropic = serde_json::json!({"content":[{"type":"text","text":"b"}]});
        assert_eq!(answer_text(&openai).as_deref(), Some("{\"new_commands\":[]}"));
        assert_eq!(answer_text(&ollama).as_deref(), Some("a"));
        assert_eq!(answer_text(&anthropic).as_deref(), Some("b"));
        assert_eq!(answer_text(&serde_json::json!({"x":1})), None);
        let r = tauri::async_runtime::block_on(ask_api("http://example.com/v1".into(), "".into(), "m".into(), vec![Message { role: "user".into(), content: "p".into() }]));
        assert!(r.unwrap_err().contains("https"));
    }

    #[test]
    fn the_request_is_ollamas_chat_shape() {
        let b = chat_body("llama3.2:3b", &[Message { role: "user".into(), content: "hi".into() }]);
        assert_eq!(b["model"], "llama3.2:3b");
        assert_eq!(b["stream"], false);
        assert_eq!(b["messages"][0]["content"], "hi");
        assert!(OLLAMA_CHAT.starts_with("http://127.0.0.1:"), "this computer only");
    }
}
