// The look (Settings → Look): opening a palette, picture or look file you pick, the colour
// schemes installed on this machine (KDE's and Krita's share one format), and putting a new
// icon on the window and in the application menu while the app runs.
//
// The webview draws the icon at each size itself (an SVG or PNG on a canvas), so this side
// only writes finished PNG files to fixed places and hands pixels to the window: no image
// decoding here, nothing fetched.

use base64::Engine;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;

const MAX_FILE: u64 = 8 * 1024 * 1024;
pub const SIZES: &[u32] = &[32, 64, 128, 256, 512];
const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

#[derive(Serialize)]
pub struct Opened {
    name: String,
    base64: String,
    integrity: crate::integrity::Integrity, // its checksum and signature, when beside it
}

/// A file you pick: a look, a colour scheme, a picture for the icon, or a backup.
#[tauri::command]
pub async fn open_file(app: tauri::AppHandle, kind: String) -> Result<Option<Opened>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (label, exts): (&str, &[&str]) = match kind.as_str() {
        "look" => ("TuxCopilot look", &["tuxlook", "json"]),
        "colors" => ("KDE / Krita colour scheme", &["colors"]),
        "picture" => ("Picture (SVG or PNG)", &["svg", "png"]),
        "backup" => ("TuxCopilot backup", &["json"]),
        "recovery" => ("TuxCopilot recovery file", &["age", "txt"]),
        _ => return Err(format!("unknown kind: {kind}")),
    };
    let picked = tauri::async_runtime::spawn_blocking(move || app.dialog().file().add_filter(label, exts).blocking_pick_file())
        .await
        .map_err(|e| e.to_string())?;
    let Some(fp) = picked else { return Ok(None) };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > MAX_FILE {
        return Err("that file is larger than 8 MB".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let integrity = tauri::async_runtime::spawn_blocking({
        let (path, bytes) = (path.clone(), bytes.clone());
        move || crate::integrity::integrity(&path, &bytes)
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(Some(Opened { name, base64: B64.encode(bytes), integrity }))
}

#[derive(Serialize)]
pub struct Scheme {
    path: String,
    text: String,
}

/// Where KDE Plasma and Krita keep colour schemes; yours first.
pub fn scheme_dirs(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join(".local/share/color-schemes"),
        home.join(".local/share/krita/color-schemes"),
        PathBuf::from("/usr/share/color-schemes"),
        PathBuf::from("/usr/share/krita/color-schemes"),
    ]
}

pub fn read_schemes(dirs: &[PathBuf]) -> Vec<Scheme> {
    let mut out = vec![];
    for d in dirs {
        let Ok(rd) = std::fs::read_dir(d) else { continue };
        let mut files: Vec<PathBuf> = rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "colors")).collect();
        files.sort();
        for p in files {
            if std::fs::metadata(&p).is_ok_and(|m| m.len() <= 256 * 1024) {
                if let Ok(text) = std::fs::read_to_string(&p) {
                    out.push(Scheme { path: p.to_string_lossy().into_owned(), text });
                }
            }
        }
    }
    out
}

#[tauri::command]
pub fn color_schemes() -> Vec<Scheme> {
    let home = std::env::var("HOME").map(PathBuf::from).unwrap_or_default();
    read_schemes(&scheme_dirs(&home))
}

/// The window's own icon (taskbar, window switcher): raw RGBA pixels, `size` × `size`.
#[tauri::command]
pub fn window_icon(app: tauri::AppHandle, rgba: String, size: u32) -> Result<(), String> {
    let bytes = B64.decode(rgba).map_err(|e| e.to_string())?;
    if size == 0 || size > 1024 || bytes.len() != (size * size * 4) as usize {
        return Err("the icon's pixels do not match its size".into());
    }
    let w = app.get_webview_window("main").ok_or("no main window")?;
    w.set_icon(tauri::image::Image::new_owned(bytes, size, size)).map_err(|e| e.to_string())
}

/// What the menu shows, and the copy install.sh puts back after an update.
pub fn icon_targets(home: &Path) -> (PathBuf, PathBuf) {
    (home.join(".local/share/icons/hicolor"), home.join(".local/share/tuxcopilot.desk/icon"))
}

const PNG_MAGIC: &[u8] = b"\x89PNG\r\n\x1a\n";

