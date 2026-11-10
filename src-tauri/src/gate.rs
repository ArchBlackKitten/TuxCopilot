// The gate: TuxCopilot always starts with an empty database in memory, and your real one —
// sealed by the lock's data key (lock.rs, SQLCipher) — is connected only once you open it:
// the 30-second code AND the password code. Before that there is nothing to read.
//
//   first start   setup: the phone scans a QR code, you choose a password code, you write
//                 the seed words (9 unless you chose otherwise) down and type some back; the database is sealed.
//   every start   the code + the password code.
//   a pause       while open, it locks itself after a while (your choice); either the
//                 password code or the code — your choice — opens it again.
//   lost          the seed (or the recovery file + the seed) opens the data key; a new
//                 phone and a new password code are set.
//
// Wrong answers slow down: after three, each try waits longer (up to five minutes).

use crate::db::{self, Db};
use crate::lock::{self, Key, LockFile, PauseSettings, KDF};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use zeroize::Zeroizing;

const WRONG: &str = "The code or the password code is not right.";

struct Pending {
    key: Key,
    code_secret: Zeroizing<Vec<u8>>,
    seed: Zeroizing<String>,
    code_ok: bool,
    recovering: bool, // the data key came from the seed: the database is sealed already
}

#[derive(Default)]
struct Inner {
    file: Option<LockFile>,
    key: Option<Key>,
    code_secret: Option<Zeroizing<Vec<u8>>>,
    open: bool,
    paused: bool,
    pending: Option<Pending>,
    new_phone: Option<Zeroizing<Vec<u8>>>,
    failures: u32,
    wait_until: Option<Instant>,
}

pub struct Gate {
    lock_path: PathBuf,
    db_path: PathBuf,
    db: Db,
    inner: Mutex<Inner>,
    kdf: lock::Kdf,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub set_up: bool,
    pub open: bool,
    pub paused: bool,
    pub needs_recovery: bool, // a sealed database, but no lock.json: the seed brings it back
    pub pause: PauseSettings,
    pub wait_seconds: u64,
    /// Tied to this computer's security chip (lock.rs machine).
    #[serde(default)]
    pub tied: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Enrol {
    pub qr: String,          // SVG, for the phone's authenticator app
    pub secret: String,      // the same, to type in by hand
    pub seed: Vec<String>,   // empty when recovering (the seed stays the same)
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// A database file that is not plain SQLite: sealed.
pub fn is_sealed(path: &Path) -> bool {
    std::fs::read(path).is_ok_and(|b| b.len() >= 16 && !b.starts_with(b"SQLite format 3\0"))
}

fn write_private(path: &Path, text: &str) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let tmp = path.with_extension("json.new");
    let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&tmp).map_err(db::err)?;
    f.write_all(text.as_bytes()).and_then(|_| f.sync_all()).map_err(db::err)?;
    std::fs::rename(&tmp, path).map_err(db::err)
}

impl Gate {
    pub fn new(data_dir: &Path, db: Db) -> Gate {
        Gate::with_kdf(data_dir, db, KDF)
    }

    pub fn with_kdf(data_dir: &Path, db: Db, kdf: lock::Kdf) -> Gate {
        let lock_path = data_dir.join("lock.json");
        let file: Option<LockFile> = std::fs::read_to_string(&lock_path).ok().and_then(|t| serde_json::from_str(&t).ok());
        // the wrong tries and the wait survive a restart
        let failures = file.as_ref().map(|f| f.failures).unwrap_or(0);
        let wait_until = file.as_ref().and_then(|f| f.wait_until).filter(|u| *u > now()).map(|u| Instant::now() + Duration::from_secs(u - now()));
        Gate { lock_path, db_path: data_dir.join("tuxcopilot.db"), db, inner: Mutex::new(Inner { file, failures, wait_until, ..Default::default() }), kdf }
    }

