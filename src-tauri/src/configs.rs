// Your apps' settings, carried in the penguin: the folders in ~/.config and the settings
// files in your home (.zshrc, .gitconfig…), each one ticked by you. Settings → Your penguin.
//
// Taken as they are, except: caches (they rebuild themselves), sockets and lock files, and
// never ~/.ssh or ~/.gnupg — your keys are moved by you, by hand. Configs can hold passwords,
// which is why the penguin is sealed and why each one is your choice.
//
// Put back on the new computer during the import: what is already there under the same name
// is moved aside (<name>.before-penguin-<when>), never overwritten. A penguin may come from
// anyone, so every path in it must stay inside the place it belongs; links are made last, so
// nothing is ever written through one.

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::{Component, Path, PathBuf};

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;
/// Above this a folder starts unticked (browsers' profiles, game launchers…): still yours to tick.
pub const LARGE: u64 = 20 * 1024 * 1024;
/// All of them together, so a penguin stays a file you can carry.
pub const MAX_TOTAL: u64 = 512 * 1024 * 1024;
const NEVER: &[&str] = &[".ssh", ".gnupg", ".pki", ".password-store", ".local", ".cache", ".config", ".var", ".mozilla", ".cargo", ".rustup", ".npm", ".ollama", ".docker"];
const CACHE: &[&str] = &["Cache", "cache", "GPUCache", "Code Cache", "CachedData", "CacheStorage", "ScriptCache", "GrShaderCache", "ShaderCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache", "Crashpad", "logs"];
/// Home files that are records rather than settings: listed, but unticked.
const RECORDS: &[&str] = &["history", "hist", "authority", "auth", "lesshst", "viminfo", "hsts", "sudo_as_admin"];

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Place {
    Config, // ~/.config/<name>
    Home,   // ~/<name>, a settings file
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Hash)]
pub struct Pick {
    pub place: Place,
    pub name: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub place: Place,
    pub name: String,
    pub size: u64,
    pub ticked: bool, // what starts ticked
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Entry {
    pub path: String, // inside the item ("" for the item itself)
    pub mode: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<String>, // base64: a file
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link: Option<String>, // a link's target
    // neither: a folder
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Item {
    pub place: Place,
    pub name: String,
    pub entries: Vec<Entry>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Carried {
    pub place: Place,
    pub name: String,
    pub size: u64,
}

fn base(home: &Path, place: Place) -> PathBuf {
    match place {
        Place::Config => home.join(".config"),
        Place::Home => home.to_path_buf(),
    }
}

/// A name one level inside its place: no separators, no `..`, not a key folder.
pub fn valid_name(place: Place, name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains('/')
        && !name.contains('\0')
        && match place {
            Place::Config => true,
            Place::Home => name.starts_with('.') && !NEVER.contains(&name),
        }
}

fn valid_inner(p: &str) -> bool {
    p.is_empty() || (!p.contains('\0') && Path::new(p).components().all(|c| matches!(c, Component::Normal(_))))
}

fn skipped(name: &str) -> bool {
    CACHE.contains(&name) || name.ends_with(".lock") || name == "SingletonLock" || name == "SingletonSocket" || name == "SingletonCookie"
}

/// Size of a file or folder, caches left out, links not followed.
fn size(p: &Path) -> u64 {
    let Ok(m) = std::fs::symlink_metadata(p) else { return 0 };
    if m.is_file() {
        return m.len();
    }
    if !m.is_dir() {
        return 0;
    }
    std::fs::read_dir(p)
        .map(|rd| rd.flatten().filter(|e| !skipped(&e.file_name().to_string_lossy())).map(|e| size(&e.path())).sum())
        .unwrap_or(0)
}

/// What could go in: every folder or file in ~/.config, and the settings files in your home.
pub fn candidates(home: &Path) -> Vec<Candidate> {
    let mut out = vec![];
    for (place, files_only) in [(Place::Config, false), (Place::Home, true)] {
        let Ok(rd) = std::fs::read_dir(base(home, place)) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if !valid_name(place, &name) || skipped(&name) {
                continue;
            }
            let Ok(m) = std::fs::symlink_metadata(e.path()) else { continue };
            if files_only && !m.is_file() || !(m.is_file() || m.is_dir() || m.file_type().is_symlink()) {
                continue;
            }
            let size = size(&e.path());
            let record = place == Place::Home && RECORDS.iter().any(|r| name.to_lowercase().contains(r));
            out.push(Candidate { place, name, size, ticked: size <= LARGE && !record });
        }
    }
    out.sort_by(|a, b| (a.place == Place::Home, a.name.to_lowercase()).cmp(&(b.place == Place::Home, b.name.to_lowercase())));
    out
}

fn pack_into(root: &Path, rel: &str, entries: &mut Vec<Entry>, total: &mut u64) -> Result<(), String> {
    let p = if rel.is_empty() { root.to_path_buf() } else { root.join(rel) };
    let m = std::fs::symlink_metadata(&p).map_err(|e| format!("{}: {e}", p.display()))?;
    let mode = m.permissions().mode() & 0o777;
    if m.file_type().is_symlink() {
        let to = std::fs::read_link(&p).map_err(|e| e.to_string())?;
        entries.push(Entry { path: rel.into(), mode, data: None, link: Some(to.to_string_lossy().into_owned()) });
    } else if m.is_file() {
        *total += m.len();
        if *total > MAX_TOTAL {
            return Err("the settings you ticked are larger than 512 MB together: untick the largest".into());
        }
        let bytes = std::fs::read(&p).map_err(|e| format!("{}: {e}", p.display()))?;
        entries.push(Entry { path: rel.into(), mode, data: Some(B64.encode(bytes)), link: None });
    } else if m.is_dir() {
        entries.push(Entry { path: rel.into(), mode, data: None, link: None });
        let mut names: Vec<String> = std::fs::read_dir(&p).map_err(|e| e.to_string())?.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        for n in names.into_iter().filter(|n| !skipped(n)) {
            pack_into(root, &if rel.is_empty() { n } else { format!("{rel}/{n}") }, entries, total)?;
        }
    } // sockets, pipes, devices: not settings
    Ok(())
}

/// The ticked items, read whole.
pub fn pack(home: &Path, picks: &[Pick]) -> Result<Vec<Item>, String> {
    let mut total = 0;
    let mut items = vec![];
    for pk in picks {
        if !valid_name(pk.place, &pk.name) {
            return Err(format!("not a settings folder or file: {}", pk.name));
        }
        let root = base(home, pk.place).join(&pk.name);
        let mut entries = vec![];
        pack_into(&root, "", &mut entries, &mut total)?;
        items.push(Item { place: pk.place, name: pk.name.clone(), entries });
    }
    Ok(items)
}

pub fn carried(items: &[Item]) -> Vec<Carried> {
    items
        .iter()
        .map(|i| Carried { place: i.place, name: i.name.clone(), size: i.entries.iter().filter_map(|e| e.data.as_ref()).map(|d| d.len() as u64 * 3 / 4).sum() })
        .collect()
}

/// A link may point inside your home only (where dotfile managers keep their files).
fn link_ok(home: &Path, at: &Path, to: &str) -> bool {
    let t = Path::new(to);
    let full = if t.is_absolute() { t.to_path_buf() } else { at.parent().unwrap_or(home).join(t) };
    let mut out = PathBuf::new();
    for c in full.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    out.starts_with(home) && !NEVER.iter().any(|n| out.starts_with(home.join(n)) && (*n == ".ssh" || *n == ".gnupg"))
}

/// Put the chosen items back. Returns, per item, where what was there before now is (if anything).
pub fn unpack(home: &Path, items: &[Item], chosen: &[Pick], stamp: &str) -> Result<Vec<(String, Option<String>)>, String> {
    let mut report = vec![];
    for item in items.iter().filter(|i| chosen.iter().any(|c| c.place == i.place && c.name == i.name)) {
        if !valid_name(item.place, &item.name) {
            return Err(format!("refused: “{}” is not a settings folder or file", item.name));
        }
        let at = base(home, item.place);
        let target = at.join(&item.name);
        // everything checked before anything is written: a refused item leaves no trace
        for e in &item.entries {
            if !valid_inner(&e.path) {
                return Err(format!("refused: {} holds a path that leaves its folder", item.name));
            }
            if let Some(to) = &e.link {
                if !link_ok(home, &target.join(&e.path), to) {
                    return Err(format!("refused: a link in {} points outside your home ({to})", item.name));
                }
            }
        }
        std::fs::create_dir_all(&at).map_err(|e| e.to_string())?;
        let aside = if std::fs::symlink_metadata(&target).is_ok() {
            let a = at.join(format!("{}.before-fluff-{stamp}", item.name));
            std::fs::rename(&target, &a).map_err(|e| format!("{}: {e}", target.display()))?;
            Some(a.to_string_lossy().into_owned())
        } else {
            None
        };
        // folders and files first; links last, so nothing is written through one
        for e in item.entries.iter().filter(|e| e.link.is_none()) {
            let p = if e.path.is_empty() { target.clone() } else { target.join(&e.path) };
            let mode = e.mode & 0o777;
            match &e.data {
                None => {
                    std::fs::create_dir_all(&p).map_err(|er| er.to_string())?;
                    std::fs::set_permissions(&p, std::fs::Permissions::from_mode(mode | 0o700)).map_err(|er| er.to_string())?;
                }
                Some(d) => {
                    let bytes = B64.decode(d).map_err(|_| format!("{} is damaged", item.name))?;
                    if let Some(parent) = p.parent() {
                        std::fs::create_dir_all(parent).map_err(|er| er.to_string())?;
                    }
                    std::fs::write(&p, bytes).map_err(|er| format!("{}: {er}", p.display()))?;
                    std::fs::set_permissions(&p, std::fs::Permissions::from_mode(mode)).map_err(|er| er.to_string())?;
                }
            }
        }
        for e in item.entries.iter().filter(|e| e.link.is_some()) {
            let p = if e.path.is_empty() { target.clone() } else { target.join(&e.path) };
            let to = e.link.as_deref().unwrap();
            if let Some(parent) = p.parent() {
                std::fs::create_dir_all(parent).map_err(|er| er.to_string())?;
            }
            symlink(to, &p).map_err(|er| format!("{}: {er}", p.display()))?;
        }
        report.push((item.name.clone(), aside));
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home(tag: &str) -> PathBuf {
        let h = std::env::temp_dir().join(format!("tux-configs-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&h);
        std::fs::create_dir_all(h.join(".config")).unwrap();
        h
    }

    fn w(p: &Path, s: &str) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, s).unwrap();
    }

    #[test]
    fn your_settings_move_whole_and_what_was_there_is_kept() {
        let old = home("old");
        w(&old.join(".config/krita/kritarc"), "theme=dark");
        w(&old.join(".config/krita/Cache/blob"), "rebuilds itself");
        std::fs::set_permissions(old.join(".config/krita/kritarc"), std::fs::Permissions::from_mode(0o600)).unwrap();
        w(&old.join(".zshrc"), "alias ll='ls -l'");
        w(&old.join(".zsh_history"), "my private commands");
        w(&old.join(".ssh/id_ed25519"), "KEY");
        symlink("kritarc", old.join(".config/krita/current")).unwrap();

        let c = candidates(&old);
        let names: Vec<_> = c.iter().map(|x| (x.name.as_str(), x.ticked)).collect();
        assert!(names.contains(&("krita", true)) && names.contains(&(".zshrc", true)));
        assert!(names.contains(&(".zsh_history", false)), "a record, not a setting: unticked");
        assert!(!c.iter().any(|x| x.name == ".ssh"), "keys are never offered");

        let picks = vec![Pick { place: Place::Config, name: "krita".into() }, Pick { place: Place::Home, name: ".zshrc".into() }];
        let items = pack(&old, &picks).unwrap();
        assert!(items[0].entries.iter().all(|e| !e.path.starts_with("Cache")), "caches stay");

        let new = home("new");
        w(&new.join(".config/krita/kritarc"), "theirs");
        let report = unpack(&new, &items, &picks, "2026-10-27").unwrap();
        assert_eq!(std::fs::read_to_string(new.join(".config/krita/kritarc")).unwrap(), "theme=dark");
        assert_eq!(std::fs::metadata(new.join(".config/krita/kritarc")).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(std::fs::read_link(new.join(".config/krita/current")).unwrap(), Path::new("kritarc"));
        assert_eq!(std::fs::read_to_string(new.join(".config/krita.before-fluff-2026-10-27/kritarc")).unwrap(), "theirs", "kept, not overwritten");
        assert!(report[0].1.is_some() && report[1].1.is_none());
        assert_eq!(std::fs::read_to_string(new.join(".zshrc")).unwrap(), "alias ll='ls -l'");
        for h in [old, new] {
            std::fs::remove_dir_all(h).unwrap();
        }
    }

    #[test]
    fn a_penguin_cannot_write_outside_its_folder_or_through_a_link() {
        let new = home("evil");
        let pick = |n: &str| vec![Pick { place: Place::Config, name: n.into() }];
        let item = |n: &str, entries: Vec<Entry>| vec![Item { place: Place::Config, name: n.into(), entries }];
        let file = |p: &str| Entry { path: p.into(), mode: 0o644, data: Some(B64.encode("x")), link: None };
        let dir = Entry { path: "".into(), mode: 0o755, data: None, link: None };

        assert!(unpack(&new, &item("app", vec![dir.clone(), file("../../escaped")]), &pick("app"), "s").is_err());
        assert!(unpack(&new, &item("app", vec![dir.clone(), file("/etc/x")]), &pick("app"), "s").is_err());
        assert!(unpack(&new, &item("..", vec![dir.clone()]), &pick(".."), "s").is_err());
        assert!(!new.parent().unwrap().join("escaped").exists());
        // a link to /etc, then a file "through" it: links come last, so the file lands in a real folder
        let through = vec![dir.clone(), Entry { path: "a".into(), mode: 0o777, data: None, link: Some("/etc".into()) }, file("a/x")];
        assert!(unpack(&new, &item("app2", through), &pick("app2"), "s").unwrap_err().contains("outside your home"));
        assert!(!Path::new("/etc/x").exists());
        assert!(!new.join(".config/app2").exists(), "refused before anything was written");
        let to_keys = vec![dir, Entry { path: "k".into(), mode: 0o777, data: None, link: Some(new.join(".ssh/id_ed25519").to_string_lossy().into()) }];
        assert!(unpack(&new, &item("app3", to_keys), &pick("app3"), "s").is_err(), "no link into your keys");
        assert!(!valid_name(Place::Home, ".ssh") && !valid_name(Place::Home, ".gnupg") && !valid_name(Place::Home, "notdot"));
        std::fs::remove_dir_all(new).unwrap();
    }
}
