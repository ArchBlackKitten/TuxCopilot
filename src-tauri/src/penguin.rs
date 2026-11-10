// Relocate Fluff: Fluff's belongings — the whole of TuxCopilot in one file (.fluff), to move
// to another computer (or keep somewhere safe). Settings → Relocate Fluff. There is one
// penguin, Fluff: you adopt it once, and its belongings move with you. (This module keeps its
// first name, penguin.rs; nothing a user sees says "penguin" for the file.)
//
// What travels: your sections and items, the history of runs, the apps' usage days, the
// settings (the look among them), and your apps, their settings, git clones, Ollama models,
// Docker images, Tor's and the firewall's settings, so the new computer can get them back
// (belongings.rs, configs.rs). What stays: what TuxCopilot learned about THIS computer — the
// Commands knowledge from its --help pages, its package list, which OS it is — so the new
// computer learns its own.
//
// The file is `age`, sealed by a passphrase you choose (or words TuxCopilot picks, 9 unless you
// choose): it holds private things, so it is never written unsealed, and the decrypted
// contents never leave this side — the window only ever sees counts. Like every export it
// carries its SHA-256 checksum and, when you chose your GPG key, a signature. Before belongings
// replace anything, what was here is packed too, sealed by the same passphrase.

use crate::belongings::{Belongings, Missing, NotCarried};
use crate::db::{now_iso, setting_get, setting_set, Db};
use crate::integrity::{integrity, write_signed, Integrity, Saved};
use rusqlite::types::Value as Sql;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use zeroize::Zeroizing;

const KIND: &str = "penguin";
const VERSION: u32 = 2; // 1 was the look alone, before it became a look file
const TABLES: &[&str] = &["node", "run_log", "setting", "usage_day"];
/// Settings that describe this computer, not you: they stay where they are.
const STAYS_HERE: &[&str] = &["os.choice", "installed.packages", "kb.lastSync", "apps.lastSeen", "tracker.lastSampleAt", "tracker.samples", "changes.history", BELONGINGS];
/// After an import: the old computer's apps and clones, until you have them back or forget them.
const BELONGINGS: &str = "penguin.belongings";
const MAX_FILE: u64 = 256 * 1024 * 1024;
const WRONG: &str = "That passphrase does not open Fluff's belongings.";

#[derive(Serialize, Deserialize)]
pub struct Contents {
    tuxcopilot: String,
    version: u32,
    made: String,
    from: String, // the computer's name
    app_version: String,
    tables: BTreeMap<String, Vec<Map<String, Value>>>,
    #[serde(default)]
    belongings: Belongings,
    #[serde(default)]
    configs: Vec<crate::configs::Item>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    made: String,
    from: String,
    app_version: String,
    items: usize,
    runs: usize,
    usage_days: usize,
    settings: usize,
    pacman: usize,
    aur: usize,
    flatpak: usize,
    git: usize,
    ollama: usize,
    docker: usize,
    torrc: bool,
    firewall: bool,
    configs: Vec<crate::configs::Carried>,
}

fn to_json(v: Sql) -> Result<Value, String> {
    Ok(match v {
        Sql::Null => Value::Null,
        Sql::Integer(i) => Value::from(i),
        Sql::Real(f) => Value::from(f),
        Sql::Text(t) => Value::from(t),
        Sql::Blob(_) => return Err("a table holds binary data, which Fluff's belongings do not carry".into()),
    })
}

fn to_sql(v: &Value) -> Option<Sql> {
    Some(match v {
        Value::Null => Sql::Null,
        Value::Number(n) => n.as_i64().map(Sql::Integer).or_else(|| n.as_f64().map(Sql::Real))?,
        Value::String(s) => Sql::Text(s.clone()),
        _ => return None,
    })
}

