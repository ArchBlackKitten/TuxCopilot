// The store: one SQLite file in the app's data directory, replacing the Prisma schema the
// Next.js version used. Five tables, the same five models:
//
//   node       — the section/item tree (self-referencing, unlimited depth)
//   run_log    — history of play runs, dry runs included
//   kb_entry   — Arch Commands knowledge learned from this machine's --help output
//   setting    — small key/value store (tracker state, last KB sync, package cache)
//   usage_day  — App Manager's daily usage log, one row per (day, app)
//
// Shared behind one Mutex by the commands, the run engine and the usage tracker.

use rusqlite::Connection;
use std::path::Path;
use std::sync::{Arc, Mutex};

pub type Db = Arc<Mutex<Connection>>;

const SCHEMA: &str = r#"
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS node (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'command',
  source     TEXT,
  content    TEXT,
  enabled    INTEGER NOT NULL DEFAULT 1,
  ord        INTEGER NOT NULL DEFAULT 0,
  parent_id  TEXT REFERENCES node(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS node_parent ON node(parent_id);

CREATE TABLE IF NOT EXISTS run_log (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL DEFAULT 'Run',
  commands   TEXT NOT NULL DEFAULT '[]',
  output     TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'running',
  dry_run    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kb_entry (
  id         TEXT PRIMARY KEY,
  tool       TEXT NOT NULL,
  token      TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'flag',
  meaning    TEXT NOT NULL,
  example    TEXT,
  source     TEXT NOT NULL DEFAULT 'system',
  updated_at TEXT NOT NULL,
  UNIQUE (tool, token, kind)
);
CREATE INDEX IF NOT EXISTS kb_tool ON kb_entry(tool);

CREATE TABLE IF NOT EXISTS setting (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_day (
  id         TEXT PRIMARY KEY,
  day        TEXT NOT NULL,
  month      TEXT NOT NULL,
  app        TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'other',
  seconds    INTEGER NOT NULL DEFAULT 0,
  sessions   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE (day, app)
);
CREATE INDEX IF NOT EXISTS usage_month_app ON usage_day(month, app);
"#;

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}

// ── sealed with SQLCipher (the lock's data key; see lock.rs) ─────────────

const TABLES: &[&str] = &["node", "run_log", "kb_entry", "setting", "usage_day"];

fn key_literal(key: &[u8; 32]) -> String {
    format!("x'{}'", key.iter().map(|b| format!("{b:02x}")).collect::<String>())
}

/// The key comes first — before anything reads the file — then a read proves it is the right one.
pub fn open_sealed(path: &Path, key: &[u8; 32]) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(err)?;
    conn.execute_batch(&format!("PRAGMA key = \"{}\";", key_literal(key))).map_err(err)?;
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0))
        .map_err(|_| "the key does not open this database".to_string())?;
    conn.execute_batch(SCHEMA).map_err(err)?;
    Ok(conn)
}

/// SQLCipher's version, or None: proves this program really talks to SQLCipher.
pub fn cipher_version(conn: &Connection) -> Option<String> {
    conn.query_row("PRAGMA cipher_version", [], |r| r.get::<_, String>(0)).ok().filter(|v| !v.is_empty())
}

fn counts(conn: &Connection) -> Result<Vec<i64>, String> {
    TABLES.iter().map(|t| conn.query_row(&format!("SELECT count(*) FROM {t}"), [], |r| r.get(0)).map_err(err)).collect()
}

