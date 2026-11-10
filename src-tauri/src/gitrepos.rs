// Git clones: where they are, how big, where they came from, and whether you still use them —
// last touched, last commit, anything running from them right now — plus what removing one
// would lose (uncommitted changes, commits never pushed). Read-only.
//
// Searched: your home's own subfolders that are clones (~/my-project), the usual clone
// folders (~/git, ~/src, ~/repos, ~/github, ~/code, ~/clones), and the folders you add.
// Nothing else — not ~/Projects automatically: that's private. Hidden
// folders are never searched: tools keep their own clones there (Dart's .pub-cache…).

use crate::probe::exec;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

const SKIP: &[&str] = &["node_modules", "target", "build", "dist", "venv", "__pycache__", "go", "snap"];
const MAX_DEPTH: usize = 4;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Repo {
    path: String,
    name: String,
    size: u64,
    remote: Option<String>,
    last_commit: Option<i64>, // unix seconds
    last_touched: i64,        // newest of the folder, its top files and git's own records
    running: Vec<i32>,        // pids of your processes working in it or run from it
    uncommitted: Option<u32>, // changed files not committed (None: git did not answer)
    unpushed: Option<u32>,    // commits not on its remote (None: no remote branch to compare)
    yours: bool,              // it holds commits by you (your git name or email)
    holds_home: bool,         // it is your home folder, or above it (/, /home): never removed
}

/// Is this folder your home, or one that holds it (/, /home)? Removing it would remove your home.
pub fn holds_home(repo: &Path, home: &Path) -> bool {
    let canon = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    let (r, h) = (canon(repo), canon(home));
    r.parent().is_none() || h.starts_with(&r)
}

/// Folders holding a `.git` up to `max` levels below root, not descending into a repo or into
/// hidden / build folders.
pub fn find_depth(root: &Path, max: usize) -> Vec<PathBuf> {
    let mut out = vec![];
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        // a repository as git sees one: .git/HEAD, or a .git file (a worktree or submodule)
        let git = dir.join(".git");
        if dir != root && (git.join("HEAD").is_file() || git.is_file()) {
            out.push(dir);
            continue;
        }
        if depth >= max {
            continue;
        }
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.filter_map(|e| e.ok()) {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || SKIP.contains(&name.as_str()) {
                continue;
            }
            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                stack.push((e.path(), depth + 1));
            }
        }
    }
    out.sort();
    out
}

fn mtime(p: &Path) -> i64 {
    p.symlink_metadata().and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// When you last did something there: the folder, its top-level files, git's index (any
/// status/checkout/commit), FETCH_HEAD (pull/fetch), HEAD's log.
pub fn last_touched(repo: &Path) -> i64 {
    let mut t = mtime(repo);
    for f in [".git/index", ".git/FETCH_HEAD", ".git/HEAD", ".git/logs/HEAD"] {
        t = t.max(mtime(&repo.join(f)));
    }
    if let Ok(rd) = std::fs::read_dir(repo) {
        for e in rd.filter_map(|e| e.ok()).filter(|e| e.file_name() != ".git") {
            t = t.max(mtime(&e.path()));
        }
    }
    t
}

/// Your processes whose working folder or program is inside the repo.
pub fn running_in(repo: &Path) -> Vec<i32> {
    let Ok(rd) = std::fs::read_dir("/proc") else { return vec![] };
    let mut pids: Vec<i32> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| e.file_name().to_str()?.parse::<i32>().ok())
        .filter(|pid| {
            ["cwd", "exe"].iter().any(|l| std::fs::read_link(format!("/proc/{pid}/{l}")).is_ok_and(|p| p.starts_with(repo)))
        })
        .collect();
    pids.sort();
    pids
}

fn git(repo: &Path, args: &[&str]) -> Option<String> {
    let mut argv = vec!["git".to_string(), "-C".into(), repo.to_string_lossy().into_owned()];
    argv.extend(args.iter().map(|s| s.to_string()));
    exec(&argv, Duration::from_secs(8)).filter(|r| r.ok()).map(|r| r.stdout_trim())
}

pub fn describe(repo: &Path, me: &[String], home: &Path) -> Repo {
    let remote = git(repo, &["remote", "get-url", "origin"]).filter(|s| !s.is_empty());
    let last_commit = git(repo, &["log", "-1", "--format=%ct"]).and_then(|s| s.parse().ok());
    let uncommitted = git(repo, &["status", "--porcelain"]).map(|s| s.lines().count() as u32);
    let unpushed = git(repo, &["rev-list", "--count", "@{upstream}..HEAD"]).and_then(|s| s.parse().ok());
    let yours = me.iter().filter(|m| !m.is_empty()).any(|m| git(repo, &["log", "-1", "--format=%h", &format!("--author={m}")]).is_some_and(|h| !h.is_empty()));
    Repo {
        name: repo.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        path: repo.to_string_lossy().into_owned(),
        size: crate::disk::dir_size(repo),
        remote,
        last_commit,
        last_touched: last_touched(repo),
        running: running_in(repo),
        uncommitted,
        unpushed,
        yours,
        holds_home: holds_home(repo, home),
    }
}

pub const USUAL: &[&str] = &["git", "src", "repos", "github", "code", "clones"];

/// The repositories in the places searched: home's direct subfolders, the usual clone
/// folders, and `added` (absolute folders you chose), each found once.
pub fn search(home: &Path, added: &[PathBuf]) -> Vec<PathBuf> {
    let mut found = find_depth(home, 1);
    for u in USUAL {
        found.extend(find_depth(&home.join(u), MAX_DEPTH));
    }
    for a in added {
        if a.join(".git").join("HEAD").is_file() {
            found.push(a.clone()); // the folder added is itself a repository
        }
        found.extend(find_depth(a, MAX_DEPTH));
    }
    found.sort();
    found.dedup();
    found
}

