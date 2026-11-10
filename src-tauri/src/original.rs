// "Is this the real TuxCopilot?" (Settings): what this copy can say about itself — where it
// was built from (a signed release, or a git folder), whether that folder is the creator's
// repository or a fork, whether it was changed there, and, when pacman installed it, whether
// its files changed since. And the program's own SHA-256 with the creator's release key, so it
// can be compared from outside.
//
// Said plainly in the panel: a changed copy could change this check too. The sure checks are
// from outside it — gpg on the release, pacman -Qkk — and the panel gives both.

use crate::probe::exec;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// The creator's repository: anything else is a fork.
pub const CREATOR_REPO: &str = "github.com/ArchBlackKitten/TuxCopilot";
const RELEASE_KEY_ASC: &str = include_str!(concat!(env!("OUT_DIR"), "/release-key.asc"));

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Altered {
    pub path: String,
    pub why: String,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct OriginalFacts {
    pub version: String,
    pub built_from: String, // "release" | "git" | "unknown"
    pub commit: String,
    pub release_key: String, // the creator's release key's fingerprint
    pub creator_repo: String,
    pub release_tag: Option<String>, // the release this commit is
    pub tag_signed: Option<bool>,    // its tag checked against the release key alone (None: no tag, or gpg missing)
    // the git folder it was built from, when it is still there
    pub folder: Option<String>,
    pub folder_moved: bool, // the folder is on another commit now
    pub origin: Option<String>,
    pub origin_web: Option<String>,
    pub is_creators: Option<bool>,
    pub changed_files: Vec<String>,
    pub local_commits: Option<u32>, // commits not in the origin repository
    pub commit_signed: Option<bool>, // None: keys/allowed_signers isn't there to check with
    // installed by pacman
    pub package: Option<String>,
    pub package_files: Option<u32>,
    pub altered: Vec<Altered>,
    pub unreadable: u32,
    pub exe: String,
    pub exe_sha256: Option<String>,
}

/// `HEAD -> main, tag: v0.1.0, origin/main` (git archive's %D) → the release tag.
pub fn tag_from_refs(refs: &str) -> Option<String> {
    refs.split(',').find_map(|r| r.trim().strip_prefix("tag: ")).filter(|t| t.starts_with('v')).map(String::from)
}

/// A remote's address → `host/owner/repo` (no scheme, no user, no `.git`).
pub fn repo_of(url: &str) -> Option<String> {
    let u = url.trim().trim_end_matches('/');
    let rest = if let Some(r) = ["https://", "http://", "ssh://", "git://"].iter().find_map(|s| u.strip_prefix(s)) {
        r.rsplit_once('@').map_or(r, |(_, h)| h).to_string() // user:token@host/…
    } else if let Some((_, r)) = u.split_once('@') {
        r.replacen(':', "/", 1) // git@github.com:owner/repo
    } else {
        return None;
    };
    let rest = rest.strip_suffix(".git").unwrap_or(&rest).to_string();
    (rest.split('/').count() >= 3 && !rest.contains(char::is_whitespace)).then_some(rest)
}

pub fn same_repo(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

/// `pacman -Qkk <pkg>` → files, what changed (path, why), and what couldn't be read.
pub fn parse_qkk(pkg: &str, out: &str) -> (Option<u32>, Vec<Altered>, u32) {
    let mut altered = vec![];
    let mut unreadable = 0;
    let mut total = None;
    let warn = format!("warning: {pkg}: ");
    for l in out.lines() {
        if let Some(rest) = l.strip_prefix(&warn) {
            let (path, why) = rest.rsplit_once(" (").map_or((rest, ""), |(p, w)| (p, w.trim_end_matches(')')));
            if why.contains("Permission denied") || why.starts_with("failed to calculate") {
                unreadable += 1;
            } else {
                altered.push(Altered { path: path.into(), why: why.into() });
            }
        } else if let Some(rest) = l.strip_prefix(&format!("{pkg}: ")) {
            total = rest.split_whitespace().next().and_then(|n| n.parse().ok());
        }
    }
    (total, altered, unreadable)
}

fn git_out(dir: &Path, args: &[&str]) -> Option<String> {
    let mut argv = vec!["git".to_string(), "-C".into(), dir.to_string_lossy().into_owned()];
    argv.extend(args.iter().map(|s| s.to_string()));
    exec(&argv, Duration::from_secs(10)).filter(|r| r.ok()).map(|r| r.stdout_text())
}
fn git(dir: &Path, args: &[&str]) -> Option<String> {
    git_out(dir, args).map(|s| s.trim().to_string())
}

/// `git status --porcelain` → the files changed (each line is "XY path"; X may be a space).
pub fn changed_of(porcelain: &str) -> Vec<String> {
    porcelain.lines().filter_map(|l| l.get(3..)).map(|p| p.rsplit_once(" -> ").map_or(p, |(_, to)| to).to_string()).collect()
}

/// Checks `tag` in `dir` against `key_asc` alone: a keyring of its own holds only that key, so a
/// good signature can only be that key's. None when gpg or git can't be run.
pub fn verify_tag(dir: &Path, tag: &str, key_asc: &str) -> Option<bool> {
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;
    if key_asc.trim().is_empty() {
        return None;
    }
    let home = std::env::temp_dir().join(format!("tuxcopilot-gpg-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok()?.as_nanos()));
    std::fs::create_dir(&home).ok()?;
    let _ = std::fs::set_permissions(&home, std::fs::Permissions::from_mode(0o700));
    let result = (|| {
        let mut imp = std::process::Command::new("gpg")
            .args(["--batch", "--quiet", "--homedir"])
            .arg(&home)
            .arg("--import")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .ok()?;
        imp.stdin.take()?.write_all(key_asc.as_bytes()).ok()?;
        if !imp.wait().ok()?.success() {
            return None;
        }
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["-c", "gpg.format=openpgp", "verify-tag", tag])
            .env("GNUPGHOME", &home)
            .env("LC_ALL", "C")
            .output()
            .ok()?;
        Some(out.status.success())
    })();
    let _ = std::process::Command::new("gpgconf").arg("--homedir").arg(&home).args(["--kill", "all"]).output();
    let _ = std::fs::remove_dir_all(&home);
    result
}

/// Where a folder came from. A clone of a folder on this computer (makepkg clones the AUR
/// package's own copy) is followed to where that folder came from, a few steps at most.
pub fn origin_of(dir: &Path) -> Option<String> {
    let mut url = git(dir, &["remote", "get-url", "origin"])?;
    for _ in 0..3 {
        let local = url.strip_prefix("file://").unwrap_or(&url).to_string();
        if !local.starts_with('/') || !Path::new(&local).is_dir() {
            break;
        }
        match git(Path::new(&local), &["remote", "get-url", "origin"]) {
            Some(next) => url = next,
            None => break,
        }
    }
    Some(url)
}

/// What the git folder says (the one this copy was built from, if it is still there).
fn folder_facts(f: &mut OriginalFacts, dir: &Path) {
    f.folder = Some(dir.to_string_lossy().into_owned());
    f.folder_moved = git(dir, &["rev-parse", "HEAD"]).is_some_and(|h| h != f.commit);
    f.origin = origin_of(dir);
    let repo = f.origin.as_deref().and_then(repo_of);
    f.is_creators = f.origin.as_ref().map(|_| repo.as_deref().is_some_and(|r| same_repo(r, CREATOR_REPO)));
    f.origin_web = repo.filter(|r| r.starts_with("github.com/") || r.starts_with("gitlab.com/") || r.starts_with("codeberg.org/")).map(|r| format!("https://{r}"));
    f.changed_files = changed_of(&git_out(dir, &["status", "--porcelain", "--untracked-files=no"]).unwrap_or_default());
    if f.origin.is_some() {
        f.local_commits = git(dir, &["rev-list", "--count", &f.commit, "--not", "--remotes=origin"]).and_then(|n| n.parse().ok());
    }
    if f.release_tag.is_none() {
        f.release_tag = git(dir, &["tag", "--points-at", &f.commit, "--list", "v*"]).and_then(|t| t.lines().next().map(String::from));
    }
    if let Some(tag) = f.release_tag.clone() {
        f.tag_signed = verify_tag(dir, &tag, RELEASE_KEY_ASC);
    }
    // commits are signed with the creator's SSH key; checked when keys/allowed_signers names it
    let signers = dir.join("keys/allowed_signers");
    if signers.is_file() {
        let opt = format!("gpg.ssh.allowedSignersFile={}", signers.to_string_lossy());
        let mut argv: Vec<String> = ["git", "-C"].iter().map(|s| s.to_string()).collect();
        argv.push(dir.to_string_lossy().into_owned());
        argv.extend(["-c", &opt, "verify-commit", &f.commit].iter().map(|s| s.to_string()));
        f.commit_signed = exec(&argv, Duration::from_secs(10)).map(|r| r.ok());
    }
}

/// When pacman installed this program: its package, and what changed since.
fn package_facts(f: &mut OriginalFacts, exe: &Path) {
    if !exe.starts_with("/usr") {
        return;
    }
    let path = exe.to_string_lossy().into_owned();
    let Some(pkg) = exec(&["pacman".into(), "-Qqo".into(), path], Duration::from_secs(10)).filter(|r| r.ok()).map(|r| r.stdout_trim()) else { return };
    if let Some(r) = exec(&["pacman".into(), "-Qkk".into(), pkg.clone()], Duration::from_secs(60)) {
        (f.package_files, f.altered, f.unreadable) = parse_qkk(&pkg, &r.joined());
    }
    f.package = Some(pkg);
}

pub fn facts_for(exe: &Path, source: Option<PathBuf>) -> OriginalFacts {
    let mut f = OriginalFacts {
        version: env!("CARGO_PKG_VERSION").into(),
        built_from: env!("TUX_BUILT_FROM").into(),
        commit: env!("TUX_COMMIT").into(),
        release_key: env!("TUX_RELEASE_KEY").into(),
        creator_repo: CREATOR_REPO.into(),
        release_tag: tag_from_refs(env!("TUX_REFS")),
        exe: exe.to_string_lossy().into_owned(),
        exe_sha256: std::fs::read(exe).ok().map(|b| crate::integrity::sha256_hex(&b)),
        ..Default::default()
    };
    if f.built_from == "git" {
        if let Some(dir) = source.filter(|d| d.join(".git").exists()) {
            folder_facts(&mut f, &dir);
        }
    }
    package_facts(&mut f, exe);
    f
}

/// What a process of TuxCopilot's is, by the process itself (never by its port number): this
/// program, or a project's dev preview — a Vite server whose folder is a TuxCopilot project.
pub fn role_of(cmdline: &[String], folder_package: Option<&str>, is_this_program: bool) -> Option<String> {
    if is_this_program {
        return Some("TuxCopilot itself".into());
    }
    let vite = cmdline.iter().take(3).any(|a| a == "vite" || a.ends_with("/vite") || a.ends_with("/vite.js") || a.ends_with("/vite/bin/vite.js"));
    (vite && folder_package == Some("tuxcopilot")).then(|| "TuxCopilot's dev preview (the page npm run tauri dev shows)".into())
}

/// The name in a folder's package.json.
fn package_name(dir: &Path) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("package.json")).ok()?).ok()?;
    v["name"].as_str().map(String::from)
}

