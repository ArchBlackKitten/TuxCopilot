// What you had on the old computer, carried in the penguin so the new one can get it back.
// Settings → Relocate Fluff: a relocation, not a penguin with missing shoes.
//
//   apps:     the ones YOU installed (pacman -Qqen / -Qqem, Flatpak apps), not what came with them
//   git:      your clones (the places the Git section searches), by where they live in your home
//             and where they came from — a clone with no remote cannot be downloaded again, and
//             work never pushed is not in any remote: both are said before you export.
//   ollama:   your models, by name (read from Ollama's folder, so Ollama need not be running),
//             downloaded again — gigabytes do not belong in a file you carry
//   docker:   your images, by name, pulled again
//   torrc:    Tor's settings file, put back the way the Tor section saves one (Tor checks it)
//   firewall: firewalld's own settings (/etc/firewalld), put back with the old ones kept
//
// A penguin may come from anyone, so everything in it is checked before it can become part of
// a command: package names, Flatpak ids, git addresses, branches and folders each have their
// rules, and what breaks them is refused and listed. Passwords or tokens written into a git
// address (https://name:token@host/…) are taken out at export.

use crate::probe::exec;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
pub struct Belongings {
    pub pacman: Vec<String>,
    pub aur: Vec<String>,
    pub flatpak: Vec<String>,
    pub git: Vec<GitClone>,
    #[serde(default)]
    pub ollama: Vec<String>,
    #[serde(default)]
    pub docker: Vec<String>,
    #[serde(default)]
    pub torrc: Option<String>,
    #[serde(default)]
    pub firewall: Vec<SysFile>,
}

/// A settings file of the system, by where it lives inside its folder (e.g. "zones/home.xml").
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct SysFile {
    pub path: String,
    pub text: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct GitClone {
    pub path: String, // inside your home, e.g. "git/yay"
    pub remote: String,
    pub branch: Option<String>,
}

/// Said before you export: what the penguin cannot bring back.
#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct NotCarried {
    pub no_remote: Vec<String>,       // clones that exist only on this computer
    pub unsaved_work: Vec<String>,    // changes not committed, or commits not pushed
    pub outside_home: Vec<String>,    // clones outside your home folder
    pub docker_unreadable: bool,      // Docker is here but would not list its images to you
}

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Missing {
    pub pacman: Vec<String>,
    pub not_in_repos: Vec<String>, // in no repository this computer uses (another distro's, or renamed)
    pub aur: Vec<String>,
    pub flatpak: Vec<String>,
    pub git: Vec<GitClone>,
    pub already_here: usize,
    pub refused: Vec<String>,
    pub yay: bool, // AUR apps need it; a new Arch has none
    pub ollama: Vec<String>,
    pub docker: Vec<String>,
    pub torrc: Option<String>,     // the old computer's, when it differs from this one's
    pub firewall: Vec<SysFile>,    // all of the old computer's, when any of them differs
}

// ── the rules ────────────────────────────────────────────────────────────

pub fn valid_package(n: &str) -> bool {
    !n.is_empty() && n.len() <= 128 && !n.starts_with(['-', '.']) && n.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "@._+-".contains(c))
}

pub fn valid_flatpak(id: &str) -> bool {
    id.len() <= 255 && id.contains('.') && !id.starts_with(['-', '.']) && id.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
}

pub fn valid_remote(u: &str) -> bool {
    let safe = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-._~/:@%+=".contains(c));
    u.len() <= 400
        && ((u.starts_with("https://") || u.starts_with("ssh://")) && safe(u)
            || u.starts_with("git@") && safe(u))
}

pub fn valid_branch(b: &str) -> bool {
    !b.is_empty() && b.len() <= 200 && !b.starts_with(['-', '/']) && !b.contains("..") && b.chars().all(|c| c.is_ascii_alphanumeric() || "._/-".contains(c))
}

pub fn valid_model(n: &str) -> bool {
    !n.is_empty() && n.len() <= 200 && !n.starts_with(['-', '.', '/']) && !n.contains("..") && n.chars().all(|c| c.is_ascii_alphanumeric() || "._:/-".contains(c))
}

