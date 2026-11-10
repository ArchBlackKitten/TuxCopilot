// The kernel's own protections: the sysctl values
// the presets set, read from /proc/sys as you (one, bpf_jit_harden, only root may read: None).

use std::collections::BTreeMap;

/// The settings the presets know (hardening.ts SETTINGS — a test keeps them the same).
pub const KEYS: &[&str] = &[
    "kernel.kptr_restrict",
    "kernel.dmesg_restrict",
    "kernel.yama.ptrace_scope",
    "kernel.unprivileged_bpf_disabled",
    "net.core.bpf_jit_harden",
    "fs.protected_fifos",
    "fs.protected_regular",
    "dev.tty.ldisc_autoload",
    "net.ipv4.conf.all.accept_redirects",
    "net.ipv4.conf.default.accept_redirects",
    "net.ipv6.conf.all.accept_redirects",
    "net.ipv6.conf.default.accept_redirects",
    "net.ipv4.conf.all.send_redirects",
    "net.ipv4.conf.default.send_redirects",
    "kernel.kexec_load_disabled",
    "kernel.sysrq",
];

pub fn proc_path(key: &str) -> Option<String> {
    (key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_') && !key.contains("..")).then(|| format!("/proc/sys/{}", key.replace('.', "/")))
}

pub const FILE: &str = "/etc/sysctl.d/99-tuxcopilot-hardening.conf";

#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KernelSettings {
    pub values: BTreeMap<String, Option<String>>,
    pub file_there: bool, // TuxCopilot's preset file
}

#[tauri::command]
pub async fn kernel_settings() -> KernelSettings {
    tauri::async_runtime::spawn_blocking(|| KernelSettings {
        values: KEYS.iter().map(|k| (k.to_string(), proc_path(k).and_then(|p| std::fs::read_to_string(p).ok()).map(|v| v.trim().to_string()))).collect(),
        file_there: std::path::Path::new(FILE).exists(),
    })
    .await
    .unwrap_or(KernelSettings { values: BTreeMap::new(), file_there: false })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_setting_is_read_from_its_own_file_only() {
        assert_eq!(proc_path("kernel.yama.ptrace_scope"), Some("/proc/sys/kernel/yama/ptrace_scope".into()));
        assert_eq!(proc_path("kernel/../../etc/shadow"), None);
        assert_eq!(proc_path("a..b"), None);
        let v = tauri::async_runtime::block_on(kernel_settings()).values;
        assert_eq!(v.len(), KEYS.len());
        assert!(v["kernel.sysrq"].is_some(), "readable as anyone");
    }
}
