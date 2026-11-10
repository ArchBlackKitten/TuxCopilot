// What leaves with a package, and what nothing needs any more — computed from pacman's own
// database with pacman's own rules, so the screen says exactly what `pacman -Rns` would do.
//
//   children of X  = what `pacman -Rs X` takes along: X's dependencies (followed through
//                    "Provides") that were installed AS dependencies and that nothing outside
//                    the removal still requires — packages that require each other leave
//                    together, as with pacman.
//   orphans        = what `pacman -Qtd` lists: installed as a dependency, and neither
//                    required nor optionally required by anything installed.

use serde::Serialize;
use std::collections::{BTreeSet, HashMap};

use crate::system::{read_db, Pkg};

fn resolver(db: &HashMap<String, Pkg>) -> impl Fn(&str) -> Option<String> + '_ {
    let mut provided: HashMap<&str, &str> = HashMap::new();
    for (name, p) in db {
        for pr in &p.provides {
            provided.entry(pr.as_str()).or_insert(name.as_str());
        }
    }
    move |dep: &str| {
        if db.contains_key(dep) {
            Some(dep.to_string())
        } else {
            provided.get(dep).map(|s| s.to_string())
        }
    }
}

/// The packages `pacman -Rs <app>` would remove along with it (the app itself excluded).
///
/// Like pacman: start from every dependency reachable from the app that was installed as a
/// dependency, then drop each one that something staying still requires, until nothing more
/// drops. Starting from all of them is what lets two packages that require each other (a
/// library and its plugin: phonon-qt6 and phonon-qt6-vlc) leave together — adding them one
/// by one never could, as each waits for the other.
pub fn children(db: &HashMap<String, Pkg>, app: &str) -> Vec<String> {
    if !db.contains_key(app) {
        return vec![];
    }
    let resolve = resolver(db);
    // every dependency reachable through non-explicit packages
    let mut going: BTreeSet<String> = BTreeSet::new();
    let mut frontier = vec![app.to_string()];
    while let Some(cur) = frontier.pop() {
        for dep in db.get(&cur).map(|p| p.depends.clone()).unwrap_or_default() {
            let Some(d) = resolve(&dep) else { continue };
            if d == app || going.contains(&d) || db[&d].explicit {
                continue;
            }
            going.insert(d.clone());
            frontier.push(d);
        }
    }
    // drop what something that stays still needs, until stable
    loop {
        let keep: Vec<String> = going
            .iter()
            .filter(|g| db[*g].required_by.iter().any(|r| r != app && !going.contains(r)))
            .cloned()
            .collect();
        if keep.is_empty() {
            break;
        }
        for k in keep {
            going.remove(&k);
        }
    }
    going.into_iter().collect()
}

pub fn orphans(db: &HashMap<String, Pkg>) -> Vec<String> {
    let mut o: Vec<String> = db
        .iter()
        .filter(|(_, p)| !p.explicit && p.required_by.is_empty() && p.optional_for.is_empty())
        .map(|(n, _)| n.clone())
        .collect();
    o.sort();
    o
}

#[derive(Serialize)]
pub struct Family {
    package: String,
    children: Vec<String>,
}

/// For each app: what would leave with it.
#[tauri::command]
pub async fn removal_children(apps: Vec<String>) -> Result<Vec<Family>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = read_db();
        apps.into_iter().map(|a| Family { children: children(&db, &a), package: a }).collect()
    })
    .await
    .map_err(|e| e.to_string())
}

