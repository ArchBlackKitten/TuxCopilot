// App Manager's background usage tracker, ported from lib/usage-tracker.ts. A thread reads
// the process table from /proc every N seconds while the app runs and recognises apps two
// ways: the curated table the views also use (src/lib/process-map.json), then every program
// that has a menu entry (desktop.rs) — so a new app is tracked without anyone listing it.
// It accumulates a per-day, per-app log in usage_day:
//
//   seconds  — how long the app was observed running (delta per tick, with a capped
//              backfill when a process predates the tracker)
//   sessions — how many times it was (re)started, separated by a 10-minute gap
//
// The monthly log is every usage_day row grouped by its `month` key.

use chrono::{Datelike, Local};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::db::{err, new_id, now_iso, setting_get, setting_set, Db};
use crate::desktop::{self, DesktopApp, Index};

const SESSION_GAP_MS: i64 = 10 * 60 * 1000; // >10 min unseen → new session
const BACKFILL_CAP_S: i64 = 15 * 60; // never backfill more than 15 min
const DEFAULT_INTERVAL_S: u64 = 30;
const ALLOWED_INTERVALS: [u64; 4] = [15, 30, 60, 120];
const INDEX_REFRESH_MS: i64 = 10 * 60 * 1000; // pick up newly installed apps

// ── the shared process map ───────────────────────────────────────────────

#[derive(Deserialize, Clone)]
pub struct MapEntry {
    pub app: String,
    pub source: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Table {
    map: HashMap<String, MapEntry>,
    noise_exact: HashSet<String>,
}

fn table() -> &'static Table {
    static T: OnceLock<Table> = OnceLock::new();
    T.get_or_init(|| {
        serde_json::from_str(include_str!("../../src/lib/process-map.json")).expect("process-map.json parses")
    })
}

/// Mirrors isNoise() in process-map.ts.
fn is_noise(comm: &str) -> bool {
    comm.is_empty()
        || (comm.starts_with('[') && comm.ends_with(']'))
        || ["kworker", "ksoftirqd", "migration", "kcompactd", "khugepaged"].iter().any(|p| comm.starts_with(p))
        || table().noise_exact.contains(comm)
}

/// Mirrors mapComm() in process-map.ts.
pub fn map_comm(comm: &str) -> Option<&'static MapEntry> {
    let raw = comm.trim();
    if is_noise(raw) {
        return None;
    }
    let t = table();
    t.map.get(&raw.to_lowercase()).or_else(|| t.map.get(raw))
}

struct Seen {
    source: String,
    etimes: i64, // max etimes among that app's processes this tick
}

/// One running process, as /proc describes it.
pub struct Proc {
    comm: String,
    exe: Option<String>,   // the real binary (unreadable for other users' processes)
    argv0: Option<String>, // what it was started as (the script, for interpreters)
    etimes: i64,           // seconds since it started
}

/// The process table, read straight from /proc (what `ps` itself reads).
fn read_procs() -> Vec<Proc> {
    let uptime: f64 = std::fs::read_to_string("/proc/uptime")
        .ok()
        .and_then(|s| s.split_whitespace().next()?.parse().ok())
        .unwrap_or(0.0);
    // SAFETY: sysconf only reads a configuration value.
    let tck = match unsafe { libc::sysconf(libc::_SC_CLK_TCK) } {
        n if n > 0 => n as f64,
        _ => 100.0,
    };
    let Ok(rd) = std::fs::read_dir("/proc") else { return vec![] };
    let mut out = vec![];
    for e in rd.flatten() {
        let name = e.file_name();
        let Some(pid) = name.to_str().filter(|n| n.bytes().all(|b| b.is_ascii_digit())) else { continue };
        let dir = format!("/proc/{pid}");
        let Ok(stat) = std::fs::read_to_string(format!("{dir}/stat")) else { continue };
        // "pid (comm) state …" — comm may hold spaces and parentheses, so cut at the LAST ')'
        let (Some(open), Some(close)) = (stat.find('('), stat.rfind(')')) else { continue };
        let comm = stat[open + 1..close].to_string();
        let Some(start) = stat[close + 1..].split_whitespace().nth(19).and_then(|v| v.parse::<f64>().ok()) else { continue };
        let cmdline = std::fs::read(format!("{dir}/cmdline")).unwrap_or_default();
        if cmdline.is_empty() {
            continue; // kernel threads have no command line
        }
        let argv0 = cmdline.split(|b| *b == 0).next().map(|a| String::from_utf8_lossy(a).into_owned()).filter(|a| !a.is_empty());
        let exe = std::fs::read_link(format!("{dir}/exe"))
            .ok()
            .map(|p| p.to_string_lossy().trim_end_matches(" (deleted)").to_string());
        out.push(Proc { comm, exe, argv0, etimes: (uptime - start / tck).max(0.0) as i64 });
    }
    out
}

