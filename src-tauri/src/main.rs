#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // the weekly checkup's timer (weekly.rs): it only reads, sends a notification, and ends —
    // no window, no database, so the lock is never touched
    if std::env::args().nth(1).as_deref() == Some("--weekly-checkup") {
        tuxcopilot_lib::weekly::run_weekly_checkup();
        return;
    }
    // WebKitGTK's DMABUF/EGL rendering path crashes on teardown with many Mesa/driver
    // combinations (SIGABRT in libgallium on exit).
    // Set before the webview initialises.
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
    tuxcopilot_lib::run()
}