pub fn valid_image(n: &str) -> bool {
    !n.is_empty() && n.len() <= 300 && !n.starts_with(['-', '.', '/']) && !n.contains("..") && n.chars().all(|c| c.is_ascii_alphanumeric() || "._:/@-".contains(c))
}

/// A settings file of firewalld: a .xml inside its folder, or firewalld.conf.
pub fn valid_firewall_file(f: &SysFile) -> bool {
    f.text.len() <= 1024 * 1024
        && (f.path == "firewalld.conf" || f.path.ends_with(".xml"))
        && Path::new(&f.path).components().all(|c| matches!(c, Component::Normal(_)))
        && f.path.split('/').all(|p| !p.is_empty() && !p.starts_with(['-', '.']) && p.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)))
}

pub fn valid_folder(p: &str) -> bool {
    let path = Path::new(p);
    !p.is_empty()
        && p.len() <= 400
        && path.components().all(|c| matches!(c, Component::Normal(_)))
        && p.split('/').all(|part| !part.starts_with('-'))
        && p.chars().all(|c| c.is_alphanumeric() || " ._-+@/".contains(c))
}

/// https://name:token@host/x → https://host/x (the address works; the secret stays here).
pub fn without_secret(u: &str) -> String {
    for scheme in ["https://", "http://", "ssh://"] {
        if let Some(rest) = u.strip_prefix(scheme) {
            let host_end = rest.find('/').unwrap_or(rest.len());
            if let Some(at) = rest[..host_end].rfind('@') {
                let user = &rest[..at];
                // ssh://git@host is a user name, not a secret: keep it
                if scheme == "ssh://" && !user.contains(':') {
                    return u.to_string();
                }
                return format!("{scheme}{}", &rest[at + 1..]);
            }
        }
    }
    u.to_string()
}

/// What follows the rules, and a line for each thing that did not.
pub fn checked(b: &Belongings) -> (Belongings, Vec<String>) {
    let mut refused = vec![];
    let keep = |list: &[String], ok: fn(&str) -> bool, what: &str, refused: &mut Vec<String>| -> Vec<String> {
        let mut out = vec![];
        for x in list {
            if ok(x) {
                out.push(x.clone());
            } else {
                refused.push(format!("{what} “{}”", x.chars().take(60).collect::<String>()));
            }
        }
        out.sort();
        out.dedup();
        out
    };
    let pacman = keep(&b.pacman, valid_package, "package", &mut refused);
    let aur = keep(&b.aur, valid_package, "AUR package", &mut refused);
    let flatpak = keep(&b.flatpak, valid_flatpak, "Flatpak app", &mut refused);
    let mut git = vec![];
    for g in &b.git {
        if valid_folder(&g.path) && valid_remote(&g.remote) && g.branch.as_deref().is_none_or(valid_branch) {
            git.push(g.clone());
        } else {
            refused.push(format!("git clone “{}”", g.path.chars().take(60).collect::<String>()));
        }
    }
    let ollama = keep(&b.ollama, valid_model, "Ollama model", &mut refused);
    let docker = keep(&b.docker, valid_image, "Docker image", &mut refused);
    let torrc = match &b.torrc {
        Some(t) if t.len() > 1024 * 1024 || t.contains('\0') => {
            refused.push("the torrc".into());
            None
        }
        t => t.clone(),
    };
    let mut firewall = vec![];
    for f in &b.firewall {
        if valid_firewall_file(f) {
            firewall.push(f.clone());
        } else {
            refused.push(format!("firewall file “{}”", f.path.chars().take(60).collect::<String>()));
        }
    }
    (Belongings { pacman, aur, flatpak, git, ollama, docker, torrc, firewall }, refused)
}

// ── this computer ────────────────────────────────────────────────────────

fn lines(argv: &[&str]) -> Vec<String> {
    let argv: Vec<String> = argv.iter().map(|s| s.to_string()).collect();
    exec(&argv, Duration::from_secs(30)).filter(|r| r.ok()).map(|r| r.lines()).unwrap_or_default()
}