    /// Writes the count of wrong tries and the wait into lock.json (best effort: a full disk
    /// must not stop the answer from being judged).
    fn keep_tries(&self, g: &mut Inner) {
        let Some(f) = g.file.clone() else { return };
        let until = g.wait_until.map(|w| now() + w.saturating_duration_since(Instant::now()).as_secs() + 1);
        if f.failures == g.failures && f.wait_until == until {
            return;
        }
        let f = LockFile { failures: g.failures, wait_until: until, ..f };
        if self.save(&f).is_ok() {
            g.file = Some(f);
        }
    }

    fn save(&self, f: &LockFile) -> Result<(), String> {
        write_private(&self.lock_path, &serde_json::to_string_pretty(f).map_err(db::err)?)
    }

    pub fn status(&self) -> Status {
        let g = self.inner.lock().unwrap();
        Status {
            set_up: g.file.is_some(),
            open: g.open,
            paused: g.paused,
            needs_recovery: g.file.is_none() && is_sealed(&self.db_path),
            pause: g.file.as_ref().map(|f| f.pause.clone()).unwrap_or_default(),
            // rounded up: 0.4 s left is still a wait
            wait_seconds: g.wait_until.map(|w| (w.saturating_duration_since(Instant::now()).as_millis() as u64).div_ceil(1000)).unwrap_or(0),
            tied: g.file.as_ref().is_some_and(|f| f.machine.is_some()),
        }
    }

    /// Too many wrong answers: wait. Returns the error to show, if any.
    fn waiting(g: &Inner) -> Option<String> {
        let left = g.wait_until?.saturating_duration_since(Instant::now());
        (!left.is_zero()).then(|| format!("Too many wrong tries: wait {} seconds.", left.as_secs() + 1))
    }

    fn wrong(g: &mut Inner) -> String {
        g.failures += 1;
        if g.failures >= 3 {
            let secs = (1u64 << (g.failures - 3).min(9)).min(300);
            g.wait_until = Some(Instant::now() + Duration::from_secs(secs));
        }
        WRONG.into()
    }

    /// Swap the empty in-memory database for the sealed one.
    fn connect(&self, key: &Key) -> Result<(), String> {
        let conn = db::open_sealed(&self.db_path, key)?;
        *self.db.lock().unwrap() = conn;
        Ok(())
    }

    // ── first start ──────────────────────────────────────────────────────

    /// `words`: how long the seed is (lock::SEED_WORDS, 9, unless you chose otherwise).
    pub fn setup_begin(&self, words: usize) -> Result<Enrol, String> {
        let mut g = self.inner.lock().unwrap();
        if g.file.is_some() {
            return Err("TuxCopilot is set up already".into());
        }
        let seed = lock::new_seed(words);
        let p = Pending {
            key: lock::new_key(),
            code_secret: Zeroizing::new(lock::random::<20>().to_vec()),
            seed: Zeroizing::new(seed.join(" ")),
            code_ok: false,
            recovering: false,
        };
        let e = Enrol { qr: lock::qr_svg(&lock::otpauth(&p.code_secret, "you")), secret: lock::base32(&p.code_secret), seed };
        g.pending = Some(p);
        Ok(e)
    }

    /// The phone shows the right code: it is set up.
    pub fn setup_code(&self, code: &str) -> Result<(), String> {
        let mut g = self.inner.lock().unwrap();
        let p = g.pending.as_mut().ok_or("start again")?;
        if lock::check_code(&p.code_secret, code, now(), None).is_none() {
            return Err("That is not the code your app shows now. Check that the device's clock is right, and try the next one.".into());
        }
        p.code_ok = true;
        Ok(())
    }

    /// The seed words for the recovery file (only while setting up: afterwards they are gone).
    pub fn recovery_text(&self) -> Result<String, String> {
        let g = self.inner.lock().unwrap();
        let p = g.pending.as_ref().ok_or("the recovery file can only be made while setting up")?;
        String::from_utf8(lock::recovery_file(&p.key, &p.seed)?).map_err(db::err)
    }