/// For each process id: what it is of TuxCopilot's, read from /proc (your own processes only;
/// another user's are unreadable, and stay unnamed).
#[tauri::command]
pub fn own_processes(pids: Vec<u32>) -> Vec<(u32, String)> {
    let me = std::env::current_exe().ok().and_then(|p| p.canonicalize().ok());
    pids.into_iter()
        .take(512)
        .filter_map(|pid| {
            let proc = PathBuf::from(format!("/proc/{pid}"));
            let cmdline: Vec<String> = std::fs::read(proc.join("cmdline")).ok()?.split(|b| *b == 0).filter(|a| !a.is_empty()).map(|a| String::from_utf8_lossy(a).into_owned()).collect();
            let exe = std::fs::read_link(proc.join("exe")).ok();
            let is_me = me.is_some() && exe.as_ref().and_then(|e| e.canonicalize().ok()) == me;
            let folder = std::fs::read_link(proc.join("cwd")).ok().and_then(|d| package_name(&d));
            role_of(&cmdline, folder.as_deref(), is_me).map(|r| (pid, r))
        })
        .collect()
}

#[tauri::command]
pub async fn original_check() -> Result<OriginalFacts, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        // the folder this was built in (src-tauri's parent), if it is still on this computer; none
        // for a package (build.rs)
        let source = Some(env!("TUX_SOURCE_DIR")).filter(|s| !s.is_empty()).map(PathBuf::from);
        Ok(facts_for(&exe, source))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_release_and_the_repository_are_read() {
        assert_eq!(tag_from_refs("HEAD -> main, tag: v0.1.0, origin/main").as_deref(), Some("v0.1.0"));
        assert_eq!(tag_from_refs("tag: snap-pre-x, main"), None, "only release tags");
        assert_eq!(tag_from_refs(""), None);
        for (url, repo) in [
            ("https://github.com/ArchBlackKitten/TuxCopilot.git", "github.com/ArchBlackKitten/TuxCopilot"),
            ("https://github.com/ArchBlackKitten/TuxCopilot/", "github.com/ArchBlackKitten/TuxCopilot"),
            ("git@github.com:ArchBlackKitten/TuxCopilot.git", "github.com/ArchBlackKitten/TuxCopilot"),
            ("ssh://git@github.com/someone/TuxCopilot", "github.com/someone/TuxCopilot"),
            ("https://user:tok@codeberg.org/x/tux", "codeberg.org/x/tux"),
        ] {
            assert_eq!(repo_of(url).as_deref(), Some(repo), "{url}");
        }
        assert_eq!(repo_of("/home/me/tux"), None);
        assert!(same_repo("github.com/archblackkitten/tuxcopilot", CREATOR_REPO));
        assert!(!same_repo("github.com/someone/TuxCopilot", CREATOR_REPO));
        assert!(!same_repo("github.com/ArchBlackKitten/TuxCopilot-fork", CREATOR_REPO));
    }

    #[test]
    fn the_changed_files_are_named_whole() {
        assert_eq!(changed_of(" M docs/notes.md\nM  src/a.ts\nR  old.rs -> new.rs\n"), ["docs/notes.md", "src/a.ts", "new.rs"]);
    }

    #[test]
    fn pacman_says_what_changed_since_it_installed() {
        let out = "warning: tuxcopilot: /usr/bin/tuxcopilot (SHA256 checksum mismatch)\nwarning: tuxcopilot: /usr/share/x (Modification time mismatch)\nwarning: tuxcopilot: /etc/y (failed to calculate SHA256 checksum)\nwarning: other: /z (Size mismatch)\ntuxcopilot: 9 total files, 3 altered files\n";
        let (total, altered, unreadable) = parse_qkk("tuxcopilot", out);
        assert_eq!(total, Some(9));
        assert_eq!(altered, vec![Altered { path: "/usr/bin/tuxcopilot".into(), why: "SHA256 checksum mismatch".into() }, Altered { path: "/usr/share/x".into(), why: "Modification time mismatch".into() }]);
        assert_eq!(unreadable, 1);
        assert_eq!(parse_qkk("tuxcopilot", "tuxcopilot: 9 total files, 0 altered files\n"), (Some(9), vec![], 0));
    }

    /// A tag signed by another key is refused; signed by the key given, it passes. A keyring of
    /// its own each time, so what the computer's own keyring trusts never counts.
    #[test]
    fn only_the_release_key_makes_a_release_tag_good() {
        let run = |dir: &Path, home: &Path, args: &[&str]| {
            std::process::Command::new(args[0]).args(&args[1..]).current_dir(dir).env("GNUPGHOME", home).env("GIT_CONFIG_GLOBAL", "/dev/null").env("GIT_CONFIG_NOSYSTEM", "1").output().map(|o| (o.status.success(), String::from_utf8_lossy(&o.stdout).into_owned()))
        };
        let base = std::env::temp_dir().join(format!("tux-original-test-{}", std::process::id()));
        let (home, repo) = (base.join("gpg"), base.join("repo"));
        std::fs::create_dir_all(&repo).unwrap();
        std::fs::create_dir_all(&home).unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&home, std::fs::Permissions::from_mode(0o700)).unwrap();
        let ok = |a: &[&str]| run(&repo, &home, a).is_ok_and(|(s, _)| s);
        if !ok(&["git", "--version"]) || !ok(&["gpg", "--version"]) {
            eprintln!("git or gpg missing: skipped");
            return;
        }
        assert!(ok(&["gpg", "--batch", "--passphrase", "", "--quick-gen-key", "Someone Else <else@example.invalid>", "ed25519", "sign", "never"]));
        assert!(ok(&["git", "init", "-q"]));
        assert!(ok(&["git", "-c", "user.name=x", "-c", "user.email=x@example.invalid", "commit", "-q", "--allow-empty", "-m", "x"]));
        assert!(ok(&["git", "-c", "user.name=x", "-c", "user.email=else@example.invalid", "-c", "gpg.format=openpgp", "-c", "user.signingkey=else@example.invalid", "tag", "-s", "v9.9.9", "-m", "x"]));
        let other = run(&repo, &home, &["gpg", "--armor", "--export", "else@example.invalid"]).unwrap().1;
        assert_eq!(verify_tag(&repo, "v9.9.9", RELEASE_KEY_ASC), Some(false), "signed, but not by the release key");
        assert_eq!(verify_tag(&repo, "v9.9.9", &other), Some(true), "the key that signed it");
        assert_eq!(verify_tag(&repo, "v9.9.9", ""), None);
        let _ = run(&repo, &home, &["gpgconf", "--kill", "all"]);
        let _ = std::fs::remove_dir_all(&base);
    }

    /// makepkg's way: a bare copy of the creator's repository, cloned again to build. The
    /// build folder's origin is that copy on disk; Fluff follows it to GitHub.
    #[test]
    fn a_clone_of_a_local_copy_is_followed_to_where_it_came_from() {
        let base = std::env::temp_dir().join(format!("tux-origin-test-{}", std::process::id()));
        let (bare, build) = (base.join("tuxcopilot"), base.join("src/tuxcopilot"));
        std::fs::create_dir_all(&base).unwrap();
        let ok = |args: &[&str]| std::process::Command::new("git").args(args).env("GIT_CONFIG_GLOBAL", "/dev/null").env("GIT_CONFIG_NOSYSTEM", "1").output().is_ok_and(|o| o.status.success());
        if !ok(&["--version"]) {
            eprintln!("git missing: skipped");
            return;
        }
        let (b, d) = (bare.to_string_lossy().into_owned(), build.to_string_lossy().into_owned());
        assert!(ok(&["init", "-q", "--bare", &b]));
        assert!(ok(&["-C", &b, "remote", "add", "origin", "https://github.com/ArchBlackKitten/TuxCopilot.git"]));
        assert!(ok(&["clone", "-q", &b, &d]));
        assert_eq!(git(&build, &["remote", "get-url", "origin"]).as_deref(), Some(b.as_str()));
        assert_eq!(origin_of(&build).as_deref(), Some("https://github.com/ArchBlackKitten/TuxCopilot.git"));
        assert!(ok(&["-C", &b, "remote", "remove", "origin"]));
        assert_eq!(origin_of(&build).as_deref(), Some(b.as_str()), "a copy with no address of its own stays itself");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn its_processes_are_known_by_what_they_are() {
        let a = |xs: &[&str]| xs.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(role_of(&a(&["/usr/bin/whatever"]), None, true).as_deref(), Some("TuxCopilot itself"));
        let dev = role_of(&a(&["node", "/home/me/TuxCopilot/node_modules/.bin/vite"]), Some("tuxcopilot"), false);
        assert!(dev.is_some_and(|r| r.contains("dev preview")));
        assert!(role_of(&a(&["node", "/x/node_modules/vite/bin/vite.js", "--port", "5173"]), Some("tuxcopilot"), false).is_some());
        assert_eq!(role_of(&a(&["node", "/x/node_modules/.bin/vite"]), Some("someone-elses-site"), false), None, "another project's preview");
        assert_eq!(role_of(&a(&["node", "server.js"]), Some("tuxcopilot"), false), None, "not a Vite server");
        assert_eq!(role_of(&a(&["python", "-m", "http.server", "vite"]), Some("tuxcopilot"), false), None, "\"vite\" as a later argument");
    }

    /// A real process: a "vite" in a folder whose package.json says tuxcopilot.
    #[test]
    fn a_dev_preview_is_found_by_its_process() {
        let dir = std::env::temp_dir().join(format!("tux-own-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("package.json"), r#"{"name": "tuxcopilot", "version": "0.1.0"}"#).unwrap();
        let other = dir.join("other");
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(other.join("package.json"), r#"{"name": "someone-elses-site"}"#).unwrap();
        let Ok(mut child) = std::process::Command::new("bash").args(["-c", "exec -a vite sleep 30"]).current_dir(&dir).spawn() else { return };
        let Ok(mut theirs) = std::process::Command::new("bash").args(["-c", "exec -a vite sleep 30"]).current_dir(&other).spawn() else { return };
        let pid = child.id();
        let mut found = vec![];
        // until bash has become "vite" — seen as the dev preview, not merely seen (a busy machine
        // can catch it in between; the assertions below are unchanged)
        for _ in 0..250 {
            found = own_processes(vec![pid, theirs.id(), std::process::id()]);
            if found.iter().any(|(p, r)| *p == pid && r.contains("dev preview")) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let theirs_pid = theirs.id();
        for c in [&mut child, &mut theirs] {
            let _ = c.kill();
            let _ = c.wait();
        }
        assert!(!found.iter().any(|(p, _)| *p == theirs_pid), "another project's Vite is not TuxCopilot's: {found:?}");
        let _ = std::fs::remove_dir_all(&dir);
        assert!(found.iter().any(|(p, r)| *p == pid && r.contains("dev preview")), "{found:?}");
        // the program running this is "TuxCopilot itself" (here, the test runner: the same check)
        assert!(found.iter().any(|(p, r)| *p == std::process::id() && r == "TuxCopilot itself"), "{found:?}");
    }

    #[test]
    fn the_release_key_is_built_in() {
        assert!(RELEASE_KEY_ASC.contains("BEGIN PGP PUBLIC KEY BLOCK"));
        assert_eq!(env!("TUX_RELEASE_KEY").len(), 40);
    }

    /// This computer: `cargo test this_copy_of_tuxcopilot -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn this_copy_of_tuxcopilot() {
        println!("{:#?}", tauri::async_runtime::block_on(original_check()).unwrap());
    }

    /// A package keeps no build folder in the program (makepkg's is gone, and names who built it);
    /// a build from a folder of yours (./install.sh) keeps it, to look there later.
    #[test]
    fn a_package_keeps_no_build_folder() {
        let source = env!("TUX_SOURCE_DIR");
        if option_env!("TUXCOPILOT_PACKAGE").is_some() {
            assert_eq!(source, "", "a package build");
        } else {
            assert!(Path::new(source).join("src-tauri/build.rs").exists(), "the repository's own folder: {source}");
        }
    }
}