fn git(repo: &Path, args: &[&str]) -> Option<String> {
    let mut argv = vec!["git".to_string(), "-C".into(), repo.to_string_lossy().into_owned()];
    argv.extend(args.iter().map(|s| s.to_string()));
    exec(&argv, Duration::from_secs(10)).filter(|r| r.ok()).map(|r| r.stdout_trim())
}

pub fn installed_packages() -> HashSet<String> {
    lines(&["pacman", "-Qq"]).into_iter().collect()
}

pub fn flatpaks_here() -> HashSet<String> {
    lines(&["flatpak", "list", "--app", "--columns=application"]).into_iter().collect()
}

/// Your apps and clones on this computer, and what of them a penguin cannot bring back.
pub fn here(home: &Path, added: &[PathBuf]) -> (Belongings, NotCarried) {
    let mut not = NotCarried::default();
    let mut clones = vec![];
    for repo in crate::gitrepos::search(home, added) {
        let shown = repo.to_string_lossy().replace(&*home.to_string_lossy(), "~");
        let Ok(rel) = repo.strip_prefix(home) else {
            not.outside_home.push(shown);
            continue;
        };
        let Some(remote) = git(&repo, &["remote", "get-url", "origin"]).filter(|r| !r.is_empty()) else {
            not.no_remote.push(shown);
            continue;
        };
        let dirty = git(&repo, &["status", "--porcelain"]).is_some_and(|s| !s.is_empty());
        let ahead = git(&repo, &["rev-list", "--count", "@{upstream}..HEAD"]).is_some_and(|n| n != "0");
        if dirty || ahead {
            not.unsaved_work.push(shown);
        }
        let branch = git(&repo, &["symbolic-ref", "--short", "HEAD"]);
        clones.push(GitClone { path: rel.to_string_lossy().into_owned(), remote: without_secret(&remote), branch });
    }
    let mut flatpak: Vec<String> = flatpaks_here().into_iter().collect();
    flatpak.sort();
    let docker = docker_images();
    not.docker_unreadable = docker.is_none() && Path::new("/usr/bin/docker").exists();
    let b = Belongings {
        pacman: lines(&["pacman", "-Qqen"]),
        aur: lines(&["pacman", "-Qqem"]),
        flatpak,
        git: clones,
        ollama: ollama_models(home),
        docker: docker.unwrap_or_default(),
        torrc: std::fs::read_to_string(TORRC).ok(),
        firewall: firewall_files(Path::new(FIREWALLD)),
    };
    (b, not)
}

pub const TORRC: &str = "/etc/tor/torrc";
pub const FIREWALLD: &str = "/etc/firewalld";

/// Where Ollama keeps its models: the system service's folder, or yours.
fn ollama_dirs(home: &Path) -> Vec<PathBuf> {
    vec![
        PathBuf::from("/var/lib/ollama/manifests"),
        PathBuf::from("/var/lib/ollama/models/manifests"),
        PathBuf::from("/var/lib/ollama/.ollama/models/manifests"),
        PathBuf::from("/usr/share/ollama/.ollama/models/manifests"),
        home.join(".ollama/models/manifests"),
    ]
}

/// manifests/<registry>/<namespace>/<model>/<tag> → "model:tag" (Ollama's own library),
/// "namespace/model:tag", or "registry/namespace/model:tag" — the names `ollama pull` takes.
pub fn models_in(manifests: &Path) -> Vec<String> {
    let mut out = vec![];
    let sub = |p: &Path| -> Vec<(String, PathBuf)> {
        std::fs::read_dir(p).map(|rd| rd.flatten().map(|e| (e.file_name().to_string_lossy().into_owned(), e.path())).collect()).unwrap_or_default()
    };
    for (registry, rp) in sub(manifests) {
        for (ns, np) in sub(&rp) {
            for (model, mp) in sub(&np) {
                for (tag, tp) in sub(&mp) {
                    if !tp.is_file() {
                        continue;
                    }
                    out.push(match (registry.as_str(), ns.as_str()) {
                        ("registry.ollama.ai", "library") => format!("{model}:{tag}"),
                        ("registry.ollama.ai", _) => format!("{ns}/{model}:{tag}"),
                        _ => format!("{registry}/{ns}/{model}:{tag}"),
                    });
                }
            }
        }
    }
    out
}