    /// The password code, and the seed words you typed back (position, word). Then the database
    /// is sealed and TuxCopilot is open.
    pub fn setup_finish(&self, password: &str, typed: &[(usize, String)]) -> Result<(), String> {
        let mut g = self.inner.lock().unwrap();
        let p = g.pending.as_ref().ok_or("start again")?;
        if !p.code_ok {
            return Err("the phone's code was not confirmed".into());
        }
        lock::password_ok(password)?;
        if !p.recovering {
            let words: Vec<&str> = p.seed.split(' ').collect();
            // three different words (all of them, for a shorter seed): the same one three times is not three
            let distinct: std::collections::HashSet<usize> = typed.iter().map(|(i, _)| *i).collect();
            if distinct.len() < words.len().min(3) || typed.iter().any(|(i, w)| words.get(*i).is_none_or(|x| !w.trim().eq_ignore_ascii_case(x))) {
                return Err("Those seed words do not match. Look at what you wrote down, and type them again.".into());
            }
        }
        let p = g.pending.take().unwrap();
        let file = lock::seal_all(&p.key, &p.code_secret, password, &p.seed, self.kdf, PauseSettings::default())?;
        // the database first: if sealing fails, nothing claims to be set up
        if !p.recovering {
            *self.db.lock().unwrap() = db::open_memory_placeholder(); // let go of the file before sealing it
            db::seal_file(&self.db_path, &p.key)?;
        }
        self.connect(&p.key)?;
        self.save(&file)?;
        g.file = Some(file);
        g.key = Some(p.key);
        g.code_secret = Some(p.code_secret);
        g.open = true;
        Ok(())
    }

    // ── every start ──────────────────────────────────────────────────────

    pub fn open(&self, code: &str, password: &str) -> Result<(), String> {
        let mut g = self.inner.lock().unwrap();
        if let Some(e) = Self::waiting(&g) {
            return Err(e);
        }
        let file = g.file.clone().ok_or("TuxCopilot is not set up yet")?;
        // the chip can't open its seal: say so plainly — it isn't a wrong password code
        let by_password = lock::key_by_password_here(&file, password)?;
        let opened = by_password.and_then(|key| {
            let secret = lock::code_secret(&file, &key)?;
            let step = lock::check_code(&secret, code, now(), file.last_code_step)?;
            Some((key, secret, step))
        });
        let Some((key, secret, step)) = opened else {
            let e = Self::wrong(&mut g);
            self.keep_tries(&mut g);
            return Err(e);
        };
        self.connect(&key)?;
        let file = LockFile { last_code_step: Some(step), failures: 0, wait_until: None, ..file };
        self.save(&file)?;
        g.file = Some(file);
        g.key = Some(key);
        g.code_secret = Some(secret);
        g.open = true;
        g.paused = false;
        g.failures = 0;
        g.wait_until = None;
        self.keep_tries(&mut g);
        Ok(())
    }

    // ── a pause while open ───────────────────────────────────────────────

    pub fn pause(&self) {
        let mut g = self.inner.lock().unwrap();
        if g.open {
            g.paused = true;
        }
    }

    pub fn resume(&self, answer: &str) -> Result<(), String> {
        let mut g = self.inner.lock().unwrap();
        if !g.paused {
            return Ok(());
        }
        if let Some(e) = Self::waiting(&g) {
            return Err(e);
        }
        let file = g.file.clone().ok_or("not set up")?;
        let by_code = file.pause.unlock_with == "code";
        let ok = if by_code {
            let step = g.code_secret.as_ref().and_then(|s| lock::check_code(s, answer, now(), file.last_code_step));
            if let Some(step) = step {
                let f = LockFile { last_code_step: Some(step), ..file };
                self.save(&f)?;
                g.file = Some(f);
            }
            step.is_some()
        } else {
            lock::key_by_password(&file, answer).zip(g.key.as_ref()).is_some_and(|(k, mine)| *k == **mine)
        };
        if !ok {
            let e = Self::wrong(&mut g);
            self.keep_tries(&mut g);
            return Err(if by_code { e.replace("code or the password code", "code") } else { e.replace("code or the ", "") });
        }
        g.paused = false;
        g.failures = 0;
        g.wait_until = None;
        self.keep_tries(&mut g);
        Ok(())
    }

    fn while_open<T>(&self, f: impl FnOnce(&mut Inner) -> Result<T, String>) -> Result<T, String> {
        let mut g = self.inner.lock().unwrap();
        if !g.open || g.paused {
            return Err("open TuxCopilot first".into());
        }
        f(&mut g)
    }

