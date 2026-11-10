pub mod appinfo;
pub mod belongings;
pub mod brain;
pub mod checkup;
pub mod firewall;
pub mod security;
pub mod updates;
pub mod cmdhelp;
pub mod configs;
pub mod db;
pub mod deps;
pub mod desktop;
pub mod disk;
pub mod docker;
pub mod feedback;
pub mod gate;
pub mod gitrepos;
pub mod integrity;
pub mod kb;
pub mod lock;
pub mod look;
pub mod net;
pub mod nodes;
pub mod original;
pub mod penguin;
pub mod probe;
pub mod runner;
pub mod services;
pub mod system;
pub mod terminal;
pub mod usage;
pub mod window;
pub mod wreck;
pub mod inputctl;
pub mod snapshot;
pub mod weekly;
pub mod devices;
pub mod usbguard;
pub mod filecheck;
pub mod logins;
pub mod screenlock;
pub mod firmware;
pub mod conns;
pub mod kernel;
pub mod marks;
pub mod boot;
pub mod report;

use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::Manager;

/// The app's earlier names, newest first: AppManager, then ArchManager. Their data folder, database and Off records (what On puts back) move to the
/// current name once, before anything opens them. Nothing is overwritten — a file already
/// there under the current name wins — and an old database still moves into a current folder
/// that has none yet (a build that started under the new name before this move existed).
pub const OLD_NAMES: &[&str] = &["archmanager", "appmanager"];
pub const NAME: &str = "tuxcopilot";

pub fn move_old_data(home: &Path) {
    let mv = |from: &Path, to: &Path| {
        if from.exists() && !to.exists() {
            if let Some(dir) = to.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = std::fs::rename(from, to);
        }
    };
    let share = home.join(".local/share");
    let data = share.join(format!("{NAME}.desk"));
    for old in OLD_NAMES {
        mv(&share.join(format!("{old}.desk")), &data);
    }
    for old in OLD_NAMES {
        for end in ["", "-wal", "-shm"] {
            let to = data.join(format!("{NAME}.db{end}"));
            mv(&data.join(format!("{old}.db{end}")), &to);
            mv(&share.join(format!("{old}.desk/{old}.db{end}")), &to);
        }
    }
    let new = home.join(".local/state").join(NAME);
    for old in OLD_NAMES {
        let old = home.join(".local/state").join(old);
        mv(&old, &new);
        if let Ok(rd) = std::fs::read_dir(old.join("off")) {
            for e in rd.filter_map(|e| e.ok()) {
                mv(&e.path(), &new.join("off").join(e.file_name()));
            }
        }
    }
}

/// TuxCopilot's own folders are yours alone: 700, and what is in them 600 / 700. (Not a
/// umask: that would also make private the files your own commands create.)
pub fn keep_private(home: &Path) {
    use std::os::unix::fs::PermissionsExt;
    fn walk(p: &Path, depth: usize) {
        let Ok(meta) = std::fs::symlink_metadata(p) else { return };
        if meta.file_type().is_symlink() {
            return; // never follow a link out of our folders
        }
        let mode = if meta.is_dir() { 0o700 } else { 0o600 };
        if meta.permissions().mode() & 0o777 != mode {
            let _ = std::fs::set_permissions(p, std::fs::Permissions::from_mode(mode));
        }
        if meta.is_dir() && depth < 6 {
            if let Ok(rd) = std::fs::read_dir(p) {
                for e in rd.filter_map(|e| e.ok()) {
                    walk(&e.path(), depth + 1);
                }
            }
        }
    }
    walk(&home.join(".local/share").join(format!("{NAME}.desk")), 0);
    walk(&home.join(".local/state").join(NAME), 0);
}