/// Write the icon at every size where the menu looks for it (`pngs`: size → PNG as base64), the
/// SVG too when there is one, and a copy in the app's data so updating keeps it. `None` for
/// both means: back to the penguin — the copy goes and `pngs` holds the penguin's own sizes.
pub fn write_menu_icon(home: &Path, pngs: &[(u32, String)], svg: Option<&str>, custom: bool) -> Result<(), String> {
    let (theme, keep) = icon_targets(home);
    let mut decoded = vec![];
    for (size, b64) in pngs {
        if !SIZES.contains(size) {
            return Err(format!("not an icon size: {size}"));
        }
        let bytes = B64.decode(b64).map_err(|e| e.to_string())?;
        if !bytes.starts_with(PNG_MAGIC) {
            return Err(format!("the {size} px icon is not a PNG"));
        }
        decoded.push((*size, bytes));
    }
    if decoded.len() != SIZES.len() {
        return Err("every size is needed: 32, 64, 128, 256 and 512".into());
    }
    let _ = std::fs::remove_dir_all(&keep);
    for (size, bytes) in &decoded {
        let dir = theme.join(format!("{size}x{size}/apps"));
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(dir.join("tuxcopilot.png"), bytes).map_err(|e| e.to_string())?;
        if custom {
            std::fs::create_dir_all(&keep).map_err(|e| e.to_string())?;
            std::fs::write(keep.join(format!("{size}.png")), bytes).map_err(|e| e.to_string())?;
        }
    }
    let scalable = theme.join("scalable/apps/tuxcopilot.svg");
    match svg {
        Some(s) => {
            std::fs::create_dir_all(scalable.parent().unwrap()).map_err(|e| e.to_string())?;
            std::fs::write(&scalable, s).map_err(|e| e.to_string())?;
            if custom {
                std::fs::write(keep.join("icon.svg"), s).map_err(|e| e.to_string())?;
            }
        }
        None => {
            let _ = std::fs::remove_file(&scalable); // a PNG icon: an old SVG must not win
        }
    }
    // the menu notices a changed icon theme folder sooner
    let _ = std::fs::File::open(&theme).and_then(|f| f.set_modified(std::time::SystemTime::now()));
    Ok(())
}

#[tauri::command]
pub async fn menu_icon(pngs: Vec<(u32, String)>, svg: Option<String>, custom: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = std::env::var("HOME").map(PathBuf::from).map_err(|_| "no home folder".to_string())?;
        write_menu_icon(&home, &pngs, svg.as_deref(), custom)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png() -> String {
        B64.encode([PNG_MAGIC, b"rest"].concat())
    }

    #[test]
    fn the_menu_icon_goes_where_the_menu_looks_and_a_copy_survives_updates() {
        let home = std::env::temp_dir().join(format!("am-icon-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let all: Vec<(u32, String)> = SIZES.iter().map(|s| (*s, png())).collect();
        write_menu_icon(&home, &all, Some("<svg/>"), true).unwrap();
        let theme = home.join(".local/share/icons/hicolor");
        for s in SIZES {
            assert!(theme.join(format!("{s}x{s}/apps/tuxcopilot.png")).is_file());
            assert!(home.join(format!(".local/share/tuxcopilot.desk/icon/{s}.png")).is_file());
        }
        assert_eq!(std::fs::read_to_string(theme.join("scalable/apps/tuxcopilot.svg")).unwrap(), "<svg/>");

        // a PNG icon: the old SVG goes, or it would still be shown
        write_menu_icon(&home, &all, None, true).unwrap();
        assert!(!theme.join("scalable/apps/tuxcopilot.svg").exists());
        // back to the penguin: the kept copy goes, so updating installs the penguin again
        write_menu_icon(&home, &all, Some("<svg/>"), false).unwrap();
        assert!(!home.join(".local/share/tuxcopilot.desk/icon").exists());

        assert!(write_menu_icon(&home, &all[..4], None, true).unwrap_err().contains("every size"));
        let odd: Vec<(u32, String)> = SIZES.iter().map(|s| (*s + 1, png())).collect();
        assert!(write_menu_icon(&home, &odd, None, true).unwrap_err().contains("not an icon size"));
        let not_png: Vec<(u32, String)> = SIZES.iter().map(|s| (*s, B64.encode(b"<html>"))).collect();
        assert!(write_menu_icon(&home, &not_png, None, true).unwrap_err().contains("not a PNG"));
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn colour_schemes_are_read_from_where_kde_and_krita_keep_them() {
        let d = std::env::temp_dir().join(format!("am-schemes-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("Mine.colors"), "[General]\nName=Mine\n").unwrap();
        std::fs::write(d.join("notes.txt"), "not a scheme").unwrap();
        let got = read_schemes(&[d.clone(), d.join("missing")]);
        assert_eq!(got.len(), 1);
        assert!(got[0].path.ends_with("Mine.colors") && got[0].text.contains("Name=Mine"));
        std::fs::remove_dir_all(&d).unwrap();
    }
}