    pub fn set_pause(&self, after_minutes: u32, unlock_with: &str) -> Result<(), String> {
        if !["password", "code"].contains(&unlock_with) || after_minutes > 24 * 60 {
            return Err("not a pause setting".into());
        }
        self.while_open(|g| {
            let f = LockFile { pause: PauseSettings { after_minutes, unlock_with: unlock_with.into() }, ..g.file.clone().unwrap() };
            self.save(&f)?;
            g.file = Some(f);
            Ok(())
        })
    }

    /// The password code proves it is you, even while open: someone at an unlocked computer
    /// cannot change the lock.
    fn is_you(&self, g: &mut Inner, password: &str) -> Result<(), String> {
        if let Some(e) = Self::waiting(g) {
            return Err(e);
        }
        let ok = lock::key_by_password(g.file.as_ref().unwrap(), password).zip(g.key.as_ref()).is_some_and(|(k, mine)| *k == **mine);
        if ok {
            g.failures = 0;
            self.keep_tries(g);
            Ok(())
        } else {
            Self::wrong(g);
            self.keep_tries(g);
            Err("That is not your password code.".into())
        }
    }

    /// Tie the lock to this computer's security chip, or untie it (asks for the password code).
    pub fn tie(&self, password: &str, on: bool) -> Result<(), String> {
        self.while_open(|g| {
            self.is_you(g, password)?;
            let f = g.file.as_ref().unwrap();
            let f = if on { lock::tie_to_machine(f)? } else { lock::untie_from_machine(f)? };
            self.save(&f)?;
            g.file = Some(f);
            Ok(())
        })
    }

    pub fn change_password(&self, current: &str, new: &str) -> Result<(), String> {
        lock::password_ok(new)?;
        self.while_open(|g| {
            self.is_you(g, current)?;
            let f = lock::with_password(g.file.as_ref().unwrap(), g.key.as_ref().unwrap(), new)?;
            self.save(&f)?;
            g.file = Some(f);
            Ok(())
        })
    }

    pub fn new_phone_begin(&self, current: &str) -> Result<Enrol, String> {
        self.while_open(|g| {
            self.is_you(g, current)?;
            let s = Zeroizing::new(lock::random::<20>().to_vec());
            let e = Enrol { qr: lock::qr_svg(&lock::otpauth(&s, "you")), secret: lock::base32(&s), seed: vec![] };
            g.new_phone = Some(s);
            Ok(e)
        })
    }

    pub fn new_phone_finish(&self, code: &str) -> Result<(), String> {
        self.while_open(|g| {
            let s = g.new_phone.as_ref().ok_or("start again")?;
            lock::check_code(s, code, now(), None).ok_or("That is not the code the new device's app shows now.")?;
            let s = g.new_phone.take().unwrap();
            let f = lock::with_code_secret(g.file.as_ref().unwrap(), g.key.as_ref().unwrap(), &s);
            self.save(&f)?;
            g.file = Some(f);
            g.code_secret = Some(s);
            Ok(())
        })
    }

    // ── lost the password code or the phone ──────────────────────────────

    /// The seed (and, when lock.json is gone, the recovery file) opens the data key; the phone
    /// is set up again. The seed itself stays the same — it is on your paper.
    pub fn recover_begin(&self, seed: &str, recovery_file: Option<&str>) -> Result<Enrol, String> {
        let seed = lock::normalize_seed(seed)?;
        let mut g = self.inner.lock().unwrap();
        if let Some(e) = Self::waiting(&g) {
            return Err(e);
        }
        let key = match (&g.file, recovery_file) {
            (Some(f), _) => lock::key_by_seed(f, &seed),
            (None, Some(r)) => lock::key_from_recovery(r.as_bytes(), &seed).ok(),
            (None, None) => return Err("without lock.json, the recovery file is needed too".into()),
        };
        let Some(key) = key else {
            Self::wrong(&mut g);
            return Err("Those seed words do not open it. Check each word against your paper.".into());
        };
        db::open_sealed(&self.db_path, &key)?; // it really opens this database
        let code_secret = Zeroizing::new(lock::random::<20>().to_vec());
        let e = Enrol { qr: lock::qr_svg(&lock::otpauth(&code_secret, "you")), secret: lock::base32(&code_secret), seed: vec![] };
        g.pending = Some(Pending { key, code_secret, seed: Zeroizing::new(seed), code_ok: false, recovering: true });
        g.failures = 0;
        g.wait_until = None;
        Ok(e)
    }