/// Which apps are running this tick: the curated table first (it knows the odd ones, like
/// browsers' renamed processes), then anything with a menu entry.
fn classify(procs: &[Proc], idx: &Index) -> HashMap<String, Seen> {
    let mut seen: HashMap<String, Seen> = HashMap::new();
    for p in procs {
        let comm = p.comm.trim();
        let (app, source) = if let Some(m) = map_comm(comm) {
            (m.app.clone(), m.source.clone())
        } else if is_noise(comm) {
            continue;
        } else if let Some(d) = idx.match_process(p.exe.as_deref(), p.argv0.as_deref(), comm) {
            (d.package.clone(), d.source.clone())
        } else {
            continue;
        };
        let e = seen.entry(app).or_insert(Seen { source: source.clone(), etimes: -1 });
        if p.etimes > e.etimes {
            e.etimes = p.etimes;
            e.source = source;
        }
    }
    seen
}

#[cfg(test)]
fn parse_sample(stdout: &str) -> HashMap<String, Seen> {
    // "comm etimes" lines, as the tests write them
    let procs: Vec<Proc> = stdout
        .lines()
        .filter_map(|l| {
            let (comm, num) = l.trim_end().rsplit_once(char::is_whitespace)?;
            Some(Proc { comm: comm.trim().into(), exe: None, argv0: None, etimes: num.parse().ok()? })
        })
        .collect();
    classify(&procs, &Index::default())
}

// ── the tracker ──────────────────────────────────────────────────────────

struct Live {
    last_etimes: i64,
    last_seen: i64,
}

struct Inner {
    running: bool,
    interval_sec: u64,
    started_at: Option<i64>,
    last_sample_at: Option<i64>,
    samples: u64,
    last_error: Option<String>,
    live: HashMap<String, Live>,
    now_running: BTreeSet<String>,
    next_tick: Option<i64>,
}