/// The orphans, each with what would leave with it.
#[tauri::command]
pub async fn orphan_list() -> Result<Vec<Family>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let db = read_db();
        orphans(&db).into_iter().map(|o| Family { children: children(&db, &o), package: o }).collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::system::parse_qi;
    use std::process::Command;

    fn block(name: &str, depends: &str, required: &str, explicit: bool) -> String {
        format!(
            "Name            : {name}\nProvides        : None\nDepends On      : {depends}\nRequired By     : {required}\nOptional For    : None\nInstall Reason  : {}\n\n",
            if explicit { "Explicitly installed" } else { "Installed as a dependency for another package" }
        )
    }

    #[test]
    fn children_follow_pacman_rs() {
        // obs → libobs (only obs) → libx (also needed by gimp); obs → qt (explicit)
        let db = parse_qi(&[
            block("obs", "libobs  qt", "None", true),
            block("libobs", "libx", "obs", false),
            block("libx", "None", "libobs  gimp", false),
            block("gimp", "libx", "None", true),
            block("qt", "None", "obs", true),
        ]
        .concat());
        assert_eq!(children(&db, "obs"), ["libobs"], "libx stays for gimp, qt was installed on purpose");
        assert_eq!(children(&db, "gimp"), Vec::<String>::new(), "libx is still needed by libobs");
    }

    #[test]
    fn packages_that_require_each_other_leave_together() {
        // for example: okular needs phonon-qt6, which needs a backend that
        // phonon-qt6-vlc provides, which needs phonon-qt6 — pacman -Rs okular takes both
        let qi = "Name : okular\nDepends On : phonon-qt6  djvu\nProvides : None\nRequired By : None\nOptional For : None\nInstall Reason : Explicitly installed\n\n\
                  Name : phonon-qt6\nDepends On : phonon-qt6-backend\nProvides : None\nRequired By : okular  phonon-qt6-vlc\nOptional For : None\nInstall Reason : Installed as a dependency for another package\n\n\
                  Name : phonon-qt6-vlc\nDepends On : phonon-qt6\nProvides : phonon-qt6-backend\nRequired By : phonon-qt6\nOptional For : None\nInstall Reason : Installed as a dependency for another package\n\n\
                  Name : djvu\nDepends On : None\nProvides : None\nRequired By : okular  evince\nOptional For : None\nInstall Reason : Installed as a dependency for another package\n\n\
                  Name : evince\nDepends On : djvu\nProvides : None\nRequired By : None\nOptional For : None\nInstall Reason : Explicitly installed\n";
        let db = parse_qi(qi);
        assert_eq!(children(&db, "okular"), ["phonon-qt6", "phonon-qt6-vlc"], "the cycle leaves; djvu stays for evince");
    }

    #[test]
    fn orphans_match_qtd() {
        let db = parse_qi(&[block("a", "None", "None", false), block("b", "None", "None", true), block("c", "None", "x", false)].concat());
        assert_eq!(orphans(&db), ["a"]);
    }

    /// Against the real machine: our orphans are exactly `pacman -Qtdq`, and every app's
    /// children are exactly what `pacman -Rsp` prints.
    #[test]
    fn agrees_with_pacman_on_this_machine() {
        // pacman busy (an install or removal running): its database is changing under us
        if std::path::Path::new("/var/lib/pacman/db.lck").exists() {
            eprintln!("pacman is busy; skipping the live comparison");
            return;
        }
        let Ok(out) = Command::new("pacman").args(["-Qtdq"]).output() else { return };
        let db = read_db();
        if db.is_empty() {
            return;
        }
        let mut theirs: Vec<String> = String::from_utf8_lossy(&out.stdout).lines().map(str::to_string).collect();
        theirs.sort();
        assert_eq!(orphans(&db), theirs);

        // every explicitly installed package nothing needs, in a fixed order (a random sample
        // of 40 let a real disagreement — dependency cycles — pass most runs)
        let mut explicit: Vec<&String> = db.iter().filter(|(_, p)| p.explicit && p.required_by.is_empty()).map(|(n, _)| n).collect();
        explicit.sort();
        for app in explicit {
            let out = Command::new("pacman").args(["-Rsp", "--print-format", "%n", app]).env("LC_ALL", "C").output().unwrap();
            if !out.status.success() {
                continue; // pacman refuses (e.g. it would break something) — nothing to compare
            }
            let mut want: Vec<String> = String::from_utf8_lossy(&out.stdout).lines().filter(|l| *l != app).map(str::to_string).collect();
            want.sort();
            assert_eq!(children(&db, app), want, "children of {app}");
        }
    }
}