pub fn ollama_models(home: &Path) -> Vec<String> {
    let mut all: Vec<String> = ollama_dirs(home).iter().flat_map(|d| models_in(d)).collect();
    all.sort();
    all.dedup();
    all
}

/// Your Docker images by name (None: Docker is not here, or would not answer you).
pub fn docker_images() -> Option<Vec<String>> {
    let argv = ["docker", "image", "ls", "--format", "{{.Repository}}:{{.Tag}}"].map(String::from);
    let r = exec(&argv, Duration::from_secs(20)).filter(|r| r.ok())?;
    let mut v: Vec<String> = r.lines().into_iter().filter(|l| !l.contains("<none>")).collect();
    v.sort();
    v.dedup();
    Some(v)
}

pub fn firewall_files(root: &Path) -> Vec<SysFile> {
    fn walk(root: &Path, rel: &str, out: &mut Vec<SysFile>) {
        let dir = if rel.is_empty() { root.to_path_buf() } else { root.join(rel) };
        let Ok(rd) = std::fs::read_dir(&dir) else { return };
        let mut names: Vec<_> = rd.flatten().collect();
        names.sort_by_key(|e| e.file_name());
        for e in names {
            let name = e.file_name().to_string_lossy().into_owned();
            let path = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            let Ok(m) = std::fs::symlink_metadata(e.path()) else { continue };
            if m.is_dir() {
                walk(root, &path, out);
            } else if m.is_file() {
                if let Ok(text) = std::fs::read_to_string(e.path()) {
                    let f = SysFile { path, text };
                    if valid_firewall_file(&f) {
                        out.push(f);
                    }
                }
            }
        }
    }
    let mut out = vec![];
    walk(root, "", &mut out);
    out
}

/// What of `b` this computer does not have yet.
pub fn missing(b: &Belongings, installed: &HashSet<String>, in_repos: &HashSet<String>, flatpaks: &HashSet<String>, home: &Path) -> Missing {
    let (b, refused) = checked(b);
    let mut m = Missing { refused, ..Default::default() };
    for p in &b.pacman {
        if installed.contains(p) {
            m.already_here += 1;
        } else if in_repos.contains(p) {
            m.pacman.push(p.clone());
        } else {
            m.not_in_repos.push(p.clone());
        }
    }
    for p in &b.aur {
        if installed.contains(p) {
            m.already_here += 1;
        } else {
            m.aur.push(p.clone());
        }
    }
    for f in &b.flatpak {
        if flatpaks.contains(f) {
            m.already_here += 1;
        } else {
            m.flatpak.push(f.clone());
        }
    }
    for g in &b.git {
        if home.join(&g.path).exists() {
            m.already_here += 1;
        } else {
            m.git.push(g.clone());
        }
    }
    m
}

