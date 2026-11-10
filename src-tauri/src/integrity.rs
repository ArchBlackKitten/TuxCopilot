// Every file TuxCopilot exports travels with its SHA-256 checksum (<file>.sha256, the format
// `sha256sum -c` reads), and — when you choose your GPG key — a signature (<file>.asc).
// Every file it imports is checked against both when they are beside it.
//
// The checksum shows the file arrived exactly as it was made: any damage or change shows.
// It cannot show WHO made it — whoever changes a file can change its checksum too. The GPG
// signature can: only the holder of the key can make one. Hence the recommendation to sign.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub fn sha256_hex(bytes: &[u8]) -> String {
    openssl::sha::sha256(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

fn beside(path: &Path, ext: &str) -> PathBuf {
    let mut p = path.as_os_str().to_owned();
    p.push(ext);
    PathBuf::from(p)
}

/// `<hex>  <file name>` — what sha256sum writes and checks.
pub fn write_checksum(path: &Path, bytes: &[u8]) -> Result<String, String> {
    let hex = sha256_hex(bytes);
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    std::fs::write(beside(path, ".sha256"), format!("{hex}  {name}\n")).map_err(|e| e.to_string())?;
    Ok(hex)
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum Signature {
    None,
    Good { signer: String, fingerprint: String },
    Bad,
    UnknownKey { key: String }, // signed, but by a key you have not imported
    Unchecked { why: String },  // no gpg, or gpg failed
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Integrity {
    pub sha256: String,
    pub checksum: String, // "match" | "mismatch" | "missing"
    pub signature: Signature,
}

pub fn check_checksum(path: &Path, bytes: &[u8]) -> (String, String) {
    let hex = sha256_hex(bytes);
    let verdict = match std::fs::read_to_string(beside(path, ".sha256")) {
        Err(_) => "missing",
        Ok(t) => match t.split_whitespace().next() {
            Some(h) if h.eq_ignore_ascii_case(&hex) => "match",
            _ => "mismatch",
        },
    };
    (hex, verdict.to_string())
}

/// gpg's machine-readable status lines (--status-fd), read for the verdict.
pub fn parse_verify(status: &str) -> Signature {
    let line = |tag: &str| status.lines().find_map(|l| l.strip_prefix(&format!("[GNUPG:] {tag} ")).map(str::to_string));
    if line("BADSIG").is_some() {
        return Signature::Bad;
    }
    if let Some(rest) = line("NO_PUBKEY") {
        return Signature::UnknownKey { key: rest.split_whitespace().next().unwrap_or_default().to_string() };
    }
    match (line("GOODSIG"), line("VALIDSIG")) {
        (Some(good), Some(valid)) => Signature::Good {
            signer: good.split_once(' ').map(|(_, uid)| uid.to_string()).unwrap_or_default(),
            fingerprint: valid.split_whitespace().next().unwrap_or_default().to_string(),
        },
        _ => Signature::Unchecked { why: "gpg did not say the signature is good".into() },
    }
}

fn gpg(args: &[&str], timeout: Duration) -> Option<crate::probe::ExecResult> {
    let mut argv = vec!["gpg".to_string()];
    argv.extend(args.iter().map(|s| s.to_string()));
    crate::probe::exec(&argv, timeout)
}

pub fn check_signature(path: &Path) -> Signature {
    let asc = [".asc", ".sig"].iter().map(|e| beside(path, e)).find(|p| p.is_file());
    let Some(asc) = asc else { return Signature::None };
    match gpg(&["--status-fd", "1", "--verify", &asc.to_string_lossy(), &path.to_string_lossy()], Duration::from_secs(20)) {
        None => Signature::Unchecked { why: "gpg is not installed, or did not answer".into() },
        Some(r) => parse_verify(&r.stdout_text()),
    }
}

pub fn integrity(path: &Path, bytes: &[u8]) -> Integrity {
    let (sha256, checksum) = check_checksum(path, bytes);
    Integrity { sha256, checksum, signature: check_signature(path) }
}

/// A 40-hex-digit fingerprint, and nothing that could be read as an option.
pub fn valid_fingerprint(f: &str) -> bool {
    f.len() == 40 && f.bytes().all(|b| b.is_ascii_hexdigit())
}

/// A detached, armored signature beside the file. gpg asks for your key's passphrase itself.
pub fn sign(path: &Path, fingerprint: &str) -> Result<(), String> {
    if !valid_fingerprint(fingerprint) {
        return Err("not a key fingerprint".into());
    }
    let asc = beside(path, ".asc");
    let r = gpg(
        &["--yes", "--armor", "--local-user", fingerprint, "--detach-sign", "--output", &asc.to_string_lossy(), &path.to_string_lossy()],
        Duration::from_secs(120), // time to type the key's passphrase
    )
    .ok_or("gpg is not installed, or did not finish")?;
    if r.ok() {
        Ok(())
    } else {
        let _ = std::fs::remove_file(&asc);
        Err(r.joined().lines().last().unwrap_or("gpg refused to sign").to_string())
    }
}

#[derive(Serialize)]
pub struct GpgKey {
    fingerprint: String,
    user: String,
}

/// Your secret keys (the ones you can sign with), from gpg's colon listing.
pub fn parse_secret_keys(colons: &str) -> Vec<GpgKey> {
    let mut out: Vec<GpgKey> = vec![];
    let mut in_sec = false;
    for l in colons.lines() {
        let f: Vec<&str> = l.split(':').collect();
        match f.first().copied() {
            Some("sec") => in_sec = !matches!(f.get(1), Some(&"r") | Some(&"e") | Some(&"d")), // not revoked, expired, disabled
            Some("ssb") => in_sec = false,
            Some("fpr") if in_sec && f.get(9).is_some_and(|x| valid_fingerprint(x)) => {
                out.push(GpgKey { fingerprint: f[9].to_string(), user: String::new() });
            }
            Some("uid") if in_sec => {
                if let Some(k) = out.last_mut().filter(|k| k.user.is_empty()) {
                    k.user = f.get(9).unwrap_or(&"").replace("\\x3a", ":");
                }
            }
            _ => {}
        }
    }
    out
}

#[tauri::command]
pub fn gpg_keys() -> Vec<GpgKey> {
    gpg(&["--list-secret-keys", "--with-colons", "--fixed-list-mode"], Duration::from_secs(10))
        .map(|r| parse_secret_keys(&r.stdout_text()))
        .unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    path: String,
    sha256: String,
    signed: bool,
    sign_error: Option<String>,
}

/// Save dialog, then the file, its checksum and (with a key) its signature. None: cancelled.
#[tauri::command]
pub async fn save_file(app: tauri::AppHandle, default_name: String, contents: String, sign_with: Option<String>) -> Result<Option<Saved>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = tauri::async_runtime::spawn_blocking(move || app.dialog().file().set_file_name(&default_name).blocking_save_file())
        .await
        .map_err(|e| e.to_string())?;
    let Some(fp) = picked else { return Ok(None) };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || write_signed(&path, contents.as_bytes(), sign_with.as_deref()).map(Some))
        .await
        .map_err(|e| e.to_string())?
}

/// The file, its checksum and (with a key) its signature — every export goes through here.
pub fn write_signed(path: &Path, bytes: &[u8], sign_with: Option<&str>) -> Result<Saved, String> {
    std::fs::write(path, bytes).map_err(|e| e.to_string())?;
    let sha256 = write_checksum(path, bytes)?;
    let (signed, sign_error) = match sign_with {
        Some(f) => match sign(path, f) {
            Ok(()) => (true, None),
            Err(e) => (false, Some(e)),
        },
        None => {
            let _ = std::fs::remove_file(beside(path, ".asc")); // an old signature would no longer match
            (false, None)
        }
    };
    Ok(Saved { path: path.to_string_lossy().into_owned(), sha256, signed, sign_error })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_saved_file_carries_its_checksum_and_a_changed_one_is_caught() {
        let d = std::env::temp_dir().join(format!("am-sha-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let f = d.join("mine.fluff");
        std::fs::write(&f, b"{\"a\":1}").unwrap();
        let hex = write_checksum(&f, b"{\"a\":1}").unwrap();
        // the standard format, so sha256sum -c agrees
        assert_eq!(std::fs::read_to_string(d.join("mine.fluff.sha256")).unwrap(), format!("{hex}  mine.fluff\n"));
        let ok = std::process::Command::new("sha256sum").arg("-c").arg("mine.fluff.sha256").current_dir(&d).output().unwrap();
        assert!(ok.status.success(), "sha256sum -c accepts it");
        assert_eq!(check_checksum(&f, b"{\"a\":1}").1, "match");
        assert_eq!(check_checksum(&f, b"{\"a\":2}").1, "mismatch");
        assert_eq!(check_checksum(&d.join("other"), b"x").1, "missing");
        assert_eq!(hex, "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862");
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn gpg_verdicts_are_read_from_its_status_lines() {
        let good = "[GNUPG:] NEWSIG\n[GNUPG:] GOODSIG 0123456789ABCDEF Kitten <k@x>\n[GNUPG:] VALIDSIG 89ABCDEF0123456789ABCDEF0123456789ABCDEF 2026-10-27 0\n";
        assert_eq!(parse_verify(good), Signature::Good { signer: "Kitten <k@x>".into(), fingerprint: "89ABCDEF0123456789ABCDEF0123456789ABCDEF".into() });
        assert_eq!(parse_verify("[GNUPG:] BADSIG 0123456789ABCDEF Kitten <k@x>\n"), Signature::Bad);
        assert_eq!(parse_verify("[GNUPG:] ERRSIG 0123456789ABCDEF 1 8 00 1 9\n[GNUPG:] NO_PUBKEY 0123456789ABCDEF\n"), Signature::UnknownKey { key: "0123456789ABCDEF".into() });
        assert!(matches!(parse_verify(""), Signature::Unchecked { .. }));
        // GOODSIG alone (no VALIDSIG) is not taken as good
        assert!(matches!(parse_verify("[GNUPG:] GOODSIG 0123 x\n"), Signature::Unchecked { .. }));
    }

    #[test]
    fn your_signing_keys_are_listed_not_revoked_ones_and_fingerprints_are_strict() {
        let colons = "sec:u:255:22:AAAA:1:::u:::scESC:::+:::23::0:\nfpr:::::::::0123456789ABCDEF0123456789ABCDEF01234567:\nuid:u::::1::H::Kitten <k\\x3ax@y>::::::::::0:\nssb:u:255:18:BBBB:1::::::e:::+:::23:\nfpr:::::::::FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:\nsec:r:255:22:CCCC:1:::u:::sc:::+:::23::0:\nfpr:::::::::1111111111111111111111111111111111111111:\nuid:r::::1::H::Old <o@y>::::::::::0:\n";
        let keys = parse_secret_keys(colons);
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].fingerprint, "0123456789ABCDEF0123456789ABCDEF01234567");
        assert_eq!(keys[0].user, "Kitten <k:x@y>");
        assert!(!valid_fingerprint("--output=/etc/x"));
        assert!(sign(Path::new("/nonexistent"), "--batch").unwrap_err().contains("not a key fingerprint"));
    }

    /// Real gpg, in a throwaway keyring (never yours): sign, verify, tamper, unknown key.
    #[test]
    fn a_real_signature_is_good_until_the_file_changes() {
        use std::os::unix::fs::PermissionsExt;
        let d = std::env::temp_dir().join(format!("am-gpg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let home = d.join("gnupg");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::set_permissions(&home, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::env::set_var("GNUPGHOME", &home); // this test only: no other test runs gpg
        let made = std::process::Command::new("gpg")
            .args(["--batch", "--passphrase", "", "--quick-gen-key", "Test Penguin <test@tuxcopilot.invalid>", "ed25519", "sign", "never"])
            .output()
            .unwrap();
        assert!(made.status.success(), "{}", String::from_utf8_lossy(&made.stderr));
        let keys = gpg_keys();
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].user, "Test Penguin <test@tuxcopilot.invalid>");

        let f = d.join("mine.fluff");
        std::fs::write(&f, b"{}").unwrap();
        sign(&f, &keys[0].fingerprint).unwrap();
        assert!(matches!(check_signature(&f), Signature::Good { ref signer, ref fingerprint } if signer.contains("Test Penguin") && *fingerprint == keys[0].fingerprint));
        std::fs::write(&f, b"{\"changed\":1}").unwrap();
        assert_eq!(check_signature(&f), Signature::Bad);
        std::fs::remove_file(d.join("mine.fluff.asc")).unwrap();
        assert_eq!(check_signature(&f), Signature::None);
        // signed by someone whose key you do not have
        sign(&f, &keys[0].fingerprint).unwrap();
        let other = d.join("other");
        std::fs::create_dir_all(&other).unwrap();
        std::fs::set_permissions(&other, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::env::set_var("GNUPGHOME", &other);
        assert!(matches!(check_signature(&f), Signature::UnknownKey { .. }));
        std::env::remove_var("GNUPGHOME");
        let _ = std::process::Command::new("gpgconf").args(["--homedir"]).arg(&home).args(["--kill", "gpg-agent"]).status();
        std::fs::remove_dir_all(&d).unwrap();
    }
}