    pub fn lock_now(&self) {
        let mut g = self.inner.lock().unwrap();
        if g.open {
            g.paused = true;
        }
    }
}

// ── commands ─────────────────────────────────────────────────────────────

type G<'a> = tauri::State<'a, Gate>;

#[tauri::command]
pub fn lock_status(gate: G) -> Status {
    gate.status()
}
#[tauri::command]
pub fn lock_setup_begin(gate: G, words: Option<usize>) -> Result<Enrol, String> {
    gate.setup_begin(words.unwrap_or(lock::SEED_WORDS))
}
#[tauri::command]
pub fn lock_setup_code(gate: G, code: String) -> Result<(), String> {
    gate.setup_code(&code)
}
#[tauri::command]
pub fn lock_recovery_text(gate: G) -> Result<String, String> {
    gate.recovery_text()
}
#[tauri::command]
pub async fn lock_setup_finish(gate: G<'_>, password: String, typed: Vec<(usize, String)>) -> Result<(), String> {
    let password = Zeroizing::new(password);
    gate.setup_finish(&password, &typed)
}
#[tauri::command]
pub async fn lock_open(gate: G<'_>, code: String, password: String) -> Result<(), String> {
    let password = Zeroizing::new(password);
    gate.open(&code, &password)
}
#[tauri::command]
pub fn lock_pause(gate: G) {
    gate.pause()
}
#[tauri::command]
pub async fn lock_resume(gate: G<'_>, answer: String) -> Result<(), String> {
    let answer = Zeroizing::new(answer);
    gate.resume(&answer)
}
#[tauri::command]
pub fn lock_set_pause(gate: G, after_minutes: u32, unlock_with: String) -> Result<(), String> {
    gate.set_pause(after_minutes, &unlock_with)
}
#[tauri::command]
pub async fn lock_change_password(gate: G<'_>, current: String, new: String) -> Result<(), String> {
    let current = Zeroizing::new(current);
    let new = Zeroizing::new(new);
    gate.change_password(&current, &new)
}
#[tauri::command]
pub async fn lock_new_phone_begin(gate: G<'_>, current: String) -> Result<Enrol, String> {
    let current = Zeroizing::new(current);
    gate.new_phone_begin(&current)
}
#[tauri::command]
pub fn lock_new_phone_finish(gate: G, code: String) -> Result<(), String> {
    gate.new_phone_finish(&code)
}
#[tauri::command]
pub async fn lock_recover_begin(gate: G<'_>, seed: String, recovery_file: Option<String>) -> Result<Enrol, String> {
    let seed = Zeroizing::new(seed);
    gate.recover_begin(&seed, recovery_file.as_deref())
}
#[tauri::command]
pub async fn lock_tie(gate: G<'_>, password: String, on: bool) -> Result<(), String> {
    let password = Zeroizing::new(password);
    gate.tie(&password, on)
}