pub fn run() {
    if let Some(home) = std::env::var_os("HOME") {
        move_old_data(Path::new(&home));
        keep_private(Path::new(&home));
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // ~/.local/share/tuxcopilot.desk/tuxcopilot.db, sealed by the lock (gate.rs): until it
            // is opened with the code and the password code, TuxCopilot holds an empty database in
            // memory, and nothing of yours can be read.
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db: db::Db = Arc::new(Mutex::new(db::open_memory_placeholder()));
            app.manage(gate::Gate::new(&dir, db.clone()));

            // the size it opens at (Settings → Window); "last" remembers it at closing
            let window_file = dir.join("window.json");
            if let Some(w) = app.get_webview_window("main") {
                let (width, height) = window::opening_size(&window::read(&window_file));
                let _ = w.set_size(tauri::LogicalSize::new(width, height));
                let _ = w.center();
                let (w2, file) = (w.clone(), window_file.clone());
                w.on_window_event(move |e| {
                    if let tauri::WindowEvent::CloseRequested { .. } = e {
                        let mut p = window::read(&file);
                        if let (Ok(size), Ok(scale)) = (w2.inner_size(), w2.scale_factor()) {
                            let logical = size.to_logical::<f64>(scale);
                            p.last = Some((logical.width.round() as u32, logical.height.round() as u32));
                            let _ = window::write(&file, &p);
                        }
                    }
                });
            }
            app.manage(window::WindowFile(window_file));

            app.manage(runner::Runner::new(db.clone()));
            app.manage(usage::Tracker::boot(db.clone()));
            app.manage(net::client());
            app.manage(system::ProfileCache(Mutex::new(None)));
            app.manage(penguin::Picked::new(&dir));
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            nodes::tree_get,
            nodes::node_create,
            nodes::node_update,
            nodes::node_delete,
            nodes::node_move,
            nodes::nodes_import,
            runner::run_start,
            runner::run_snapshot,
            runner::run_stop,
            runner::runs_list,
            runner::run_get,
            kb::kb_list,
            kb::kb_upsert,
            kb::setting_get,
            kb::setting_set,
            usage::tracker_status,
            usage::tracker_set_running,
            usage::tracker_set_interval,
            usage::usage_rows,
            usage::usage_seed,
            usage::usage_clear_simulated,
            desktop::desktop_apps,
            desktop::desktop_refresh,
            system::system_profile,
            deps::removal_children,
            deps::orphan_list,
            appinfo::pkg_details,
            appinfo::flatpak_details,
            appinfo::unit_log,
            appinfo::unit_family,
            appinfo::port_records,
            disk::disk_report,
            terminal::terminals,
            terminal::browse_in_terminal,
            terminal::terminal_browser,
            gitrepos::git_repos,
            gitrepos::pick_folder,
            docker::docker_apps,
            docker::docker_logs,
            system::os_choice_set,
            probe::probe_exec,
            probe::probe_read,
            probe::probe_readdir,
            net::http_get,
            net::open_external,
            integrity::save_file,
            integrity::gpg_keys,
            look::open_file,
            look::color_schemes,
            look::window_icon,
            look::menu_icon,
            services::services_list,
            window::window_pref_get,
            window::window_pref_set,
            cmdhelp::command_help,
            checkup::checkup,
            checkup::waiting_diff,
            checkup::waiting_merge,
            snapshot::snapshot_ready,
            snapshot::fluff_snapshots,
            weekly::weekly_state,
            marks::security_marks_save,
            boot::boot_facts,
            report::report_names,
            devices::storage_control,
            devices::my_groups,
            usbguard::usbguard_state,
            filecheck::package_files_check,
            filecheck::untracked_fingerprints,
            logins::login_failures,
            screenlock::screen_lock,
            firmware::firmware_state,
            conns::connections,
            kernel::kernel_settings,
            updates::updates_facts,
            security::security_check,
            firewall::firewall_state,
            firewall::dns_state,
            penguin::apps_here,
            inputctl::input_control,
            original::original_check,
            original::own_processes,
            feedback::feedback_context,
            brain::ask_fluff,
            brain::ask_api,
            brain::clipboard_text,
            gate::lock_status,
            gate::lock_tie,
            gate::lock_setup_begin,
            gate::lock_setup_code,
            gate::lock_recovery_text,
            gate::lock_setup_finish,
            gate::lock_open,
            gate::lock_pause,
            gate::lock_resume,
            gate::lock_set_pause,
            gate::lock_change_password,
            gate::lock_new_phone_begin,
            gate::lock_new_phone_finish,
            gate::lock_recover_begin,
            gate::lock_now,
            penguin::penguin_words,
            penguin::penguin_export,
            penguin::penguin_pick,
            penguin::penguin_peek,
            penguin::penguin_restore,
            penguin::penguin_preview,
            penguin::penguin_missing,
            penguin::penguin_forget_belongings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TuxCopilot");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_old_names_data_moves_once_and_nothing_is_overwritten() {
        let home = std::env::temp_dir().join(format!("am-rename-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let w = |p: &str, s: &str| {
            let p = home.join(p);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, s).unwrap();
        };
        let r = |p: &str| std::fs::read_to_string(home.join(p)).ok();
        w(".local/share/appmanager.desk/appmanager.db", "log");
        w(".local/share/appmanager.desk/appmanager.db-wal", "wal");
        w(".local/share/appmanager.desk/localstorage/x", "ls");
        w(".local/state/appmanager/off/port-cups.service", "cups");
        move_old_data(&home);
        assert_eq!(r(".local/share/tuxcopilot.desk/tuxcopilot.db").as_deref(), Some("log"));
        assert_eq!(r(".local/share/tuxcopilot.desk/tuxcopilot.db-wal").as_deref(), Some("wal"), "the WAL travels with its database");
        assert_eq!(r(".local/share/tuxcopilot.desk/localstorage/x").as_deref(), Some("ls"));
        assert_eq!(r(".local/state/tuxcopilot/off/port-cups.service").as_deref(), Some("cups"));
        assert!(!home.join(".local/share/appmanager.desk").exists());

        // an old build ran again afterwards: its new Off record joins, the newer data stays
        w(".local/share/appmanager.desk/appmanager.db", "old");
        w(".local/state/appmanager/off/port-tor.service", "tor");
        w(".local/state/appmanager/off/port-cups.service", "stale");
        move_old_data(&home);
        assert_eq!(r(".local/share/tuxcopilot.desk/tuxcopilot.db").as_deref(), Some("log"));
        assert_eq!(r(".local/state/tuxcopilot/off/port-tor.service").as_deref(), Some("tor"));
        assert_eq!(r(".local/state/tuxcopilot/off/port-cups.service").as_deref(), Some("cups"));
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn archmanagers_data_moves_too_even_into_a_folder_made_too_early() {
        let home = std::env::temp_dir().join(format!("am-rename2-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let w = |p: &str, s: &str| {
            let p = home.join(p);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, s).unwrap();
        };
        let r = |p: &str| std::fs::read_to_string(home.join(p)).ok();
        w(".local/share/archmanager.desk/archmanager.db", "log");
        w(".local/share/archmanager.desk/archmanager.db-wal", "wal");
        w(".local/share/tuxcopilot.desk/localstorage/x", "made by a build before the move existed");
        w(".local/state/archmanager/off/port-cups.service", "cups");
        move_old_data(&home);
        assert_eq!(r(".local/share/tuxcopilot.desk/tuxcopilot.db").as_deref(), Some("log"), "the database still finds its way in");
        assert_eq!(r(".local/share/tuxcopilot.desk/tuxcopilot.db-wal").as_deref(), Some("wal"));
        assert_eq!(r(".local/state/tuxcopilot/off/port-cups.service").as_deref(), Some("cups"));
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn its_folders_are_yours_alone_and_links_are_not_followed() {
        use std::os::unix::fs::PermissionsExt;
        let home = std::env::temp_dir().join(format!("am-private-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let data = home.join(".local/share/tuxcopilot.desk");
        std::fs::create_dir_all(data.join("localstorage")).unwrap();
        std::fs::write(data.join("tuxcopilot.db"), "x").unwrap();
        std::fs::create_dir_all(home.join(".local/state/tuxcopilot/off")).unwrap();
        let outside = home.join("elsewhere.txt");
        std::fs::write(&outside, "not ours").unwrap();
        std::fs::set_permissions(&outside, std::fs::Permissions::from_mode(0o644)).unwrap();
        std::os::unix::fs::symlink(&outside, data.join("link")).unwrap();
        keep_private(&home);
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&data), 0o700);
        assert_eq!(mode(&data.join("tuxcopilot.db")), 0o600);
        assert_eq!(mode(&data.join("localstorage")), 0o700);
        assert_eq!(mode(&home.join(".local/state/tuxcopilot/off")), 0o700);
        assert_eq!(mode(&outside), 0o644, "a link leads nowhere");
        std::fs::remove_dir_all(&home).unwrap();
    }
}