pub struct Tracker {
    inner: Mutex<Inner>,
    index: Mutex<(Index, i64)>, // the menu index and when it was built
    db: Db,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackerStatus {
    running: bool,
    interval_sec: u64,
    started_at: Option<String>,
    last_sample_at: Option<String>,
    samples: u64,
    last_error: Option<String>,
    now_running: Vec<String>,
    live_apps: Vec<String>,
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn iso(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .unwrap_or_default()
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Local-time day/month keys, as the Node tracker used.
fn today_keys() -> (String, String) {
    let d = Local::now();
    (
        format!("{:04}-{:02}-{:02}", d.year(), d.month(), d.day()),
        format!("{:04}-{:02}", d.year(), d.month()),
    )
}

/// Adds one tick's observations. Returns the apps that started a new session.
fn persist_tick(conn: &Connection, t: &mut Inner, seen: &HashMap<String, Seen>, now: i64, day: &str, month: &str) -> Vec<String> {
    let mut new_sessions = vec![];
    for (app, entry) in seen {
        let prev = t.live.get(app);
        let gap_too_big = prev.is_none_or(|p| now - p.last_seen > SESSION_GAP_MS);
        let continuous = prev.is_some_and(|p| {
            entry.etimes > p.last_etimes && entry.etimes - p.last_etimes <= 2 * t.interval_sec as i64 + 10
        });
        let delta = if continuous {
            entry.etimes - prev.unwrap().last_etimes // natural growth
        } else {
            entry.etimes.min(BACKFILL_CAP_S) // first sight / restart → capped backfill
        }
        .max(0);
        t.live.insert(app.clone(), Live { last_etimes: entry.etimes, last_seen: now });
        if gap_too_big {
            new_sessions.push(app.clone());
        }
        let res = conn.execute(
            "INSERT INTO usage_day (id, day, month, app, source, seconds, sessions, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(day, app) DO UPDATE SET
               seconds = seconds + excluded.seconds,
               sessions = sessions + excluded.sessions,
               source = excluded.source,
               updated_at = excluded.updated_at",
            (new_id(), day, month, app, &entry.source, delta, gap_too_big as i64, now_iso()),
        );
        if let Err(e) = res {
            t.last_error = Some(e.to_string());
        }
    }
    // forget apps that vanished more than two session gaps ago (memory hygiene)
    t.live.retain(|app, p| seen.contains_key(app) || now - p.last_seen <= SESSION_GAP_MS * 2);
    new_sessions
}

impl Tracker {
    /// Boots with the persisted on/off and interval (default ON — the log must build up in
    /// the background), and starts the sampling thread.
    pub fn boot(db: Db) -> Arc<Self> {
        let (running, interval) = {
            let c = db.lock().unwrap();
            let running = setting_get(&c, "tracker.running").as_deref() != Some("0");
            let interval = setting_get(&c, "tracker.intervalSec")
                .and_then(|v| v.parse::<u64>().ok())
                .filter(|n| ALLOWED_INTERVALS.contains(n))
                .unwrap_or(DEFAULT_INTERVAL_S);
            (running, interval)
        };
        let now = now_ms();
        let t = Arc::new(Tracker {
            inner: Mutex::new(Inner {
                running,
                interval_sec: interval,
                started_at: running.then_some(now),
                last_sample_at: None,
                samples: 0,
                last_error: None,
                live: HashMap::new(),
                now_running: BTreeSet::new(),
                // warm-up sample shortly after boot so the view has fresh data
                next_tick: running.then_some(now + 3000),
            }),
            index: Mutex::new((Index::default(), 0)),
            db,
        });
        let me = Arc::clone(&t);
        thread::spawn(move || loop {
            thread::sleep(Duration::from_millis(250));
            let due = {
                let g = me.inner.lock().unwrap();
                g.running && g.next_tick.is_some_and(|n| now_ms() >= n)
            };
            if due {
                me.tick();
            }
        });
        t
    }

    /// The menu index, rebuilt when it is older than INDEX_REFRESH_MS (or never built).
    fn fresh_index(&self) -> std::sync::MutexGuard<'_, (Index, i64)> {
        let mut g = self.index.lock().unwrap();
        let now = now_ms();
        if g.1 == 0 || now - g.1 > INDEX_REFRESH_MS {
            *g = (desktop::build(), now);
        }
        g
    }

    /// Rebuilds the menu index now; returns how many apps it holds.
    pub fn refresh_index(&self) -> usize {
        let idx = desktop::build();
        let n = idx.apps.len();
        *self.index.lock().unwrap() = (idx, now_ms());
        n
    }

    pub fn desktop_apps(&self) -> Vec<DesktopApp> {
        self.fresh_index().0.apps.clone()
    }

    fn tick(&self) {
        let procs = read_procs();
        let seen = classify(&procs, &self.fresh_index().0);
        let now = now_ms();
        let mut g = self.inner.lock().unwrap();
        g.next_tick = Some(now + g.interval_sec as i64 * 1000);
        if procs.is_empty() {
            g.last_error = Some("could not read the process table (/proc)".into());
            return;
        }
        g.now_running = seen.keys().cloned().collect();
        let (day, month) = today_keys();
        let conn = self.db.lock().unwrap();
        g.last_error = None;
        persist_tick(&conn, &mut g, &seen, now, &day, &month);
        g.last_sample_at = Some(now);
        g.samples += 1;
        // a light status trail that survives restarts
        if g.samples % 20 == 1 {
            let _ = setting_set(&conn, "tracker.lastSampleAt", &iso(now));
            let _ = setting_set(&conn, "tracker.samples", &g.samples.to_string());
        }
    }

    pub fn status(&self) -> TrackerStatus {
        let g = self.inner.lock().unwrap();
        let mut live: Vec<String> = g.live.keys().cloned().collect();
        live.sort();
        TrackerStatus {
            running: g.running,
            interval_sec: g.interval_sec,
            started_at: g.started_at.map(iso),
            last_sample_at: g.last_sample_at.map(iso),
            samples: g.samples,
            last_error: g.last_error.clone(),
            now_running: g.now_running.iter().cloned().collect(),
            live_apps: live,
        }
    }

    pub fn set_running(&self, running: bool) -> TrackerStatus {
        {
            let mut g = self.inner.lock().unwrap();
            g.running = running;
            if running {
                let now = now_ms();
                g.started_at = Some(now);
                g.next_tick = Some(now + 500);
            } else {
                g.next_tick = None;
            }
        }
        let _ = setting_set(&self.db.lock().unwrap(), "tracker.running", if running { "1" } else { "0" });
        self.status()
    }

    pub fn set_interval(&self, sec: u64) -> TrackerStatus {
        {
            let mut g = self.inner.lock().unwrap();
            g.interval_sec = if ALLOWED_INTERVALS.contains(&sec) { sec } else { DEFAULT_INTERVAL_S };
            if g.running {
                g.next_tick = Some(now_ms() + g.interval_sec as i64 * 1000);
            }
            let v = g.interval_sec.to_string();
            drop(g);
            let _ = setting_set(&self.db.lock().unwrap(), "tracker.intervalSec", &v);
        }
        self.status()
    }
}

// ── the usage log ────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct UsageRow {
    day: String,
    month: String,
    app: String,
    source: String,
    seconds: i64,
    sessions: i64,
}

fn valid_day(d: &str) -> bool {
    d.len() == 10 && chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").is_ok()
}

/// Simulated rows are added on top of simulated rows only — a real row is never touched.
pub fn seed(conn: &mut Connection, rows: &[UsageRow]) -> Result<usize, String> {
    let tx = conn.transaction().map_err(err)?;
    let mut n = 0;
    for r in rows {
        if !valid_day(&r.day) || !r.day.starts_with(&r.month) {
            continue;
        }
        n += tx
            .execute(
                "INSERT INTO usage_day (id, day, month, app, source, seconds, sessions, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 'simulated', ?5, ?6, ?7)
                 ON CONFLICT(day, app) DO UPDATE SET
                   seconds = seconds + excluded.seconds,
                   sessions = sessions + excluded.sessions,
                   updated_at = excluded.updated_at
                 WHERE usage_day.source = 'simulated'",
                (new_id(), &r.day, &r.month, &r.app, r.seconds.max(0), r.sessions.max(0), now_iso()),
            )
            .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(n)
}

// ── commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn tracker_status(t: tauri::State<'_, Arc<Tracker>>) -> Result<TrackerStatus, String> {
    Ok(t.status())
}

#[tauri::command]
pub async fn tracker_set_running(t: tauri::State<'_, Arc<Tracker>>, running: bool) -> Result<TrackerStatus, String> {
    Ok(t.set_running(running))
}

#[tauri::command]
pub async fn tracker_set_interval(t: tauri::State<'_, Arc<Tracker>>, sec: u64) -> Result<TrackerStatus, String> {
    Ok(t.set_interval(sec))
}

#[tauri::command]
pub async fn usage_rows(db: tauri::State<'_, Db>) -> Result<Vec<UsageRow>, String> {
    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT day, month, app, source, seconds, sessions FROM usage_day")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(UsageRow {
                day: r.get(0)?,
                month: r.get(1)?,
                app: r.get(2)?,
                source: r.get(3)?,
                seconds: r.get(4)?,
                sessions: r.get(5)?,
            })
        })
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    Ok(rows)
}

