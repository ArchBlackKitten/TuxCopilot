// Docker apps: the compose folders under ~/docker, and the logs of an app or a container.
// Read-only. Starting, stopping, updating and removing go through the run manager, with the
// "Are you sure?" prompts, like every other change to the machine.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// The file names `docker compose` itself looks for, in its own order of preference.
pub const COMPOSE_NAMES: &[&str] = &["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeDir {
    name: String,
    dir: String,
    file: String,
}

fn docker_home() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(|h| PathBuf::from(h).join("docker"))
}

/// One entry per folder in `root` that holds a compose file, sorted by name.
pub fn scan(root: &Path) -> Vec<ComposeDir> {
    let Ok(entries) = std::fs::read_dir(root) else { return vec![] };
    let mut out: Vec<ComposeDir> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let dir = e.path();
            let file = COMPOSE_NAMES.iter().map(|n| dir.join(n)).find(|f| f.is_file())?;
            Some(ComposeDir {
                name: e.file_name().to_string_lossy().into_owned(),
                dir: dir.to_string_lossy().into_owned(),
                file: file.to_string_lossy().into_owned(),
            })
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[tauri::command]
pub fn docker_apps() -> Vec<ComposeDir> {
    docker_home().map(|r| scan(&r)).unwrap_or_default()
}

/// A compose file the logs may be read for: an absolute path to an existing file with one of
/// compose's own names. A container: docker's own name rule.
pub fn logs_argv(target: &str) -> Option<Vec<String>> {
    let p = Path::new(target);
    if p.is_absolute() {
        let name = p.file_name()?.to_str()?;
        if !COMPOSE_NAMES.contains(&name) || !p.is_file() || target.contains("..") {
            return None;
        }
        return Some(
            ["docker", "compose", "-f", target, "logs", "--tail", "200", "--no-color", "--timestamps"]
                .map(String::from)
                .to_vec(),
        );
    }
    let ok = !target.is_empty()
        && target.len() <= 128
        && target.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && target.chars().all(|c| c.is_ascii_alphanumeric() || "_.-".contains(c));
    ok.then(|| ["docker", "logs", "--tail", "200", "--timestamps", target].map(String::from).to_vec())
}

/// The last 200 lines; docker writes an app's own output to stdout AND stderr, so both.
#[tauri::command]
pub async fn docker_logs(target: String) -> Result<String, String> {
    let argv = logs_argv(&target).ok_or_else(|| format!("not a compose file or container name: {target}"))?;
    let r = tauri::async_runtime::spawn_blocking(move || crate::probe::exec(&argv, Duration::from_secs(20)))
        .await
        .map_err(|e| e.to_string())?
        .ok_or("docker did not answer (is it installed and running?)")?;
    Ok(r.joined())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_compose_folders_only() {
        let root = std::env::temp_dir().join(format!("am-docker-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("firefly-iii")).unwrap();
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::create_dir_all(root.join("old")).unwrap();
        std::fs::write(root.join("firefly-iii/compose.yml"), "services: {}").unwrap();
        std::fs::write(root.join("old/docker-compose.yml"), "services: {}").unwrap();
        std::fs::write(root.join("notes/readme.txt"), "").unwrap();
        let found: Vec<_> = scan(&root).into_iter().map(|c| (c.name, c.file.ends_with("compose.yml"))).collect();
        assert_eq!(found, vec![("firefly-iii".into(), true), ("old".into(), true)]);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn logs_only_for_real_compose_files_and_plain_names() {
        let root = std::env::temp_dir().join(format!("am-docker-logs-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let f = root.join("compose.yml");
        std::fs::write(&f, "").unwrap();
        assert!(logs_argv(f.to_str().unwrap()).is_some());
        assert!(logs_argv("/etc/passwd").is_none());
        assert!(logs_argv(root.join("missing/compose.yml").to_str().unwrap()).is_none());
        assert_eq!(logs_argv("firefly_iii_core").unwrap().last().unwrap(), "firefly_iii_core");
        for bad in ["", "-f", "--help", "a b", "a;rm", "../x", &"x".repeat(129)] {
            assert!(logs_argv(bad).is_none(), "{bad}");
        }
        std::fs::remove_dir_all(&root).unwrap();
    }
}
