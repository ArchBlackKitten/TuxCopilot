// The Arch Commands knowledge base learned from this machine, and the key/value settings.

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::db::{err, new_id, now_iso, Db};

#[derive(Serialize)]
pub struct KbRow {
    tool: String,
    token: String,
    kind: String,
    meaning: String,
}

#[derive(Deserialize)]
pub struct KbIn {
    token: String,
    kind: String,
    meaning: String,
}

/// Merges entries for one tool; returns how many were new.
pub fn upsert(conn: &mut Connection, tool: &str, entries: &[KbIn]) -> Result<usize, String> {
    let tx = conn.transaction().map_err(err)?;
    let mut fresh = 0;
    for e in entries {
        let kind = if e.kind == "sub" { "sub" } else { "flag" };
        let existing: Option<String> = tx
            .query_row(
                "SELECT id FROM kb_entry WHERE tool = ?1 AND token = ?2 AND kind = ?3",
                (tool, &e.token, kind),
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        match existing {
            Some(id) => {
                tx.execute(
                    "UPDATE kb_entry SET meaning = ?1, source = 'system', updated_at = ?2 WHERE id = ?3",
                    (&e.meaning, now_iso(), id),
                )
                .map_err(err)?;
            }
            None => {
                tx.execute(
                    "INSERT INTO kb_entry (id, tool, token, kind, meaning, source, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, 'system', ?6)",
                    (new_id(), tool, &e.token, kind, &e.meaning, now_iso()),
                )
                .map_err(err)?;
                fresh += 1;
            }
        }
    }
    tx.commit().map_err(err)?;
    Ok(fresh)
}

#[tauri::command]
pub async fn kb_list(db: tauri::State<'_, Db>) -> Result<Vec<KbRow>, String> {
    let conn = db.lock().unwrap();
    let mut stmt = conn.prepare("SELECT tool, token, kind, meaning FROM kb_entry").map_err(err)?;
    let rows = stmt
        .query_map([], |r| Ok(KbRow { tool: r.get(0)?, token: r.get(1)?, kind: r.get(2)?, meaning: r.get(3)? }))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    Ok(rows)
}

#[tauri::command]
pub async fn kb_upsert(db: tauri::State<'_, Db>, tool: String, entries: Vec<KbIn>) -> Result<usize, String> {
    upsert(&mut db.lock().unwrap(), &tool, &entries)
}

#[tauri::command]
pub async fn setting_get(db: tauri::State<'_, Db>, key: String) -> Result<Option<String>, String> {
    Ok(crate::db::setting_get(&db.lock().unwrap(), &key))
}

#[tauri::command]
pub async fn setting_set(db: tauri::State<'_, Db>, key: String, value: String) -> Result<(), String> {
    crate::db::setting_set(&db.lock().unwrap(), &key, &value).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_memory;

    #[test]
    fn a_resync_updates_meanings_without_duplicating() {
        let mut c = open_memory();
        let e = |m: &str| vec![KbIn { token: "--sync".into(), kind: "flag".into(), meaning: m.into() }];
        assert_eq!(upsert(&mut c, "pacman", &e("old")).unwrap(), 1);
        assert_eq!(upsert(&mut c, "pacman", &e("new")).unwrap(), 0);
        let (n, m): (i64, String) = c
            .query_row("SELECT COUNT(*), MAX(meaning) FROM kb_entry", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!((n, m.as_str()), (1, "new"));
    }
}