/// The plain database becomes a sealed one in place: copied with sqlcipher_export, read back
/// (every table holds as many rows as before), then put where the plain one was — its WAL and
/// shared-memory files go too, or they would keep plain pages. No file yet: a new sealed one.
pub fn seal_file(path: &Path, key: &[u8; 32]) -> Result<(), String> {
    if !path.exists() {
        return open_sealed(path, key).map(|_| ());
    }
    let mut sealing = path.as_os_str().to_owned();
    sealing.push(".sealing");
    let sealing = std::path::PathBuf::from(sealing);
    let _ = std::fs::remove_file(&sealing);
    let before = {
        let plain = Connection::open(path).map_err(err)?;
        plain.execute_batch(SCHEMA).map_err(|_| "this database is not a plain one (sealed already?)".to_string())?;
        plain.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").map_err(err)?;
        let before = counts(&plain)?;
        plain.execute("ATTACH DATABASE ?1 AS sealed KEY ?2", (sealing.to_string_lossy(), key_literal(key))).map_err(err)?;
        plain.query_row("SELECT sqlcipher_export('sealed')", [], |_| Ok(())).map_err(err)?;
        plain.execute_batch("DETACH DATABASE sealed;").map_err(err)?;
        before
    };
    // read back before anything is replaced
    let after = counts(&open_sealed(&sealing, key)?)?;
    if before != after {
        let _ = std::fs::remove_file(&sealing);
        return Err(format!("the sealed copy differs ({before:?} rows before, {after:?} after); nothing was changed"));
    }
    std::fs::rename(&sealing, path).map_err(err)?;
    for end in ["-wal", "-shm"] {
        let mut p = path.as_os_str().to_owned();
        p.push(end);
        let _ = std::fs::remove_file(std::path::PathBuf::from(p));
    }
    Ok(())
}

/// The empty database TuxCopilot starts with, until the gate connects the sealed one.
pub fn open_memory_placeholder() -> Connection {
    let conn = Connection::open_in_memory().expect("an in-memory database");
    conn.execute_batch(SCHEMA).expect("the schema");
    conn
}

#[cfg(test)]
pub fn open_memory() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(SCHEMA).unwrap();
    conn
}

/// JavaScript's `new Date().toISOString()` — the timestamp shape the views already parse.
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// Rust commands reject with a plain string; the views show it as-is.
pub fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub fn setting_get(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM setting WHERE key = ?1", [key], |r| r.get(0)).ok()
}

pub fn setting_set(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO setting (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (key, value, now_iso()),
    )?;
    Ok(())
}

#[cfg(test)]
mod sealed_tests {
    use super::*;

    #[test]
    fn this_program_really_speaks_sqlcipher() {
        // WebKit loads plain libsqlite3 into the same program: the calls must still reach SQLCipher
        let v = cipher_version(&Connection::open_in_memory().unwrap());
        assert!(v.is_some_and(|v| v.starts_with('4')), "SQLCipher 4");
    }

    #[test]
    fn a_plain_database_is_sealed_in_place_and_only_the_key_opens_it() {
        let d = std::env::temp_dir().join(format!("am-seal-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let path = d.join("tuxcopilot.db");
        {
            let plain = open(&path).unwrap();
            setting_set(&plain, "marker", "PLAIN-TEXT-THAT-MUST-VANISH").unwrap();
            for i in 0..50 {
                setting_set(&plain, &format!("k{i}"), "v").unwrap();
            }
        }
        let key = [7u8; 32];
        seal_file(&path, &key).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert!(!bytes.windows(10).any(|w| w == b"PLAIN-TEXT"), "no plain text left in the file");
        assert!(!bytes.starts_with(b"SQLite format 3"), "not a plain SQLite file any more");
        assert!(!d.join("tuxcopilot.db-wal").exists() || std::fs::read(d.join("tuxcopilot.db-wal")).unwrap().is_empty());
        let sealed = open_sealed(&path, &key).unwrap();
        assert_eq!(setting_get(&sealed, "marker").as_deref(), Some("PLAIN-TEXT-THAT-MUST-VANISH"));
        drop(sealed);
        assert!(open_sealed(&path, &[8u8; 32]).unwrap_err().contains("does not open"));
        assert!(Connection::open(&path).unwrap().query_row("SELECT count(*) FROM setting", [], |r| r.get::<_, i64>(0)).is_err(), "no key: unreadable");
        assert!(seal_file(&path, &key).unwrap_err().contains("not a plain one"), "sealing twice is refused");
        // no database yet: a new sealed one
        let fresh = d.join("new.db");
        seal_file(&fresh, &key).unwrap();
        assert!(open_sealed(&fresh, &key).is_ok());
        std::fs::remove_dir_all(&d).unwrap();
    }
}
