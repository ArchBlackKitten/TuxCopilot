// Feedback: what the Feedback section needs from this computer — the running kernel, and the
// home folder and user name, which it takes out of what you send (only for that).

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackContext {
    pub kernel: String,
    pub home: String,
    pub user: String,
}

#[tauri::command]
pub fn feedback_context() -> FeedbackContext {
    FeedbackContext {
        kernel: std::fs::read_to_string("/proc/sys/kernel/osrelease").map(|k| k.trim().to_string()).unwrap_or_default(),
        home: std::env::var("HOME").unwrap_or_default(),
        user: std::env::var("USER").unwrap_or_default(),
    }
}
