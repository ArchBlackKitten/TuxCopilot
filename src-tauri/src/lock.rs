// The lock: what keeps your data yours. Built from known parts only — OpenSSL's scrypt
// (stretching a password into a key), AES-256-GCM (sealing), HMAC-SHA1 (the 30-second codes,
// RFC 6238, what every authenticator app speaks), `age` for the optional recovery file, and
// the 2048-word BIP-39 list for the seed. No cipher of our own.
//
// How it fits together:
//   a random DATA KEY encrypts the database (SQLCipher).
//   It is sealed twice in lock.json: by your PASSWORD CODE, and by your SEED (the words on
//   paper, never stored). Either one opens it; nothing else on this computer can.
//   The 30-SECOND CODE's secret is sealed by the data key: opening asks for the code and the
//   password code together; after a pause, either one (your choice) unlocks again.
//   The optional RECOVERY FILE is the data key sealed by the seed, as an `age` file — it
//   opens with the plain `age` tool too, on the day TuxCopilot can't.

use base64::Engine;
use openssl::symm::{decrypt_aead, encrypt_aead, Cipher};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use zeroize::Zeroizing;

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;
pub const WORDS: &str = include_str!("seed-words.txt");
/// The standard seed: 9 words of 2048, 99 bits. You may choose more or fewer: it is yours.
pub const SEED_WORDS: usize = 9;
pub const MAX_SEED_WORDS: usize = 5000;

pub type Key = Zeroizing<[u8; 32]>;

pub fn random<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    openssl::rand::rand_bytes(&mut b).expect("the system's random source");
    b
}

pub fn new_key() -> Key {
    Zeroizing::new(random::<32>())
}

// ── the seed ─────────────────────────────────────────────────────────────

fn word_list() -> Vec<&'static str> {
    WORDS.lines().map(str::trim).filter(|w| !w.is_empty()).collect()
}

/// `count` words (SEED_WORDS unless you chose otherwise), each chosen evenly from 2048 (11
/// random bits each). How many is never written down anywhere but on your paper.
pub fn new_seed(count: usize) -> Vec<String> {
    words(count.clamp(1, MAX_SEED_WORDS))
}

/// `n` words from the same list, each chosen evenly (a penguin's passphrase uses six).
pub fn words(n: usize) -> Vec<String> {
    let list = word_list();
    (0..n)
        .map(|_| {
            let r = u16::from_le_bytes(random::<2>()) as usize % 2048; // 2048 divides 65536: even
            list[r].to_string()
        })
        .collect()
}

/// The seed as typed back: any case, any spacing; every word must be on the list. Any number
/// of words: the seed is as long as you chose.
pub fn normalize_seed(typed: &str) -> Result<String, String> {
    let list = word_list();
    let words: Vec<String> = typed.split_whitespace().map(|w| w.to_lowercase()).collect();
    if words.is_empty() {
        return Err("type your seed words".into());
    }
    if let Some((i, w)) = words.iter().enumerate().find(|(_, w)| !list.contains(&w.as_str())) {
        return Err(format!("word {} (“{w}”) is not a seed word — check its spelling", i + 1));
    }
    Ok(words.join(" "))
}

// ── stretching and sealing ───────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Kdf {
    pub log_n: u8, // scrypt N = 2^log_n
    pub r: u32,
    pub p: u32,
}

/// About half a second and 128 MB: slow for anyone trying millions of guesses.
pub const KDF: Kdf = Kdf { log_n: 17, r: 8, p: 1 };

