// The size TuxCopilot opens at (Settings → Window): pocket (the default), roomy, the size it had
// when it was closed, or a size of your own. Kept in a small file of its own beside the
// database (window.json), not inside it: the window opens before the lock does, and two
// numbers are nothing private.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const POCKET: (u32, u32) = (900, 640);
pub const ROOMY: (u32, u32) = (1280, 860);
const MIN: (u32, u32) = (480, 420);
const MAX: (u32, u32) = (7680, 4320);

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowPref {
    pub mode: String, // "pocket" | "roomy" | "last" | "custom"
    pub width: u32,   // for "custom"
    pub height: u32,
    #[serde(default)]
    pub last: Option<(u32, u32)>, // the size when it was last closed
}

impl Default for WindowPref {
    fn default() -> Self {
        WindowPref { mode: "pocket".into(), width: POCKET.0, height: POCKET.1, last: None }
    }
}

fn clamp((w, h): (u32, u32)) -> (u32, u32) {
    (w.clamp(MIN.0, MAX.0), h.clamp(MIN.1, MAX.1))
}

/// The size to open at.
pub fn opening_size(p: &WindowPref) -> (u32, u32) {
    match p.mode.as_str() {
        "roomy" => ROOMY,
        "custom" => clamp((p.width, p.height)),
        "last" => p.last.map(clamp).unwrap_or(POCKET),
        _ => POCKET,
    }
}

pub struct WindowFile(pub PathBuf);

pub fn read(path: &Path) -> WindowPref {
    std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub fn write(path: &Path, p: &WindowPref) -> Result<(), String> {
    std::fs::write(path, serde_json::to_string_pretty(p).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_pref_get(file: tauri::State<'_, WindowFile>) -> WindowPref {
    read(&file.0)
}

#[tauri::command]
pub fn window_pref_set(file: tauri::State<'_, WindowFile>, pref: WindowPref) -> Result<(), String> {
    if !["pocket", "roomy", "last", "custom"].contains(&pref.mode.as_str()) {
        return Err(format!("not a window size: {}", pref.mode));
    }
    let last = read(&file.0).last; // the remembered size is the window's to keep, not the form's
    write(&file.0, &WindowPref { last, ..pref })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_opens_pocket_sized_unless_you_choose_otherwise() {
        assert_eq!(opening_size(&WindowPref::default()), (900, 640));
        assert_eq!(opening_size(&WindowPref { mode: "roomy".into(), ..Default::default() }), (1280, 860));
        assert_eq!(opening_size(&WindowPref { mode: "custom".into(), width: 1000, height: 700, last: None }), (1000, 700));
        assert_eq!(opening_size(&WindowPref { mode: "custom".into(), width: 10, height: 99999, last: None }), (480, 4320), "kept to sizes a window can be");
        assert_eq!(opening_size(&WindowPref { mode: "last".into(), last: None, ..Default::default() }), (900, 640), "nothing remembered yet: pocket");
        assert_eq!(opening_size(&WindowPref { mode: "last".into(), last: Some((1111, 777)), ..Default::default() }), (1111, 777));
        let d = std::env::temp_dir().join(format!("tux-window-{}.json", std::process::id()));
        assert_eq!(read(&d), WindowPref::default(), "no file: the default");
        write(&d, &WindowPref { mode: "roomy".into(), ..Default::default() }).unwrap();
        assert_eq!(read(&d).mode, "roomy");
        std::fs::remove_file(d).unwrap();
    }
}