#[tauri::command]
pub fn lock_now(gate: G) {
    gate.lock_now()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    const FAST: lock::Kdf = lock::Kdf { log_n: 10, r: 8, p: 1 };

    fn setup_dir(name: &str) -> (PathBuf, Db) {
        let d = std::env::temp_dir().join(format!("am-gate-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        {
            let plain = db::open(&d.join("tuxcopilot.db")).unwrap();
            db::setting_set(&plain, "mine", "my private data").unwrap();
        }
        (d, Arc::new(Mutex::new(db::open_memory_placeholder())))
    }

    fn code_now(secret_b32: &str) -> String {
        // decode what the phone would have scanned
        let alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        let (mut buf, mut bits, mut out) = (0u32, 0, vec![]);
        for c in secret_b32.chars() {
            buf = (buf << 5) | alpha.find(c).unwrap() as u32;
            bits += 5;
            if bits >= 8 {
                out.push((buf >> (bits - 8)) as u8);
                bits -= 8;
            }
        }
        lock::code_at(&out, now() / lock::STEP)
    }

    fn read_mine(db: &Db) -> Option<String> {
        db::setting_get(&db.lock().unwrap(), "mine")
    }

    #[test]
    fn first_start_seals_the_database_and_every_start_needs_the_code_and_the_password() {
        let (d, store) = setup_dir("first");
        let gate = Gate::with_kdf(&d, store.clone(), FAST);
        assert_eq!(gate.status(), Status { set_up: false, open: false, paused: false, needs_recovery: false, pause: PauseSettings::default(), wait_seconds: 0, tied: false });
        assert_eq!(read_mine(&store), None, "nothing to read before it is open");

        let e = gate.setup_begin(12).unwrap();
        assert!(gate.setup_finish("pw-long-1", &[]).unwrap_err().contains("not confirmed"));
        assert!(gate.setup_code("000000").is_err() || code_now(&e.secret) == "000000");
        gate.setup_code(&code_now(&e.secret)).unwrap();
        let typed_wrong = vec![(0, "nope".to_string()), (5, e.seed[5].clone()), (11, e.seed[11].clone())];
        assert!(gate.setup_finish("pw-long-1", &typed_wrong).unwrap_err().contains("do not match"));
        let same_thrice = vec![(0, e.seed[0].clone()), (0, e.seed[0].clone()), (0, e.seed[0].clone())];
        assert!(gate.setup_finish("pw-long-1", &same_thrice).unwrap_err().contains("do not match"), "one word three times is not three words");
        let typed = vec![(0, e.seed[0].to_uppercase()), (5, e.seed[5].clone()), (11, format!(" {} ", e.seed[11]))];
        gate.setup_finish("pw-long-1", &typed).unwrap();
        assert_eq!(read_mine(&store).as_deref(), Some("my private data"), "open: the sealed database is connected");
        assert!(is_sealed(&d.join("tuxcopilot.db")));
        assert!(gate.setup_begin(12).is_err(), "set up once");

        // a new start
        let store2: Db = Arc::new(Mutex::new(db::open_memory_placeholder()));
        let gate2 = Gate::with_kdf(&d, store2.clone(), FAST);
        assert!(gate2.status().set_up && !gate2.status().open);
        assert_eq!(read_mine(&store2), None);
        assert_eq!(gate2.open(&code_now(&e.secret), "wrong").unwrap_err(), WRONG);
        assert_eq!(gate2.open("123456", "pw-long-1").unwrap_err(), WRONG.to_string() + "", "the same words whichever was wrong");
        gate2.open(&code_now(&e.secret), "pw-long-1").unwrap();
        assert_eq!(read_mine(&store2).as_deref(), Some("my private data"));

        // the same code never opens it twice
        let store3: Db = Arc::new(Mutex::new(db::open_memory_placeholder()));
        let gate3 = Gate::with_kdf(&d, store3, FAST);
        assert_eq!(gate3.open(&code_now(&e.secret), "pw-long-1").unwrap_err(), WRONG);
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn a_password_code_has_at_least_8_characters() {
        let (d, store) = setup_dir("min");
        let gate = Gate::with_kdf(&d, store, FAST);
        let e = gate.setup_begin(12).unwrap();
        gate.setup_code(&code_now(&e.secret)).unwrap();
        let typed = vec![(0, e.seed[0].clone()), (1, e.seed[1].clone()), (2, e.seed[2].clone())];
        assert!(gate.setup_finish("1234567", &typed).unwrap_err().contains("at least 8 characters"));
        assert!(gate.setup_finish("ñandú12", &typed).is_err(), "characters, not bytes: 7 is 7");
        gate.setup_finish("12345678", &typed).unwrap();
        assert!(gate.change_password("12345678", "short").unwrap_err().contains("at least 8"));
        gate.change_password("12345678", "a longer one").unwrap();
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn closing_and_reopening_does_not_start_the_count_again() {
        let (d, store) = setup_dir("tries");
        let gate = Gate::with_kdf(&d, store, FAST);
        let e = gate.setup_begin(12).unwrap();
        gate.setup_code(&code_now(&e.secret)).unwrap();
        gate.setup_finish("pw-long-1", &[(0, e.seed[0].clone()), (1, e.seed[1].clone()), (2, e.seed[2].clone())]).unwrap();
        let fresh = || Gate::with_kdf(&d, Arc::new(Mutex::new(db::open_memory_placeholder())), FAST);
        let g = fresh();
        for _ in 0..3 {
            assert_eq!(g.open("000000", "x").unwrap_err(), WRONG);
        }
        // TuxCopilot closed and opened again: still waiting
        let again = fresh();
        assert!(again.status().wait_seconds >= 1, "the wait survives a restart");
        assert!(again.open(&code_now(&e.secret), "pw-long-1").unwrap_err().contains("wait"));
        let saved: LockFile = serde_json::from_str(&std::fs::read_to_string(d.join("lock.json")).unwrap()).unwrap();
        assert_eq!(saved.failures, 3);
        assert!(saved.wait_until.is_some_and(|u| u > now()));
        // the count goes on from 3 after the restart, not from 0
        std::thread::sleep(Duration::from_millis(2100));
        assert_eq!(again.open("000000", "x").unwrap_err(), WRONG);
        let saved: LockFile = serde_json::from_str(&std::fs::read_to_string(d.join("lock.json")).unwrap()).unwrap();
        assert_eq!(saved.failures, 4, "counted on from where it was");
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn tied_to_this_computer_a_copy_opens_nowhere_else_and_the_seed_is_the_way_back() {
        let (d, store) = setup_dir("tied");
        let gate = Gate::with_kdf(&d, store.clone(), FAST);
        let e = gate.setup_begin(12).unwrap();
        gate.setup_code(&code_now(&e.secret)).unwrap();
        gate.setup_finish("pw-long-1", &[(0, e.seed[0].clone()), (1, e.seed[1].clone()), (2, e.seed[2].clone())]).unwrap();
        assert!(gate.tie("not mine at all", true).unwrap_err().contains("not your password code"));
        gate.tie("pw-long-1", true).unwrap();
        assert!(gate.status().tied);
        let saved: LockFile = serde_json::from_str(&std::fs::read_to_string(d.join("lock.json")).unwrap()).unwrap();
        assert!(saved.machine.is_some() && saved.by_password.data.is_empty(), "the password's copy is only in the chip's seal");
        // a new password code stays tied
        gate.change_password("pw-long-1", "pw-long-2").unwrap();
        assert!(gate.status().tied);
        // TuxCopilot opened again on this computer: it opens
        let fresh = || Gate::with_kdf(&d, Arc::new(Mutex::new(db::open_memory_placeholder())), FAST);
        let g2 = fresh();
        assert_eq!(g2.open("000000", "pw-long-2").unwrap_err(), WRONG, "a wrong code is still wrong");
        // the chip cleared: said plainly, and not counted as a wrong try
        let mut f: LockFile = serde_json::from_str(&std::fs::read_to_string(d.join("lock.json")).unwrap()).unwrap();
        f.machine = Some(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, b"NOT:what the chip sealed"));
        std::fs::write(d.join("lock.json"), serde_json::to_string(&f).unwrap()).unwrap();
        let store3: Db = Arc::new(Mutex::new(db::open_memory_placeholder()));
        let g3 = Gate::with_kdf(&d, store3.clone(), FAST);
        let before = g3.status().wait_seconds;
        assert_eq!(g3.open(&code_now(&e.secret), "pw-long-2").unwrap_err(), lock::MACHINE_GONE);
        assert_eq!(g3.status().wait_seconds, before);
        // the seed brings it back, and it can be tied again
        let n = g3.recover_begin(&e.seed.join(" "), None).unwrap();
        g3.setup_code(&code_now(&n.secret)).unwrap();
        g3.setup_finish("pw-long-3", &[]).unwrap();
        assert_eq!(read_mine(&store3).as_deref(), Some("my private data"), "your data, back through the seed");
        assert!(!g3.status().tied, "a new lock from the seed starts untied");
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn wrong_answers_slow_down() {
        let (d, store) = setup_dir("slow");
        let gate = Gate::with_kdf(&d, store, FAST);
        let e = gate.setup_begin(12).unwrap();
        gate.setup_code(&code_now(&e.secret)).unwrap();
        gate.setup_finish("pw-long-1", &[(0, e.seed[0].clone()), (1, e.seed[1].clone()), (2, e.seed[2].clone())]).unwrap();
        let g2 = Gate::with_kdf(&d, Arc::new(Mutex::new(db::open_memory_placeholder())), FAST);
        for _ in 0..3 {
            assert_eq!(g2.open("000000", "x").unwrap_err(), WRONG);
        }
        assert!(g2.open(&code_now(&e.secret), "pw-long-1").unwrap_err().contains("wait"), "even the right answer waits");
        assert!(g2.status().wait_seconds >= 1);
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn a_pause_opens_with_your_choice_and_the_seed_brings_everything_back() {
        let (d, store) = setup_dir("pause");
        let gate = Gate::with_kdf(&d, store.clone(), FAST);
        let e = gate.setup_begin(12).unwrap();
        gate.setup_code(&code_now(&e.secret)).unwrap();
        let recovery = gate.recovery_text().unwrap();
        gate.setup_finish("pw-long-1", &[(3, e.seed[3].clone()), (4, e.seed[4].clone()), (7, e.seed[7].clone())]).unwrap();
        assert!(gate.recovery_text().is_err(), "the seed is gone once set up");

        gate.pause();
        assert!(gate.change_password("pw-long-1", "x").is_err(), "nothing changes while paused");
        assert!(gate.resume("wrong").is_err());
        gate.resume("pw-long-1").unwrap(); // the password code, by default
        gate.set_pause(5, "code").unwrap();
        gate.pause();
        assert!(gate.resume("pw-long-1").is_err(), "now only the code");
        gate.resume(&code_now(&e.secret)).unwrap();

        // changing the lock asks for the password code, even while open
        assert_eq!(gate.change_password("not mine", "a new long one").unwrap_err(), "That is not your password code.");
        assert!(gate.new_phone_begin("not mine").is_err());
        assert!(gate.change_password("pw-long-1", "").is_err());
        gate.change_password("pw-long-1", "pw-long-2").unwrap();
        assert!(gate.change_password("pw-long-1", "pw-long-3").is_err(), "the old one no longer works");
        gate.change_password("pw-long-2", "pw-long-1").unwrap();

        // the password is forgotten: the seed, a new phone, a new password code
        let fresh = Arc::new(Mutex::new(db::open_memory_placeholder()));
        let g2 = Gate::with_kdf(&d, fresh.clone(), FAST);
        assert!(g2.recover_begin("not the seed at all", None).is_err());
        let n = g2.recover_begin(&e.seed.join(" ").to_uppercase(), None).unwrap();
        g2.setup_code(&code_now(&n.secret)).unwrap();
        g2.setup_finish("new pw long", &[]).unwrap();
        assert_eq!(read_mine(&fresh).as_deref(), Some("my private data"));

        // lock.json is gone too: the recovery file and the seed
        std::fs::remove_file(d.join("lock.json")).unwrap();
        let g3 = Gate::with_kdf(&d, Arc::new(Mutex::new(db::open_memory_placeholder())), FAST);
        assert!(g3.status().needs_recovery);
        assert!(g3.recover_begin(&e.seed.join(" "), None).unwrap_err().contains("recovery file"));
        let n3 = g3.recover_begin(&e.seed.join(" "), Some(&recovery)).unwrap();
        g3.setup_code(&code_now(&n3.secret)).unwrap();
        g3.setup_finish("third pw long", &[]).unwrap();
        assert!(g3.status().open && !g3.status().needs_recovery);
        let mode = std::os::unix::fs::PermissionsExt::mode(&std::fs::metadata(d.join("lock.json")).unwrap().permissions()) & 0o777;
        assert_eq!(mode, 0o600, "lock.json is yours alone");
        std::fs::remove_dir_all(&d).unwrap();
    }
}