pub fn stretch(secret: &str, salt: &[u8], kdf: Kdf) -> Result<Key, String> {
    let mut out = Zeroizing::new([0u8; 32]);
    let n = 1u64 << kdf.log_n;
    let maxmem = 128 * (kdf.r as u64) * n * 2 + (1 << 20);
    openssl::pkcs5::scrypt(secret.as_bytes(), salt, n, kdf.r as u64, kdf.p as u64, maxmem, &mut out[..]).map_err(|e| e.to_string())?;
    Ok(out)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Sealed {
    pub iv: String,
    pub data: String,
    pub tag: String,
}

pub fn seal(key: &[u8; 32], plain: &[u8], label: &str) -> Sealed {
    let iv = random::<12>();
    let mut tag = [0u8; 16];
    let data = encrypt_aead(Cipher::aes_256_gcm(), key, Some(&iv), label.as_bytes(), plain, &mut tag).expect("AES-256-GCM");
    Sealed { iv: B64.encode(iv), data: B64.encode(data), tag: B64.encode(tag) }
}

/// None when the key is wrong or anything was changed (GCM checks both).
pub fn open(key: &[u8; 32], s: &Sealed, label: &str) -> Option<Zeroizing<Vec<u8>>> {
    let iv = B64.decode(&s.iv).ok()?;
    let data = B64.decode(&s.data).ok()?;
    let tag = B64.decode(&s.tag).ok()?;
    decrypt_aead(Cipher::aes_256_gcm(), key, Some(&iv), label.as_bytes(), &data, &tag).ok().map(Zeroizing::new)
}

// ── the 30-second code (RFC 6238: TOTP, HMAC-SHA1, 6 digits) ─────────────

pub const STEP: u64 = 30;

pub fn code_at(secret: &[u8], step: u64) -> String {
    use openssl::{hash::MessageDigest, pkey::PKey, sign::Signer};
    let key = PKey::hmac(secret).expect("HMAC key");
    let mut s = Signer::new(MessageDigest::sha1(), &key).expect("HMAC-SHA1");
    s.update(&step.to_be_bytes()).expect("HMAC");
    let mac = s.sign_to_vec().expect("HMAC");
    let at = (mac[19] & 0x0f) as usize;
    let n = u32::from_be_bytes([mac[at] & 0x7f, mac[at + 1], mac[at + 2], mac[at + 3]]) % 1_000_000;
    format!("{n:06}")
}

/// The step a typed code belongs to: now, or one step either side (clocks drift). Never a step
/// already used — a code seen over your shoulder does not open it again.
pub fn check_code(secret: &[u8], typed: &str, now: u64, last_used: Option<u64>) -> Option<u64> {
    let typed: String = typed.chars().filter(|c| !c.is_whitespace()).collect();
    if typed.len() != 6 || !typed.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let step = now / STEP;
    let mut found = None;
    for s in [step.saturating_sub(1), step, step + 1] {
        // compare every candidate fully, so the time taken says nothing about which matched
        if openssl::memcmp::eq(code_at(secret, s).as_bytes(), typed.as_bytes()) && last_used.is_none_or(|u| s > u) {
            found = Some(s);
        }
    }
    found
}

pub fn base32(bytes: &[u8]) -> String {
    const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut out = String::new();
    let (mut buf, mut bits) = (0u32, 0);
    for &b in bytes {
        buf = (buf << 8) | b as u32;
        bits += 8;
        while bits >= 5 {
            out.push(A[((buf >> (bits - 5)) & 31) as usize] as char);
            bits -= 5;
        }
    }
    if bits > 0 {
        out.push(A[((buf << (5 - bits)) & 31) as usize] as char);
    }
    out
}

/// What an authenticator app scans.
pub fn otpauth(secret: &[u8], account: &str) -> String {
    let acc: String = account.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
    format!("otpauth://totp/TuxCopilot:{acc}?secret={}&issuer=TuxCopilot&algorithm=SHA1&digits=6&period=30", base32(secret))
}

/// The same as a QR code, drawn as SVG.
pub fn qr_svg(text: &str) -> String {
    use qrcodegen::{QrCode, QrCodeEcc};
    let qr = QrCode::encode_text(text, QrCodeEcc::Medium).expect("fits a QR code");
    let (size, border) = (qr.size(), 4);
    let dim = size + border * 2;
    let mut path = String::new();
    for y in 0..size {
        for x in 0..size {
            if qr.get_module(x, y) {
                path.push_str(&format!("M{},{}h1v1h-1z", x + border, y + border));
            }
        }
    }
    format!(r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {dim} {dim}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="{path}" fill="#000"/></svg>"##)
}

// ── lock.json ────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PauseSettings {
    pub after_minutes: u32, // 0: never locks while open
    pub unlock_with: String, // "password" | "code"
}

impl Default for PauseSettings {
    fn default() -> Self {
        PauseSettings { after_minutes: 10, unlock_with: "password".into() }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LockFile {
    pub version: u32,
    pub kdf: Kdf,
    pub password_salt: String,
    pub by_password: Sealed, // the data key, sealed by the password code
    pub seed_salt: String,
    pub by_seed: Sealed, // the data key, sealed by the seed
    pub code_secret: Sealed, // the 30-second code's secret, sealed by the data key
    pub last_code_step: Option<u64>,
    pub pause: PauseSettings,
    /// Wrong answers in a row, and until when to wait (unix seconds): kept here, so closing and
    /// reopening TuxCopilot doesn't start the count again.
    #[serde(default)]
    pub failures: u32,
    #[serde(default)]
    pub wait_until: Option<u64>,
    /// Tied to this computer (your choice): `by_password` sealed again with
    /// this computer's TPM and its systemd host secret (systemd-creds --user, host+tpm2). While
    /// set, `by_password` here is empty — a copy of lock.json opens on no other computer with the
    /// password code. The seed's copy is never tied: it is the way back (moving house, a wiped chip).
    #[serde(default)]
    pub machine: Option<String>,
}

/// What `machine` holds can't be opened here any more (the chip was cleared, Arch reinstalled…).
pub const MACHINE_GONE: &str = "This computer's security chip can't open the lock any more (a BIOS reset, some firmware updates or reinstalling Arch clear it). Your password code is fine — open it with your seed words (\"Lost your device, or forgot your password code?\"), then tie it to this computer again.";

/// The name sealed into the credential: a seal made for something else doesn't open here.
const CREDS_NAME: &str = "tuxcopilot-lock";

/// systemd-creds for your user (the TPM and this computer's host secret), the data in and out
/// through pipes; it may wait at most 60 s.
#[cfg(not(test))]
fn creds(verb: &str, input: &[u8]) -> Result<Vec<u8>, String> {
    systemd_creds(verb, input)
}

pub fn systemd_creds(verb: &str, input: &[u8]) -> Result<Vec<u8>, String> {
    use std::process::{Command, Stdio};
    let mut args = vec!["--user".to_string(), verb.to_string(), format!("--name={CREDS_NAME}")];
    if verb == "encrypt" {
        args.push("--with-key=host+tpm2".into()); // tpm2 alone is refused for a user
    }
    args.extend(["-".into(), "-".into()]);
    let mut child = Command::new("systemd-creds").args(&args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("systemd-creds: {e}"))?;
    child.stdin.take().ok_or("systemd-creds: no input")?.write_all(input).map_err(|e| e.to_string())?;
    let started = std::time::Instant::now();
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            break;
        }
        if started.elapsed() > std::time::Duration::from_secs(60) {
            let _ = child.kill();
            return Err("systemd-creds did not answer".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(out.stdout)
}

/// Tests: a stand-in for the chip (reversed bytes behind a marker; "gone" when the marker is
/// changed, as a cleared chip would refuse).
#[cfg(test)]
fn creds(verb: &str, input: &[u8]) -> Result<Vec<u8>, String> {
    const MARK: &[u8] = b"TPM:";
    match verb {
        "encrypt" => Ok([MARK, &input.iter().rev().copied().collect::<Vec<u8>>()[..]].concat()),
        _ => input.strip_prefix(MARK).map(|b| b.iter().rev().copied().collect()).ok_or_else(|| "the chip refuses".to_string()),
    }
}

/// The password's copy of the data key, wherever it is kept: here, or sealed with this computer.
pub fn password_sealed(f: &LockFile) -> Result<Sealed, String> {
    let Some(m) = &f.machine else { return Ok(f.by_password.clone()) };
    let blob = B64.decode(m).map_err(|_| MACHINE_GONE.to_string())?;
    let plain = Zeroizing::new(creds("decrypt", &blob).map_err(|_| MACHINE_GONE.to_string())?);
    serde_json::from_slice(&plain).map_err(|_| MACHINE_GONE.to_string())
}

/// Tie the lock to this computer: the password's copy goes into the chip's seal.
pub fn tie_to_machine(f: &LockFile) -> Result<LockFile, String> {
    if f.machine.is_some() {
        return Ok(f.clone());
    }
    let plain = Zeroizing::new(serde_json::to_vec(&f.by_password).map_err(|e| e.to_string())?);
    let blob = creds("encrypt", &plain)?;
    Ok(LockFile { machine: Some(B64.encode(blob)), by_password: Sealed { iv: String::new(), data: String::new(), tag: String::new() }, ..f.clone() })
}

/// Untie it: the password's copy is kept in lock.json again.
pub fn untie_from_machine(f: &LockFile) -> Result<LockFile, String> {
    if f.machine.is_none() {
        return Ok(f.clone());
    }
    Ok(LockFile { by_password: password_sealed(f)?, machine: None, ..f.clone() })
}

/// A password code opens the files on its own (and a copy of them, anywhere): at least this long.
pub const MIN_PASSWORD: usize = 8;

pub fn password_ok(password: &str) -> Result<(), String> {
    if password.chars().count() < MIN_PASSWORD {
        return Err(format!(
            "A password code needs at least {MIN_PASSWORD} characters. It opens TuxCopilot's files on its own — a copy of them too, on any computer — so a short one could be guessed."
        ));
    }
    Ok(())
}

const L_PASSWORD: &str = "tuxcopilot data key, by password code";
const L_SEED: &str = "tuxcopilot data key, by seed";
const L_CODE: &str = "tuxcopilot code secret";

/// Everything a new lock needs, made at once: shown to you once, then only lock.json remains.
pub struct NewLock {
    pub file: LockFile,
    pub key: Key,
    pub code_secret: Zeroizing<Vec<u8>>,
    pub seed: Vec<String>,
}

pub fn create(password: &str, kdf: Kdf) -> Result<NewLock, String> {
    if password.is_empty() {
        return Err("a password code is needed".into());
    }
    let key = new_key();
    let seed = new_seed(SEED_WORDS);
    let code_secret = Zeroizing::new(random::<20>().to_vec());
    let file = seal_all(&key, &code_secret, password, &seed.join(" "), kdf, PauseSettings::default())?;
    Ok(NewLock { file, key, code_secret, seed })
}

pub fn seal_all(key: &Key, code_secret: &[u8], password: &str, seed: &str, kdf: Kdf, pause: PauseSettings) -> Result<LockFile, String> {
    let ps = random::<16>();
    let ss = random::<16>();
    Ok(LockFile {
        version: 1,
        kdf,
        password_salt: B64.encode(ps),
        by_password: seal(&*stretch(password, &ps, kdf)?, &key[..], L_PASSWORD),
        seed_salt: B64.encode(ss),
        by_seed: seal(&*stretch(seed, &ss, kdf)?, &key[..], L_SEED),
        code_secret: seal(key, code_secret, L_CODE),
        last_code_step: None,
        pause,
        failures: 0,
        wait_until: None,
        machine: None,
    })
}

fn as_key(v: &[u8]) -> Option<Key> {
    (v.len() == 32).then(|| {
        let mut k = Zeroizing::new([0u8; 32]);
        k.copy_from_slice(v);
        k
    })
}

pub fn key_by_password(f: &LockFile, password: &str) -> Option<Key> {
    key_by_password_here(f, password).ok().flatten()
}

/// Err: the chip can't open its seal (not a wrong password code — don't count it as one).
pub fn key_by_password_here(f: &LockFile, password: &str) -> Result<Option<Key>, String> {
    let sealed = password_sealed(f)?;
    let Ok(salt) = B64.decode(&f.password_salt) else { return Ok(None) };
    let Ok(k) = stretch(password, &salt, f.kdf) else { return Ok(None) };
    Ok(open(&*k, &sealed, L_PASSWORD).and_then(|p| as_key(&p)))
}

pub fn key_by_seed(f: &LockFile, seed: &str) -> Option<Key> {
    let salt = B64.decode(&f.seed_salt).ok()?;
    as_key(&open(&*stretch(seed, &salt, f.kdf).ok()?, &f.by_seed, L_SEED)?)
}

pub fn code_secret(f: &LockFile, key: &Key) -> Option<Zeroizing<Vec<u8>>> {
    open(key, &f.code_secret, L_CODE)
}

/// A new password code (the seed and the code stay): needs the data key, so only while open.
pub fn with_password(f: &LockFile, key: &Key, password: &str) -> Result<LockFile, String> {
    if password.is_empty() {
        return Err("a password code is needed".into());
    }
    let ps = random::<16>();
    let new = LockFile { password_salt: B64.encode(ps), by_password: seal(&*stretch(password, &ps, f.kdf)?, &key[..], L_PASSWORD), machine: None, ..f.clone() };
    // tied before: tied again, with the new password's copy
    if f.machine.is_some() {
        tie_to_machine(&new)
    } else {
        Ok(new)
    }
}

/// A new 30-second code secret (a new phone): needs the data key.
pub fn with_code_secret(f: &LockFile, key: &Key, secret: &[u8]) -> LockFile {
    LockFile { code_secret: seal(key, secret, L_CODE), last_code_step: None, ..f.clone() }
}

// ── the recovery file (age, sealed by the seed) ──────────────────────────

pub fn recovery_file(key: &Key, seed: &str) -> Result<Vec<u8>, String> {
    let body = Zeroizing::new(format!(
        "TuxCopilot recovery file\nThis is the key to TuxCopilot's database (SQLCipher), in hex.\nkey: {}\n",
        key.iter().map(|b| format!("{b:02x}")).collect::<String>()
    ));
    let enc = age::Encryptor::with_user_passphrase(age::secrecy::SecretString::from(seed.to_string()));
    let mut out = vec![];
    let mut w = enc.wrap_output(age::armor::ArmoredWriter::wrap_output(&mut out, age::armor::Format::AsciiArmor).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    w.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    w.finish().and_then(|a| a.finish()).map_err(|e| e.to_string())?;
    Ok(out)
}

pub fn key_from_recovery(file: &[u8], seed: &str) -> Result<Key, String> {
    let d = age::Decryptor::new_buffered(age::armor::ArmoredReader::new(file)).map_err(|_| "this is not a TuxCopilot recovery file".to_string())?;
    let id = age::scrypt::Identity::new(age::secrecy::SecretString::from(seed.to_string()));
    let mut r = d.decrypt(std::iter::once(&id as &dyn age::Identity)).map_err(|_| "the seed does not open this recovery file".to_string())?;
    let mut text = Zeroizing::new(String::new());
    r.read_to_string(&mut text).map_err(|e| e.to_string())?;
    let hex = text.lines().find_map(|l| l.strip_prefix("key: ")).ok_or("this recovery file holds no key")?;
    let bytes: Vec<u8> = (0..hex.len()).step_by(2).filter_map(|i| u8::from_str_radix(hex.get(i..i + 2)?, 16).ok()).collect();
    as_key(&bytes).ok_or_else(|| "this recovery file's key is damaged".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    const FAST: Kdf = Kdf { log_n: 10, r: 8, p: 1 }; // tests only: the real one takes half a second

    #[test]
    fn the_30_second_code_is_rfc_6238() {
        // RFC 6238, appendix B (SHA1), last six digits
        let secret = b"12345678901234567890";
        assert_eq!(code_at(secret, 59 / STEP), "287082");
        assert_eq!(code_at(secret, 1111111109 / STEP), "081804");
        assert_eq!(code_at(secret, 1234567890 / STEP), "005924");
        assert_eq!(code_at(secret, 20000000000 / STEP), "353130");
        // RFC 4648's own example
        assert_eq!(base32(b"foobar"), "MZXW6YTBOI");
        assert!(otpauth(b"12345678901234567890", "me").starts_with("otpauth://totp/TuxCopilot:me?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&"));
    }

    #[test]
    fn a_code_works_once_now_or_a_step_either_side_never_older() {
        let s = b"12345678901234567890";
        let now = 1_700_000_000;
        let step = now / STEP;
        assert_eq!(check_code(s, &code_at(s, step), now, None), Some(step));
        assert_eq!(check_code(s, &code_at(s, step - 1), now, None), Some(step - 1));
        assert_eq!(check_code(s, &code_at(s, step - 2), now, None), None, "a minute old");
        assert_eq!(check_code(s, &code_at(s, step), now, Some(step)), None, "used already");
        assert_eq!(check_code(s, " 123 456 ", now, None).is_some(), code_at(s, step) == "123456");
        assert_eq!(check_code(s, "12345a", now, None), None);
    }

    #[test]
    fn the_password_code_or_the_seed_opens_the_data_key_nothing_else_does() {
        let n = create("correct horse", FAST).unwrap();
        let seed = n.seed.join(" ");
        assert_eq!(n.seed.len(), SEED_WORDS, "the standard: 9 words");
        assert_eq!(key_by_password(&n.file, "correct horse").as_deref(), Some(&*n.key));
        assert_eq!(key_by_seed(&n.file, &seed).as_deref(), Some(&*n.key));
        assert!(key_by_password(&n.file, "correct hors").is_none());
        assert!(key_by_seed(&n.file, "correct horse").is_none());
        assert_eq!(code_secret(&n.file, &n.key).unwrap()[..], n.code_secret[..]);
        // lock.json alone gives nothing away: no key, no code secret, no seed, no password
        let json = serde_json::to_string(&n.file).unwrap();
        for secret in [hex(&n.key[..]), base32(&n.code_secret), seed.clone(), "correct horse".into(), B64.encode(&n.key[..])] {
            assert!(!json.contains(&secret));
        }
        // a changed byte is noticed, not decrypted into nonsense
        let mut f = n.file.clone();
        let mut d = B64.decode(&f.by_password.data).unwrap();
        d[0] ^= 1;
        f.by_password.data = B64.encode(d);
        assert!(key_by_password(&f, "correct horse").is_none());
        assert!(create("", FAST).is_err());
    }

    /// This computer's real chip (systemd-creds --user, host+tpm2): run by hand —
    /// cargo test real_chip -- --ignored
    #[test]
    #[ignore]
    fn real_chip_seals_and_opens_and_refuses_what_it_did_not_seal() {
        let sealed = systemd_creds("encrypt", b"{\"iv\":\"x\",\"data\":\"y\",\"tag\":\"z\"}").unwrap();
        assert!(!sealed.windows(4).any(|w| w == b"data"), "sealed, not readable");
        assert_eq!(systemd_creds("decrypt", &sealed).unwrap(), b"{\"iv\":\"x\",\"data\":\"y\",\"tag\":\"z\"}");
        let mut broken = sealed.clone();
        let mid = broken.len() / 2;
        broken[mid] = if broken[mid] == b'A' { b'B' } else { b'A' };
        assert!(systemd_creds("decrypt", &broken).is_err(), "a changed seal is refused");
    }

    #[test]
    fn tying_moves_the_password_copy_into_the_chip_and_untying_brings_it_back() {
        let n = create("correct horse", FAST).unwrap();
        let tied = tie_to_machine(&n.file).unwrap();
        assert!(tied.by_password.data.is_empty() && tied.machine.is_some());
        assert_eq!(key_by_password(&tied, "correct horse").as_deref(), Some(&*n.key));
        assert!(key_by_password(&tied, "wrong one").is_none());
        assert_eq!(key_by_seed(&tied, &n.seed.join(" ")).as_deref(), Some(&*n.key), "the seed's copy is never tied");
        let back = untie_from_machine(&tied).unwrap();
        assert!(back.machine.is_none());
        assert_eq!(key_by_password(&back, "correct horse").as_deref(), Some(&*n.key));
        // the chip refuses: an error of its own, not a wrong password
        let gone = LockFile { machine: Some(B64.encode(b"cleared")), ..tied.clone() };
        assert_eq!(key_by_password_here(&gone, "correct horse").unwrap_err(), MACHINE_GONE);
        assert!(untie_from_machine(&gone).is_err());
        // tying twice is tying once
        assert_eq!(tie_to_machine(&tied).unwrap().machine, tied.machine);
    }

    #[test]
    fn a_new_password_code_keeps_the_seed_working() {
        let n = create("first", FAST).unwrap();
        let f = with_password(&n.file, &n.key, "second").unwrap();
        assert!(key_by_password(&f, "first").is_none());
        assert_eq!(key_by_password(&f, "second").as_deref(), Some(&*n.key));
        assert_eq!(key_by_seed(&f, &n.seed.join(" ")).as_deref(), Some(&*n.key));
    }

    #[test]
    fn the_seed_is_typed_back_forgivingly_but_only_with_real_words() {
        let seed = new_seed(SEED_WORDS);
        assert_eq!(seed.len(), 9, "nine words, the standard");
        assert_eq!(new_seed(2000).len(), 2000, "as many as you want");
        assert_eq!(new_seed(0).len(), 1);
        let messy = format!("  {}  ", seed.iter().map(|w| w.to_uppercase()).collect::<Vec<_>>().join("   "));
        assert_eq!(normalize_seed(&messy).unwrap(), seed.join(" "));
        assert_eq!(normalize_seed("Abandon  ability").unwrap(), "abandon ability", "any length: the seed is as long as you chose");
        assert!(normalize_seed("  ").is_err());
        let mut wrong = seed.clone();
        wrong[3] = "notaword".into();
        assert!(normalize_seed(&wrong.join(" ")).unwrap_err().contains("word 4"));
        assert_ne!(new_seed(SEED_WORDS), new_seed(SEED_WORDS));
    }

    #[test]
    fn the_recovery_file_is_age_and_opens_with_the_seed_only() {
        let n = create("pw", FAST).unwrap();
        let seed = n.seed.join(" ");
        let file = recovery_file(&n.key, &seed).unwrap();
        assert!(String::from_utf8_lossy(&file).starts_with("-----BEGIN AGE ENCRYPTED FILE-----"));
        assert_eq!(*key_from_recovery(&file, &seed).unwrap(), *n.key);
        assert!(key_from_recovery(&file, "pw").unwrap_err().contains("does not open"));
        assert!(key_from_recovery(b"hello", &seed).unwrap_err().contains("not a TuxCopilot recovery file"));
    }

    /// Writes a recovery file made with throwaway words, for checking it with the plain `age` tool.
    #[test]
    #[ignore]
    fn a_recovery_file_for_the_age_tool() {
        let out = std::env::var("AGE_CHECK_FILE").unwrap();
        std::fs::write(out, recovery_file(&new_key(), "orbit maple violin").unwrap()).unwrap();
    }

    #[test]
    fn the_qr_code_is_an_svg_of_the_setup_link() {
        let svg = qr_svg(&otpauth(b"12345678901234567890", "me"));
        assert!(svg.starts_with("<svg") && svg.contains("<path d=\"M") && !svg.contains("script"));
    }

    fn hex(b: &[u8]) -> String {
        b.iter().map(|x| format!("{x:02x}")).collect()
    }
}