fn columns(conn: &Connection, table: &str) -> Result<Vec<String>, String> {
    let mut st = conn.prepare(&format!("PRAGMA table_info({table})")).map_err(|e| e.to_string())?;
    let cols = st.query_map([], |r| r.get::<_, String>(1)).map_err(|e| e.to_string())?;
    cols.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

fn host_name() -> String {
    std::fs::read_to_string("/etc/hostname").map(|h| h.trim().to_string()).unwrap_or_default()
}

/// Everything that travels, read in one go.
pub fn snapshot(conn: &Connection) -> Result<Contents, String> {
    let mut tables = BTreeMap::new();
    for &t in TABLES {
        let cols = columns(conn, t)?;
        let mut st = conn.prepare(&format!("SELECT * FROM {t}")).map_err(|e| e.to_string())?;
        let mut rows = st.query([]).map_err(|e| e.to_string())?;
        let mut out = vec![];
        while let Some(r) = rows.next().map_err(|e| e.to_string())? {
            let mut m = Map::new();
            for (i, c) in cols.iter().enumerate() {
                m.insert(c.clone(), to_json(r.get::<_, Sql>(i).map_err(|e| e.to_string())?)?);
            }
            if t == "setting" && m.get("key").and_then(Value::as_str).is_some_and(|k| STAYS_HERE.contains(&k)) {
                continue;
            }
            out.push(m);
        }
        tables.insert(t.to_string(), out);
    }
    Ok(Contents { tuxcopilot: KIND.into(), version: VERSION, made: now_iso(), from: host_name(), app_version: env!("CARGO_PKG_VERSION").into(), tables, belongings: Belongings::default(), configs: vec![] })
}

pub fn summary(c: &Contents) -> Summary {
    let n = |t: &str| c.tables.get(t).map_or(0, Vec::len);
    Summary { made: c.made.clone(), from: c.from.clone(), app_version: c.app_version.clone(), items: n("node"), runs: n("run_log"), usage_days: n("usage_day"), settings: n("setting"),
        pacman: c.belongings.pacman.len(), aur: c.belongings.aur.len(), flatpak: c.belongings.flatpak.len(), git: c.belongings.git.len(),
        ollama: c.belongings.ollama.len(), docker: c.belongings.docker.len(), torrc: c.belongings.torrc.is_some(), firewall: !c.belongings.firewall.is_empty(),
        configs: crate::configs::carried(&c.configs) }
}

fn check_passphrase(p: &str) -> Result<(), String> {
    if p.trim().is_empty() {
        return Err("Choose a passphrase (or let TuxCopilot pick words for you).".into());
    }
    Ok(())
}

/// Sealed with `age` by the passphrase (scrypt): nothing else opens it.
pub fn seal(c: &Contents, passphrase: &str) -> Result<Vec<u8>, String> {
    check_passphrase(passphrase)?;
    let json = Zeroizing::new(serde_json::to_vec(c).map_err(|e| e.to_string())?);
    let enc = age::Encryptor::with_user_passphrase(age::secrecy::SecretString::from(passphrase.to_string()));
    let mut out = vec![];
    let mut w = enc.wrap_output(&mut out).map_err(|e| e.to_string())?;
    w.write_all(&json).map_err(|e| e.to_string())?;
    w.finish().map_err(|e| e.to_string())?;
    Ok(out)
}

pub fn unseal(file: &[u8], passphrase: &str) -> Result<Contents, String> {
    let d = age::Decryptor::new_buffered(file).map_err(|_| "This is not a file of Fluff's belongings.".to_string())?;
    if !d.is_scrypt() {
        return Err("This is not a file of Fluff's belongings.".into());
    }
    let id = age::scrypt::Identity::new(age::secrecy::SecretString::from(passphrase.to_string()));
    let mut r = d.decrypt(std::iter::once(&id as &dyn age::Identity)).map_err(|_| WRONG.to_string())?;
    let mut json = Zeroizing::new(vec![]);
    r.read_to_end(&mut json).map_err(|_| "These belongings are damaged.".to_string())?;
    let c: Contents = serde_json::from_slice(&json).map_err(|_| "These belongings are damaged.".to_string())?;
    if c.tuxcopilot != KIND {
        return Err("This is not a file of Fluff's belongings.".into());
    }
    if c.version != VERSION {
        return Err("These belongings were packed by a newer TuxCopilot. Update TuxCopilot, then bring them in again.".into());
    }
    Ok(c)
}

/// What is here becomes what the penguin holds, in one transaction: all of it or nothing.
/// This computer's own settings (STAYS_HERE) and the Commands knowledge are left as they are.
pub fn restore(conn: &mut Connection, c: &Contents) -> Result<(), String> {
    let mut plan = vec![];
    for (t, rows) in &c.tables {
        let Some(&t) = TABLES.iter().find(|&&x| x == t) else {
            return Err(format!("These belongings hold something this TuxCopilot does not know ({t}): were they packed by a newer one?"));
        };
        let cols = columns(conn, t)?;
        for row in rows {
            if let Some(k) = row.keys().find(|k| !cols.contains(k)) {
                return Err(format!("These belongings hold something this TuxCopilot does not know ({t}.{k}): were they packed by a newer one?"));
            }
        }
        plan.push((t, rows));
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute_batch("PRAGMA defer_foreign_keys = ON;").map_err(|e| e.to_string())?;
    let keep = STAYS_HERE.iter().map(|k| format!("'{k}'")).collect::<Vec<_>>().join(",");
    tx.execute_batch(&format!("DELETE FROM node; DELETE FROM run_log; DELETE FROM usage_day; DELETE FROM setting WHERE key NOT IN ({keep});"))
        .map_err(|e| e.to_string())?;
    for (t, rows) in plan {
        for row in rows {
            if t == "setting" && row.get("key").and_then(Value::as_str).is_some_and(|k| STAYS_HERE.contains(&k)) {
                continue;
            }
            let names: Vec<&String> = row.keys().collect();
            let values = row.values().map(|v| to_sql(v).ok_or_else(|| "These belongings are damaged.".to_string())).collect::<Result<Vec<_>, _>>()?;
            let marks = (1..=names.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(",");
            let sql = format!("INSERT INTO {t} ({}) VALUES ({marks})", names.iter().map(|n| n.as_str()).collect::<Vec<_>>().join(","));
            tx.execute(&sql, rusqlite::params_from_iter(values)).map_err(|e| format!("These belongings do not fit: {e}"))?;
        }
    }
    if c.belongings != Belongings::default() {
        let list = serde_json::to_string(&c.belongings).map_err(|e| e.to_string())?;
        setting_set(&tx, BELONGINGS, &list).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| format!("These belongings do not fit: {e}"))
}

// ── commands ─────────────────────────────────────────────────────────────

fn home() -> Result<PathBuf, String> {
    std::env::var("HOME").map(PathBuf::from).map_err(|_| "no home folder".to_string())
}

/// The folders you added in the Git section, searched for clones as the Git section does.
fn git_dirs(db: &Db) -> Vec<PathBuf> {
    let raw = setting_get(&db.lock().unwrap(), "git.dirs").unwrap_or_default();
    serde_json::from_str::<Vec<String>>(&raw).unwrap_or_default().into_iter().map(PathBuf::from).filter(|p| p.is_absolute()).collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pacman: usize,
    aur: usize,
    flatpak: usize,
    git: usize,
    ollama: usize,
    docker: usize,
    torrc: bool,
    firewall: bool,
    configs: Vec<crate::configs::Candidate>,
    not_carried: NotCarried,
}

/// What is on this computer, as moving house takes it: the apps you installed (pacman, the AUR,
/// Flathub), your git clones and Ollama models. Apps' lists show these: they fill themselves
/// from the system.
#[derive(Serialize)]
pub struct AppsHere {
    pacman: Vec<String>,
    aur: Vec<String>,
    flatpak: Vec<String>,
    git: Vec<crate::belongings::GitClone>,
    ollama: Vec<String>,
}

#[tauri::command]
pub async fn apps_here(db: tauri::State<'_, Db>) -> Result<AppsHere, String> {
    let added = git_dirs(&db);
    tauri::async_runtime::spawn_blocking(move || {
        let h = home()?;
        let (b, _) = crate::belongings::here(&h, &added);
        Ok(AppsHere { pacman: b.pacman, aur: b.aur, flatpak: b.flatpak, git: b.git, ollama: b.ollama })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Before you export: how many apps and clones go in, and what cannot come back from it.
#[tauri::command]
pub async fn penguin_preview(db: tauri::State<'_, Db>) -> Result<Preview, String> {
    let added = git_dirs(&db);
    tauri::async_runtime::spawn_blocking(move || {
        let h = home()?;
        let (b, not_carried) = crate::belongings::here(&h, &added);
        Ok(Preview {
            pacman: b.pacman.len(),
            aur: b.aur.len(),
            flatpak: b.flatpak.len(),
            git: b.git.len(),
            ollama: b.ollama.len(),
            docker: b.docker.len(),
            torrc: b.torrc.is_some(),
            firewall: !b.firewall.is_empty(),
            configs: crate::configs::candidates(&h),
            not_carried,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// After an import: what of the old computer's apps and clones this one does not have yet.
/// None: no list (no penguin imported, or you forgot it).
#[tauri::command]
pub async fn penguin_missing(db: tauri::State<'_, Db>) -> Result<Option<Missing>, String> {
    let Some(raw) = setting_get(&db.lock().unwrap(), BELONGINGS) else { return Ok(None) };
    let b: Belongings = serde_json::from_str(&raw).map_err(|_| "The list of your apps is damaged.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let in_repos: std::collections::HashSet<String> = {
            let argv = ["pacman", "-Slq"].map(String::from);
            crate::probe::exec(&argv, std::time::Duration::from_secs(30)).map(|r| r.lines()).unwrap_or_default().into_iter().collect()
        };
        let mut m = crate::belongings::missing(&b, &crate::belongings::installed_packages(), &in_repos, &crate::belongings::flatpaks_here(), &home()?);
        m.yay = Path::new("/usr/bin/yay").exists();
        let models = crate::belongings::ollama_models(&home()?);
        let images = crate::belongings::docker_images();
        let torrc = std::fs::read_to_string(crate::belongings::TORRC).ok();
        let fw = crate::belongings::firewall_files(Path::new(crate::belongings::FIREWALLD));
        crate::belongings::missing_system(&b, &mut m, &models, images.as_deref(), torrc.as_deref(), &fw);
        Ok(Some(m))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Done with the old computer's list.
#[tauri::command]
pub fn penguin_forget_belongings(db: tauri::State<'_, Db>) -> Result<(), String> {
    db.lock().unwrap().execute("DELETE FROM setting WHERE key = ?1", [BELONGINGS]).map_err(|e| e.to_string())?;
    Ok(())
}

/// The penguin you picked to import, until it is imported or another is picked.
pub struct Picked {
    dir: PathBuf, // the data folder, where what was here is kept before an import
    file: Mutex<Option<Vec<u8>>>,
}

impl Picked {
    pub fn new(dir: &Path) -> Self {
        Self { dir: dir.to_path_buf(), file: Mutex::new(None) }
    }
}

/// Words for a passphrase, if you would rather not make one up: 9 unless you choose otherwise.
#[tauri::command]
pub fn penguin_words(count: Option<usize>) -> Vec<String> {
    crate::lock::new_seed(count.unwrap_or(crate::lock::SEED_WORDS))
}

#[tauri::command]
pub async fn penguin_export(
    app: tauri::AppHandle,
    db: tauri::State<'_, Db>,
    passphrase: String,
    sign_with: Option<String>,
    configs: Vec<crate::configs::Pick>,
    torrc: bool,
    firewall: bool,
) -> Result<Option<Saved>, String> {
    use tauri_plugin_dialog::DialogExt;
    let passphrase = Zeroizing::new(passphrase);
    check_passphrase(&passphrase)?;
    let mut contents = snapshot(&db.lock().unwrap())?;
    let added = git_dirs(&db);
    let (belongings, items) = tauri::async_runtime::spawn_blocking(move || -> Result<_, String> {
        let h = home()?;
        let mut b = crate::belongings::here(&h, &added).0;
        if !torrc {
            b.torrc = None;
        }
        if !firewall {
            b.firewall.clear();
        }
        Ok((b, crate::configs::pack(&h, &configs)?))
    })
    .await
    .map_err(|e| e.to_string())??;
    contents.belongings = belongings;
    contents.configs = items;
    let sealed = tauri::async_runtime::spawn_blocking(move || seal(&contents, &passphrase)).await.map_err(|e| e.to_string())??;
    let name = format!("fluff-{}-{}.fluff", host_name().replace(|c: char| !c.is_ascii_alphanumeric() && c != '-', "-"), &now_iso()[..10]);
    let picked = tauri::async_runtime::spawn_blocking(move || app.dialog().file().set_file_name(&name).blocking_save_file()).await.map_err(|e| e.to_string())?;
    let Some(fp) = picked else { return Ok(None) };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || write_signed(&path, &sealed, sign_with.as_deref()).map(Some)).await.map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct PickedFile {
    name: String,
    integrity: Integrity,
}

/// Pick a penguin: its checksum and signature are checked now; it is opened by the passphrase.
#[tauri::command]
pub async fn penguin_pick(app: tauri::AppHandle, picked: tauri::State<'_, Picked>) -> Result<Option<PickedFile>, String> {
    use tauri_plugin_dialog::DialogExt;
    let fp = tauri::async_runtime::spawn_blocking(move || app.dialog().file().add_filter("Fluff's belongings", &["fluff"]).blocking_pick_file()).await.map_err(|e| e.to_string())?;
    let Some(fp) = fp else { return Ok(None) };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > MAX_FILE {
        return Err("That file is larger than 256 MB: it is not Fluff's belongings.".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let (integrity, bytes) = tauri::async_runtime::spawn_blocking(move || (integrity(&path, &bytes), bytes)).await.map_err(|e| e.to_string())?;
    *picked.file.lock().unwrap() = (integrity.checksum != "mismatch").then_some(bytes);
    Ok(Some(PickedFile { name, integrity }))
}

fn picked_bytes(picked: &Picked) -> Result<Vec<u8>, String> {
    picked.file.lock().unwrap().clone().ok_or_else(|| "Choose the belongings file again.".to_string())
}

/// What the picked penguin holds, in counts — nothing is changed.
#[tauri::command]
pub async fn penguin_peek(picked: tauri::State<'_, Picked>, passphrase: String) -> Result<Summary, String> {
    let bytes = picked_bytes(&picked)?;
    let passphrase = Zeroizing::new(passphrase);
    tauri::async_runtime::spawn_blocking(move || unseal(&bytes, &passphrase).map(|c| summary(&c))).await.map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Restored {
    kept: String,                       // what TuxCopilot held before, as a penguin
    configs: Vec<(String, Option<String>)>, // each setting put back, and where what was there went
    config_error: Option<String>,
}

/// Replace what is here with the picked penguin. What was here is kept first, in the data
/// folder, sealed by the same passphrase: importing that one puts it back. Then the settings
/// you ticked are put back in your home (what was there is moved aside, never overwritten).
#[tauri::command]
pub async fn penguin_restore(picked: tauri::State<'_, Picked>, db: tauri::State<'_, Db>, passphrase: String, put_back: Vec<crate::configs::Pick>) -> Result<Restored, String> {
    let bytes = picked_bytes(&picked)?;
    let passphrase = Zeroizing::new(passphrase);
    let incoming = {
        let p = passphrase.clone();
        tauri::async_runtime::spawn_blocking(move || unseal(&bytes, &p)).await.map_err(|e| e.to_string())??
    };
    let here = snapshot(&db.lock().unwrap())?;
    let kept = picked.dir.join(format!("before-fluff-moved-{}.fluff", now_iso().replace(':', "-")));
    {
        let (p, kept) = (passphrase.clone(), kept.clone());
        tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
            let sealed = seal(&here, &p)?;
            write_signed(&kept, &sealed, None)?;
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&kept, std::fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??;
    }
    restore(&mut db.lock().unwrap(), &incoming)?;
    *picked.file.lock().unwrap() = None;
    let stamp = now_iso().replace(':', "-");
    let items = incoming.configs;
    let (configs, config_error) = tauri::async_runtime::spawn_blocking(move || match home().and_then(|h| crate::configs::unpack(&h, &items, &put_back, &stamp)) {
        Ok(r) => (r, None),
        Err(e) => (vec![], Some(e)),
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(Restored { kept: kept.to_string_lossy().into_owned(), configs, config_error })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{open_memory, setting_get, setting_set};

    fn filled() -> Connection {
        let c = open_memory();
        let now = now_iso();
        c.execute("INSERT INTO node (id, name, created_at, updated_at) VALUES ('a', 'Mine', ?1, ?1)", [&now]).unwrap();
        c.execute("INSERT INTO node (id, name, parent_id, created_at, updated_at) VALUES ('b', 'Child', 'a', ?1, ?1)", [&now]).unwrap();
        c.execute("INSERT INTO run_log (id, label, created_at, updated_at) VALUES ('r', 'Update', ?1, ?1)", [&now]).unwrap();
        c.execute("INSERT INTO usage_day (id, day, month, app, seconds, updated_at) VALUES ('u', '2026-10-27', '2026-10', 'krita', 600, ?1)", [&now]).unwrap();
        c.execute("INSERT INTO kb_entry (id, tool, token, meaning, updated_at) VALUES ('k', 'pacman', '-S', 'sync', ?1)", [&now]).unwrap();
        setting_set(&c, "look", r#"{"palette":"night"}"#).unwrap();
        setting_set(&c, "os.choice", "cachyos").unwrap();
        c
    }

    fn count(c: &Connection, t: &str) -> i64 {
        c.query_row(&format!("SELECT count(*) FROM {t}"), [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn a_penguin_carries_you_to_another_computer_but_not_what_this_one_learned() {
        let here = filled();
        let file = seal(&snapshot(&here).unwrap(), "correct horse").unwrap();
        assert!(!String::from_utf8_lossy(&file).contains("Mine"), "sealed, never plain");

        let mut there = open_memory();
        setting_set(&there, "os.choice", "endeavouros").unwrap();
        setting_set(&there, "look", "theirs").unwrap();
        let c = unseal(&file, "correct horse").unwrap();
        assert_eq!(summary(&c).items, 2);
        restore(&mut there, &c).unwrap();
        assert_eq!((count(&there, "node"), count(&there, "run_log"), count(&there, "usage_day")), (2, 1, 1));
        assert_eq!(setting_get(&there, "look").as_deref(), Some(r#"{"palette":"night"}"#));
        assert_eq!(setting_get(&there, "os.choice").as_deref(), Some("endeavouros"), "this computer's own setting stays");
        assert_eq!(count(&there, "kb_entry"), 0, "the Commands knowledge is learned anew");
    }

    #[test]
    fn your_apps_and_clones_travel_and_wait_on_the_new_computer() {
        let mut c = snapshot(&filled()).unwrap();
        c.belongings = Belongings { pacman: vec!["krita".into()], aur: vec!["yay-bin".into()], flatpak: vec![], git: vec![], ..Default::default() };
        let c = unseal(&seal(&c, "pw").unwrap(), "pw").unwrap();
        assert_eq!((summary(&c).pacman, summary(&c).aur), (1, 1));
        let mut there = open_memory();
        restore(&mut there, &c).unwrap();
        let kept: Belongings = serde_json::from_str(&setting_get(&there, BELONGINGS).unwrap()).unwrap();
        assert_eq!(kept.pacman, ["krita"]);
        // the list is this computer's, never carried on in a penguin made here
        assert!(snapshot(&there).unwrap().tables["setting"].iter().all(|r| r["key"] != BELONGINGS));
    }

    #[test]
    fn only_the_passphrase_opens_it_and_a_changed_file_is_refused() {
        let file = seal(&snapshot(&filled()).unwrap(), "correct horse").unwrap();
        assert_eq!(unseal(&file, "wrong horse").err().as_deref(), Some(WRONG));
        let mut bent = file.clone();
        let n = bent.len() - 20;
        bent[n] ^= 1;
        assert!(unseal(&bent, "correct horse").is_err());
        assert!(unseal(b"{\"tuxcopilot\":\"penguin\"}", "x").is_err(), "a plain file is not a penguin");
        assert!(seal(&snapshot(&filled()).unwrap(), "  ").is_err(), "no empty passphrase");
    }

    #[test]
    fn a_penguin_that_does_not_fit_changes_nothing() {
        let mut c = snapshot(&filled()).unwrap();
        c.tables.get_mut("node").unwrap()[0].insert("colour".into(), Value::from("blue"));
        let mut there = filled();
        assert!(restore(&mut there, &c).unwrap_err().contains("newer"));
        let mut c = snapshot(&filled()).unwrap();
        c.tables.get_mut("node").unwrap()[1].insert("parent_id".into(), Value::from("nobody")); // a child with no parent
        assert!(restore(&mut there, &c).unwrap_err().contains("FOREIGN KEY"), "the parent check ran");
        assert_eq!(count(&there, "node"), 2, "all or nothing");
        assert_eq!(setting_get(&there, "look").as_deref(), Some(r#"{"palette":"night"}"#));
    }
}