#[tauri::command]
pub async fn usage_seed(db: tauri::State<'_, Db>, rows: Vec<UsageRow>) -> Result<usize, String> {
    seed(&mut db.lock().unwrap(), &rows)
}

#[tauri::command]
pub async fn usage_clear_simulated(db: tauri::State<'_, Db>) -> Result<usize, String> {
    db.lock().unwrap().execute("DELETE FROM usage_day WHERE source = 'simulated'", []).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_memory;

    fn inner() -> Inner {
        Inner {
            running: true,
            interval_sec: 30,
            started_at: None,
            last_sample_at: None,
            samples: 0,
            last_error: None,
            live: HashMap::new(),
            now_running: BTreeSet::new(),
            next_tick: None,
        }
    }

    fn row(c: &Connection, app: &str) -> (i64, i64) {
        c.query_row("SELECT seconds, sessions FROM usage_day WHERE app = ?1", [app], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
    }

    /// Diagnostic, not a gate: `cargo test live_sample -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_sample() {
        let idx = desktop::build();
        let procs = read_procs();
        let mut seen: Vec<_> = classify(&procs, &idx).into_iter().map(|(a, s)| format!("{a} ({}, {}s)", s.source, s.etimes)).collect();
        seen.sort();
        println!("{} processes, {} menu apps indexed\nrunning apps: {seen:#?}", procs.len(), idx.apps.len());
    }

    #[test]
    fn the_map_matches_truncated_comm_and_ignores_noise() {
        assert_eq!(map_comm("firefox").unwrap().app, "firefox");
        assert_eq!(map_comm("Firefox").unwrap().app, "firefox", "lower-cased first");
        assert!(map_comm("bash").is_none());
        assert!(map_comm("kworker/0:1-events").is_none());
        assert!(map_comm("[kthreadd]").is_none());
        assert!(map_comm("appmanager").is_none(), "this app never logs itself");
        assert!(map_comm("archmanager").is_none(), "nor under its new name");
        assert!(map_comm("tuxcopilot").is_none(), "nor under its newest");
    }

    #[test]
    fn ticks_accumulate_time_and_count_sessions_across_gaps() {
        let c = open_memory();
        let mut t = inner();
        let s = parse_sample("firefox  100\nfirefox 40\nbash 999\n");
        assert_eq!(s["firefox"].etimes, 100, "the oldest process counts");

        persist_tick(&c, &mut t, &s, 1_000_000, "2026-10-26", "2026-10");
        assert_eq!(row(&c, "firefox"), (100, 1), "first sight: backfill + a session");

        let s2 = parse_sample("firefox 130\n");
        persist_tick(&c, &mut t, &s2, 1_030_000, "2026-10-26", "2026-10");
        assert_eq!(row(&c, "firefox"), (130, 1), "continuous: +30s, same session");

        // eleven minutes unseen, then a fresh process
        let s3 = parse_sample("firefox 5\n");
        persist_tick(&c, &mut t, &s3, 1_030_000 + 11 * 60 * 1000, "2026-10-26", "2026-10");
        assert_eq!(row(&c, "firefox"), (135, 2), "restart after the gap: new session");

        let first_sight_cap = parse_sample("code 99999\n");
        persist_tick(&c, &mut t, &first_sight_cap, 2_000_000, "2026-10-26", "2026-10");
        assert_eq!(row(&c, "code").0, BACKFILL_CAP_S);
    }

    #[test]
    fn seeding_never_touches_real_rows() {
        let mut c = open_memory();
        let mut t = inner();
        persist_tick(&c, &mut t, &parse_sample("firefox 60\n"), 1, "2026-10-01", "2026-10");
        let rows = vec![
            UsageRow { day: "2026-10-01".into(), month: "2026-10".into(), app: "firefox".into(), source: "simulated".into(), seconds: 9999, sessions: 9 },
            UsageRow { day: "2026-10-02".into(), month: "2026-10".into(), app: "vlc".into(), source: "simulated".into(), seconds: 50, sessions: 1 },
            UsageRow { day: "bogus".into(), month: "2026-10".into(), app: "x".into(), source: "simulated".into(), seconds: 1, sessions: 1 },
        ];
        assert_eq!(seed(&mut c, &rows).unwrap(), 1);
        assert_eq!(row(&c, "firefox"), (60, 1));
        assert_eq!(row(&c, "vlc"), (50, 1));
    }
}