/// What of the system's side differs here: models, images, the torrc, the firewall.
pub fn missing_system(b: &Belongings, m: &mut Missing, models: &[String], images: Option<&[String]>, torrc: Option<&str>, firewall: &[SysFile]) {
    let (b, refused) = checked(b);
    for r in refused {
        if !m.refused.contains(&r) {
            m.refused.push(r);
        }
    }
    for x in &b.ollama {
        if models.contains(x) {
            m.already_here += 1;
        } else {
            m.ollama.push(x.clone());
        }
    }
    for x in &b.docker {
        if images.is_some_and(|i| i.contains(x)) {
            m.already_here += 1;
        } else {
            m.docker.push(x.clone());
        }
    }
    m.torrc = b.torrc.filter(|t| Some(t.as_str()) != torrc);
    let differs = b.firewall.iter().any(|f| !firewall.iter().any(|h| h.path == f.path && h.text == f.text));
    if differs {
        m.firewall = b.firewall;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    /// On a real computer, counts only: `cargo test -- --ignored this_computer --nocapture`
    #[test]
    #[ignore]
    fn this_computer() {
        let home = PathBuf::from(std::env::var("HOME").unwrap());
        let (b, not) = here(&home, &[]);
        let (ok, refused) = checked(&b);
        println!("pacman {} aur {} flatpak {} git {} | refused {} | no remote {} unsaved {} outside {}", b.pacman.len(), b.aur.len(), b.flatpak.len(), b.git.len(), refused.len(), not.no_remote.len(), not.unsaved_work.len(), not.outside_home.len());
        let c = crate::configs::candidates(&home);
        println!("ollama {} docker {} (unreadable {}) torrc {} firewall files {} | settings offered {} ticked {} ({} MB ticked, {} MB all)", b.ollama.len(), b.docker.len(), not.docker_unreadable, b.torrc.is_some(), b.firewall.len(), c.len(), c.iter().filter(|x| x.ticked).count(), c.iter().filter(|x| x.ticked).map(|x| x.size).sum::<u64>() >> 20, c.iter().map(|x| x.size).sum::<u64>() >> 20);
        assert_eq!(ok, Belongings { pacman: { let mut v = b.pacman.clone(); v.sort(); v.dedup(); v }, ..ok.clone() }, "a real list passes the rules");
        assert!(refused.is_empty(), "nothing real is refused");
        let m = missing(&b, &installed_packages(), &HashSet::new(), &flatpaks_here(), &home);
        let mut m = m;
        missing_system(&b, &mut m, &ollama_models(&home), docker_images().as_deref(), std::fs::read_to_string(TORRC).ok().as_deref(), &firewall_files(Path::new(FIREWALLD)));
        assert_eq!(m.pacman.len() + m.aur.len() + m.flatpak.len() + m.git.len() + m.not_in_repos.len() + m.ollama.len() + m.docker.len() + m.firewall.len(), 0, "this computer misses nothing of its own");
        assert!(m.torrc.is_none());
    }

    #[test]
    fn ollama_models_are_named_as_ollama_pull_takes_them() {
        let d = std::env::temp_dir().join(format!("tux-ollama-{}", std::process::id()));
        for p in ["registry.ollama.ai/library/llama3.2/3b", "registry.ollama.ai/me/tuned/latest", "hf.co/bartowski/Qwen-GGUF/Q4_K_M"] {
            std::fs::create_dir_all(d.join(p).parent().unwrap()).unwrap();
            std::fs::write(d.join(p), "{}").unwrap();
        }
        let mut m = models_in(&d);
        m.sort();
        assert_eq!(m, s(&["hf.co/bartowski/Qwen-GGUF:Q4_K_M", "llama3.2:3b", "me/tuned:latest"]));
        std::fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn a_secret_in_a_git_address_stays_on_this_computer() {
        assert_eq!(without_secret("https://kitten:ghp_abc123@github.com/me/x.git"), "https://github.com/me/x.git");
        assert_eq!(without_secret("https://token@gitlab.com/me/x"), "https://gitlab.com/me/x");
        assert_eq!(without_secret("https://github.com/me/x.git"), "https://github.com/me/x.git");
        assert_eq!(without_secret("git@github.com:me/x.git"), "git@github.com:me/x.git");
        assert_eq!(without_secret("ssh://git@host/x"), "ssh://git@host/x");
        assert_eq!(without_secret("ssh://git:pw@host/x"), "ssh://host/x");
    }

    #[test]
    fn nothing_from_a_penguin_becomes_a_command_unchecked() {
        let b = Belongings {
            pacman: s(&["firefox", "linux-zen", "--overwrite=*", "a;rm -rf ~", "qt6-base", "Firefox"]),
            aur: s(&["yay-bin", "x$(id)"]),
            flatpak: s(&["org.kde.krita", "org.x;id", "-org.x"]),
            git: vec![
                GitClone { path: "git/yay".into(), remote: "https://aur.archlinux.org/yay.git".into(), branch: Some("master".into()) },
                GitClone { path: "../../etc".into(), remote: "https://x.org/a".into(), branch: None },
                GitClone { path: "git/a".into(), remote: "https://x.org/a';id;'".into(), branch: None },
                GitClone { path: "git/b".into(), remote: "file:///etc".into(), branch: None },
                GitClone { path: "git/c".into(), remote: "https://x.org/c".into(), branch: Some("--upload-pack=id".into()) },
                GitClone { path: "-x".into(), remote: "https://x.org/c".into(), branch: None },
            ],
            ..Default::default()
        };
        let mut b = b;
        b.ollama = s(&["llama3.2:3b", "hf.co/bartowski/x:Q4", "a;id", "--help"]);
        b.docker = s(&["hello-world:latest", "ghcr.io/me/app@sha256:abc", "$(id)"]);
        b.firewall = vec![
            SysFile { path: "zones/home.xml".into(), text: "<zone/>".into() },
            SysFile { path: "../shadow".into(), text: "x".into() },
            SysFile { path: "zones/x.sh".into(), text: "x".into() },
        ];
        let (ok, refused) = checked(&b);
        assert_eq!(ok.ollama, s(&["hf.co/bartowski/x:Q4", "llama3.2:3b"]));
        assert_eq!(ok.docker, s(&["ghcr.io/me/app@sha256:abc", "hello-world:latest"]));
        assert_eq!(ok.firewall.len(), 1);
        assert_eq!(ok.pacman, s(&["firefox", "linux-zen", "qt6-base"]));
        assert_eq!(ok.aur, s(&["yay-bin"]));
        assert_eq!(ok.flatpak, s(&["org.kde.krita"]));
        assert_eq!(ok.git.len(), 1);
        assert_eq!(refused.len(), 3 + 1 + 2 + 5 + 2 + 1 + 2);
    }

    #[test]
    fn what_is_missing_here_by_source() {
        let home = std::env::temp_dir().join(format!("tux-belong-{}", std::process::id()));
        std::fs::create_dir_all(home.join("git/have")).unwrap();
        let b = Belongings {
            pacman: s(&["firefox", "krita", "cachyos-settings"]),
            aur: s(&["yay-bin", "brave-bin"]),
            flatpak: s(&["org.kde.krita", "com.spotify.Client"]),
            git: vec![
                GitClone { path: "git/have".into(), remote: "https://x.org/have".into(), branch: None },
                GitClone { path: "git/new".into(), remote: "https://x.org/new".into(), branch: Some("main".into()) },
            ],
            ..Default::default()
        };
        let installed: HashSet<String> = s(&["firefox", "yay-bin"]).into_iter().collect();
        let repos: HashSet<String> = s(&["firefox", "krita"]).into_iter().collect();
        let flat: HashSet<String> = s(&["org.kde.krita"]).into_iter().collect();
        let mut m = missing(&b, &installed, &repos, &flat, &home);
        let mut b = b;
        b.ollama = s(&["llama3.2:3b", "qwen3:8b"]);
        b.docker = s(&["hello-world:latest"]);
        b.torrc = Some("SocksPort 9050\n".into());
        b.firewall = vec![SysFile { path: "zones/home.xml".into(), text: "<zone/>".into() }];
        missing_system(&b, &mut m, &s(&["qwen3:8b"]), None, Some("SocksPort 9050\n"), &[]);
        assert_eq!(m.ollama, s(&["llama3.2:3b"]));
        assert_eq!(m.docker, s(&["hello-world:latest"]), "Docker not answering here: offered");
        assert_eq!(m.torrc, None, "the same torrc is not offered");
        assert_eq!(m.firewall.len(), 1, "a zone this computer lacks");
        assert_eq!(m.pacman, s(&["krita"]));
        assert_eq!(m.not_in_repos, s(&["cachyos-settings"]));
        assert_eq!(m.aur, s(&["brave-bin"]));
        assert_eq!(m.flatpak, s(&["com.spotify.Client"]));
        assert_eq!(m.git.iter().map(|g| g.path.as_str()).collect::<Vec<_>>(), ["git/new"]);
        assert_eq!(m.already_here, 5);
        std::fs::remove_dir_all(home).unwrap();
    }
}