#[tauri::command]
pub async fn git_repos(added: Vec<String>) -> Result<Vec<Repo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = std::env::var("HOME").map(PathBuf::from).map_err(|_| "no home folder".to_string())?;
        let added: Vec<PathBuf> = added.into_iter().map(PathBuf::from).filter(|p| p.is_absolute() && p.is_dir()).collect();
        let cfg = |k: &str| exec(&["git".into(), "config".into(), "--global".into(), k.into()], Duration::from_secs(3)).map(|r| r.stdout_trim()).unwrap_or_default();
        let me = vec![cfg("user.email"), cfg("user.name")];
        Ok(search(&home, &added).iter().map(|r| describe(r, &me, &home)).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A folder picker for "Add a folder" (None when cancelled).
#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder()).await.map_err(|e| e.to_string())?;
    Ok(picked.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn your_home_and_what_holds_it_are_never_a_clone_to_remove() {
        let home = std::env::temp_dir().join(format!("am-home-{}", std::process::id()));
        std::fs::create_dir_all(home.join("Projects/x")).unwrap();
        assert!(holds_home(&home, &home), "home itself");
        assert!(holds_home(home.parent().unwrap(), &home), "the folder above it");
        assert!(holds_home(Path::new("/"), &home), "/");
        assert!(!holds_home(&home.join("Projects/x"), &home), "a clone inside home is fine");
        assert!(!holds_home(Path::new("/srv/repo"), &home), "a clone elsewhere is fine");
        // a link to home is home
        let link = std::env::temp_dir().join(format!("am-home-link-{}", std::process::id()));
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink(&home, &link).unwrap();
        assert!(holds_home(&link, &home), "a link to home");
        let _ = std::fs::remove_file(&link);
        let _ = std::fs::remove_dir_all(&home);
    }
    use std::process::Command;

    fn sh(dir: &Path, cmd: &str) {
        let ok = Command::new("bash").arg("-c").arg(cmd).current_dir(dir).env("GIT_CONFIG_GLOBAL", "/dev/null").status().unwrap().success();
        assert!(ok, "{cmd}");
    }

    #[test]
    fn finds_clones_not_hidden_ones_and_reads_what_removing_would_lose() {
        let home = std::env::temp_dir().join(format!("am-git-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        for d in ["Projects/mine", "clone", ".pub-cache/git/dep", "Projects/notarepo/deep"] {
            std::fs::create_dir_all(home.join(d)).unwrap();
        }
        let id = "-c user.name=Me -c user.email=me@x";
        sh(&home.join("Projects/mine"), &format!("git init -q && git {id} commit -q --allow-empty -m one && echo hi > f"));
        sh(&home.join("clone"), &format!("git init -q && git {id} -c user.name=Other -c user.email=o@x commit -q --allow-empty -m theirs"));
        sh(&home.join(".pub-cache/git/dep"), "git init -q");
        std::fs::create_dir_all(home.join("Projects/emptygit/.git")).unwrap(); // an empty .git is no repository
        // ~/Projects is not searched unless added; home's own clones and added folders are
        let rel = |v: Vec<PathBuf>| v.iter().map(|p| p.strip_prefix(&home).unwrap().to_string_lossy().into_owned()).collect::<Vec<_>>();
        assert_eq!(rel(search(&home, &[])), vec!["clone"]);
        assert_eq!(rel(search(&home, &[home.join("Projects")])), vec!["Projects/mine", "clone"]);
        assert_eq!(rel(search(&home, &[home.join("Projects/mine")])), vec!["Projects/mine", "clone"], "an added folder may be a repository itself");

        let me = vec!["me@x".to_string(), "Me".to_string()];
        let mine = describe(&home.join("Projects/mine"), &me, &home);
        assert!(mine.yours);
        assert_eq!(mine.uncommitted, Some(1));
        assert_eq!(mine.unpushed, None); // no remote to compare with
        assert!(mine.last_commit.is_some() && mine.last_touched > 0);
        let clone = describe(&home.join("clone"), &me, &home);
        assert!(!clone.yours);
        assert_eq!(clone.uncommitted, Some(0));
        std::fs::remove_dir_all(&home).unwrap();
    }

    /// On this machine (by hand: cargo test live_repos -- --ignored --nocapture).
    #[test]
    #[ignore]
    fn live_repos() {
        let home = PathBuf::from(std::env::var("HOME").unwrap());
        let me = vec!["269491216+ArchBlackKitten@users.noreply.github.com".to_string(), "ArchBlackKitten".to_string()];
        for r in search(&home, &[]) {
            let d = describe(&r, &me, &home);
            println!("REPO {} size={}MB yours={} remote={:?} touched_days_ago={} running={:?} uncommitted={:?} unpushed={:?}",
                d.path.replace(home.to_str().unwrap(), "~"), d.size >> 20, d.yours, d.remote,
                (std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64 - d.last_touched) / 86400,
                d.running.len(), d.uncommitted, d.unpushed);
        }
    }

    #[test]
    fn a_process_working_in_a_repo_counts_as_using_it() {
        let d = std::env::temp_dir().join(format!("am-git-run-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let mut child = Command::new("sleep").arg("5").current_dir(&d).spawn().unwrap();
        std::thread::sleep(Duration::from_millis(100));
        assert!(running_in(&d).contains(&(child.id() as i32)));
        child.kill().unwrap();
        let _ = child.wait();
        std::fs::remove_dir_all(&d).unwrap();
    }
}
