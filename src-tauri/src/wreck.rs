// Commands that would wreck the system (or everything of yours) are never run by Fluff: a window
// says what it does and why not; to run it anyway, you copy it and run it yourself — Fluff won't.
//
// Checked in the runner (run_start), so no way of starting a run gets past it: Apply, Play, a
// quick run, or a command edited in "Are you sure?". It looks at each simple command (split at
// ; && || | &), as the shell would, with sudo & co. in front ignored.

use regex::Regex;
use serde::Serialize;
use std::sync::OnceLock;

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Wreck {
    pub part: String, // the piece of the command that would do it
    pub what: String, // what it does, in plain words
    pub why: String,  // why you must not run it
}

/// Folders whose removal (or recursive change) ruins the system or everything of yours.
const VITAL: &[&str] = &[
    "/", "/*", "~", "~/", "~/*", "$HOME", "$HOME/", "$HOME/*", "${HOME}", "/home", "/home/*", "/etc", "/usr", "/bin", "/sbin", "/lib", "/lib64", "/boot",
    "/var", "/var/lib", "/var/lib/pacman", "/root", "/dev", "/proc", "/sys", "/efi", "/boot/efi",
];

/// Packages the system can't start, log in or update without.
const ESSENTIAL: &[&str] = &[
    "glibc", "systemd", "systemd-libs", "pacman", "base", "bash", "sudo", "coreutils", "filesystem", "util-linux", "gcc-libs", "pam", "shadow", "linux-api-headers",
];

const DISK: &str = r"/dev/(sd[a-z]+\d*|nvme\d+n\d+(p\d+)?|mmcblk\d+(p\d+)?|vd[a-z]+\d*|hd[a-z]+\d*|disk/\S+|mapper/\S+)";

fn unquote(w: &str) -> String {
    w.trim_matches(|c| c == '\'' || c == '"').to_string()
}

fn vital(target: &str) -> bool {
    let t = unquote(target);
    let t = t.trim_end_matches('/');
    VITAL.iter().any(|v| v.trim_end_matches('/') == t || (t.is_empty() && *v == "/"))
}

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("a valid pattern"))
}

/// The simple commands in a line, as the shell splits it (quotes kept together).
fn simple_commands(cmd: &str) -> Vec<String> {
    let (mut out, mut buf, mut quote) = (vec![], String::new(), None::<char>);
    let mut chars = cmd.chars().peekable();
    while let Some(c) = chars.next() {
        match (quote, c) {
            (Some(q), _) if c == q => {
                quote = None;
                buf.push(c);
            }
            (Some(_), _) => buf.push(c),
            (None, '\'' | '"') => {
                quote = Some(c);
                buf.push(c);
            }
            (None, ';' | '|' | '&' | '\n') => {
                if !buf.trim().is_empty() {
                    out.push(buf.trim().to_string());
                }
                buf.clear();
            }
            (None, _) => buf.push(c),
        }
    }
    if !buf.trim().is_empty() {
        out.push(buf.trim().to_string());
    }
    out
}

/// The first reason Fluff won't run this command, or None.
pub fn wrecks(cmd: &str) -> Option<Wreck> {
    let w = |part: &str, what: &str, why: &str| Some(Wreck { part: part.to_string(), what: what.into(), why: why.into() });

    // the fork bomb: a function that calls itself twice, in the background, forever
    static BOMB: OnceLock<Regex> = OnceLock::new();
    if let Some(c) = re(&BOMB, r"([A-Za-z_:][\w:]*)\s*\(\s*\)\s*\{\s*([A-Za-z_:][\w:]*)\s*\|\s*([A-Za-z_:][\w:]*)\s*&").captures(cmd) {
        if c[1] == c[2] && c[2] == c[3] {
            return w(&c[0], "a fork bomb: it copies itself again and again until the computer can do nothing else", "the computer freezes; only holding the power button gets it back, and anything unsaved is lost");
        }
    }
    static SYSRQ: OnceLock<Regex> = OnceLock::new();
    if let Some(m) = re(&SYSRQ, r">\s*/proc/sysrq-trigger").find(cmd) {
        return w(m.as_str(), "tells the kernel to crash, reboot or kill everything at once (sysrq)", "it happens instantly, with no saving: open files and unfinished updates are lost");
    }
    static RAW: OnceLock<Regex> = OnceLock::new();
    if let Some(m) = re(&RAW, &format!(r"[^>]>\s*{DISK}|^>\s*{DISK}")).find(cmd) {
        return w(m.as_str(), "writes straight onto a disk, over its partitions and files", "everything on that disk is destroyed — your system too, if it is that disk");
    }
    static CRIT: OnceLock<Regex> = OnceLock::new();
    if let Some(m) = re(&CRIT, r"(^|[^>])>\s*/etc/(passwd|shadow|group|gshadow|sudoers|fstab)\b").find(cmd) {
        return w(m.as_str().trim_start_matches(|c| c != '>'), "empties one of the files the system needs to start or log you in", "you may not be able to log in, use sudo, or start the computer again");
    }

    for part in simple_commands(cmd) {
        let words: Vec<String> = part.split_whitespace().map(unquote).collect();
        let words: Vec<&str> = words.iter().map(String::as_str).skip_while(|w| matches!(*w, "sudo" | "doas" | "env" | "nice" | "time" | "command" | "exec" | "{" | "(" | "!")).collect();
        let Some(prog) = words.first().map(|p| p.rsplit('/').next().unwrap_or(p)) else { continue };
        let args = &words[1..];
        let flags: Vec<&str> = args.iter().copied().filter(|a| a.starts_with('-')).collect();
        let targets: Vec<&str> = args.iter().copied().filter(|a| !a.starts_with('-')).collect();
        let short = |c: char| flags.iter().any(|f| !f.starts_with("--") && f.contains(c));
        let long = |l: &str| flags.iter().any(|f| *f == l);
        match prog {
            "rm" if (short('r') || short('R') || long("--recursive")) && (long("--no-preserve-root") || targets.iter().any(|t| vital(t))) => {
                let t = targets.iter().find(|t| vital(t)).copied().unwrap_or("/");
                return w(&part, &format!("deletes {} and everything in it, without asking", if t.starts_with('~') || t.contains("HOME") { "your whole home folder".to_string() } else { format!("{t} (part of the system itself)") }), "it can't be undone: the system (or all your files) is gone, and Arch must be installed again");
            }
            "chmod" | "chown" | "chgrp" if (short('R') || long("--recursive")) && targets.iter().skip(1).any(|t| vital(t)) => {
                return w(&part, "changes who owns or may use every file under a system folder (or your home)", "programs and sudo refuse to work with the wrong owners or permissions; putting them back by hand is nearly impossible");
            }
            "mv" if targets.len() >= 2 && targets[..targets.len() - 1].iter().any(|t| vital(t)) => {
                return w(&part, "moves a folder the system (or your home) can't live without", "the system stops working mid-command: programs, libraries or your files are no longer where they must be");
            }
            "dd" if args.iter().any(|a| re(&DD, &format!("^of={DISK}")).is_match(a)) => {
                return w(&part, "writes straight onto a disk (dd), over its partitions and files", "everything on that disk is destroyed; one wrong letter in the disk's name and it is your system's disk");
            }
            p if (p.starts_with("mkfs") || p == "blkdiscard" || p == "shred") && targets.iter().any(|t| re(&DEV, &format!("^{DISK}$")).is_match(t)) => {
                return w(&part, "erases a whole disk or partition (formats, wipes or shreds it)", "everything on it is gone for good; make sure it is the right one, and run it yourself");
            }
            "wipefs" if (short('a') || long("--all")) && targets.iter().any(|t| t.starts_with("/dev/")) => {
                return w(&part, "erases the signatures that make a disk's partitions and files readable", "the disk looks empty afterwards; what was on it is as good as gone");
            }
            "sgdisk" if flags.iter().any(|f| matches!(*f, "-Z" | "--zap-all" | "-o" | "--clear")) => {
                return w(&part, "erases a disk's whole partition table", "every partition on that disk disappears — your system's too, if it is that disk");
            }
            // -1: every process you may signal; 1: the system's first program
            "kill" if targets.contains(&"1") || args.contains(&"-1") => {
                return w(&part, "stops every program at once (or the system's first program, which holds everything up)", "you are logged out on the spot, or the system halts; nothing unsaved survives");
            }
            "pacman" | "yay" | "paru" if flags.iter().any(|f| f.starts_with("-R") || *f == "--remove") && targets.iter().any(|t| ESSENTIAL.contains(t)) => {
                let t = targets.iter().find(|t| ESSENTIAL.contains(t)).unwrap();
                return w(&part, &format!("removes {t}, a package the system can't run without"), "the system may not start, log you in, or even run pacman again to repair itself");
            }
            _ => {}
        }
    }
    None
}

static DD: OnceLock<Regex> = OnceLock::new();
static DEV: OnceLock<Regex> = OnceLock::new();

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_fluff_never_runs() {
        for c in [
            "sudo rm -rf /",
            "sudo rm -rf / --no-preserve-root",
            "rm -rf --no-preserve-root /",
            "sudo rm -rf /*",
            "rm -rf ~",
            "rm -rf ~/",
            "rm -fr $HOME",
            "rm -r -f \"$HOME\"",
            "sudo rm -Rf /usr",
            "sudo rm -rf /boot",
            "echo cleaning && sudo rm -rf /etc",
            ":(){ :|:& };:",
            "bomb(){ bomb|bomb& };bomb",
            "sudo dd if=/dev/zero of=/dev/sda bs=1M",
            "sudo dd if=x.iso of=/dev/nvme0n1 status=progress",
            "cat /dev/urandom > /dev/sda",
            "sudo mkfs.ext4 /dev/sdb1",
            "sudo mkfs -t btrfs /dev/nvme0n1p2",
            "sudo wipefs -a /dev/sda",
            "sudo shred -n 1 /dev/sdb",
            "sudo sgdisk --zap-all /dev/nvme0n1",
            "sudo chmod -R 777 /",
            "sudo chown -R me:me /usr",
            "chmod -R 000 ~",
            "sudo mv /usr /tmp/old",
            "mv ~ /dev/null",
            "echo c | sudo tee /proc/sysrq-trigger; echo c > /proc/sysrq-trigger",
            "kill -9 -1",
            "sudo kill -9 1",
            "sudo pacman -Rdd glibc",
            "sudo pacman -Rns systemd",
            "yay -R pacman",
            "echo > /etc/fstab",
            "sudo sh -c ': > /etc/passwd'",
        ] {
            assert!(wrecks(c).is_some(), "{c}");
        }
    }

    #[test]
    fn what_is_fine_to_run() {
        for c in [
            "rm -rf ~/.cache/yay/vlc",
            "rm -rf '/home/penguin/clones/old'",
            "rm -rf ./build",
            "rm ~/notes.txt",
            "rm -rf /tmp/x",
            "sudo rm -rf /var/cache/pacman/pkg/download-*",
            "sudo pacman -Syu --needed vlc",
            "sudo pacman -Rns vlc",
            "sudo pacman -Rns $(pacman -Qtdq)",
            "dd if=/dev/zero of=./test.img bs=1M count=10",
            "lsblk -f && sudo fdisk -l",
            "wipefs /dev/sda",
            "chmod -R 755 ~/public",
            "chmod 600 ~/.ssh/id_ed25519",
            "mv ~/a.txt ~/b.txt",
            "kill -9 4242",
            "echo hi >> /etc/hosts.tuxcopilot-test",
            "cat /etc/fstab",
            "grep root /etc/passwd",
            "echo 'rm -rf /'",
            "echo \"done; rm -rf ~ is what Fluff refuses\"",
            "echo 'UUID=x /data ext4 defaults 0 2' >> /etc/fstab",
            "echo 'UUID=x /data ext4 defaults 0 2' | sudo tee -a /etc/fstab",
            "systemctl --user restart pipewire",
        ] {
            assert_eq!(wrecks(c), None, "{c}");
        }
    }

    #[test]
    fn it_says_what_and_why() {
        let r = wrecks("sudo rm -rf ~").unwrap();
        assert!(r.what.contains("your whole home folder"));
        assert!(r.why.contains("can't be undone"));
        assert_eq!(r.part, "sudo rm -rf ~");
        assert!(wrecks("sudo pacman -Rns systemd").unwrap().what.contains("removes systemd"));
    }

    /// Fluff's own commands (the snapshot pair with its guard, the .pacnew merge, the deny-all)
    /// are not wrecks: they write their own files and remove only their own temporary folder.
    #[test]
    fn fluffs_own_new_commands_are_not_wrecks() {
        for c in [
            r##"mkdir -p "$HOME/.local/state/tuxcopilot" && rm -f "$HOME/.local/state/tuxcopilot/snapper-failed" && sudo snapper -c root create --type pre --cleanup-algorithm number --print-number --description 'TuxCopilot: Firewall: public' > "$HOME/.local/state/tuxcopilot/snapper-pre""##,
            r##"grep -qx '[0-9][0-9]*' "$HOME/.local/state/tuxcopilot/snapper-pre" 2>/dev/null || { echo "Fluff: the snapshot before this change wasn't taken, so nothing was changed." >&2; exit 1; }; ( sudo systemctl disable --now bluetooth.service ) || { r=$?; echo "$r" >> "$HOME/.local/state/tuxcopilot/snapper-failed"; exit "$r"; }"##,
            r##"n=$(cat "$HOME/.local/state/tuxcopilot/snapper-pre") && case "$n" in ''|*[!0-9]*) echo "Fluff: no snapshot before was written down, so there is nothing to pair." >&2; false;; esac && m=$(sudo snapper -c root create --type post --pre-number "$n" --cleanup-algorithm number --print-number --description 'TuxCopilot: Firewall: public') && rm -f "$HOME/.local/state/tuxcopilot/snapper-pre" && l='TuxCopilot: Firewall: public' && { [ ! -e "$HOME/.local/state/tuxcopilot/snapper-failed" ] || l="$l (not finished)"; } && printf '%s\t%s\t%s\t%s\n' "$n" "$m" "$(date +%Y-%m-%dT%H:%M:%S)" "$l" >> "$HOME/.local/state/tuxcopilot/snapshots.tsv" && { [ ! -e "$HOME/.local/state/tuxcopilot/snapper-failed" ] || { rm -f "$HOME/.local/state/tuxcopilot/snapper-failed"; echo "Fluff: this change did NOT finish — a step failed (said above). Snapshots $n and $m hold what it did change, so it can be undone."; }; } && echo "Fluff: snapshots $n and $m hold what this run changed in the system's files (and anything else that changed one at the same moment). To see the files: sudo snapper -c root status $n..$m. To undo it: History, beside this run, Undo this change — it lists the files first.""##,
            r##"sudo sh -c 'set -eu; l=$(snapper -c root --csvout --no-headers list --columns number,pre-number,post-number,description); printf "%s\n" "$l" | grep -Eq "^$1,,[0-9]*,\"?TuxCopilot:" && printf "%s\n" "$l" | grep -Eq "^$2,$1,[0-9]*,\"?TuxCopilot:" || { echo "Fluff: snapshots $1 and $2 are not a TuxCopilot pair (snapper may have cleaned them up), so nothing was done." >&2; exit 1; }; c=$(snapper -c root status "$1..$2"); snapper -c root undochange "$1..$2"; bad=; case "$c" in *" /etc/firewalld/"*) { ! systemctl is-active -q firewalld || firewall-cmd --reload >/dev/null; } || bad="$bad, the firewall";; esac; case "$c" in *" /etc/systemd/resolved.conf.d/"*) { systemctl restart systemd-resolved; } || bad="$bad, DNS (systemd-resolved)";; esac; case "$c" in *" /etc/sysctl.d/"*) { sysctl --system >/dev/null; } || bad="$bad, the kernel settings";; esac; case "$c" in *" /etc/systemd/journald.conf.d/"*) { systemctl restart systemd-journald; } || bad="$bad, the journal";; esac; case "$c" in *" /etc/udev/rules.d/"*) { udevadm control --reload && udevadm trigger --name-match=/dev/uinput; } || bad="$bad, udev";; esac; case "$c" in *" /etc/systemd/system/"*) { systemctl daemon-reload; } || bad="$bad, systemd";; esac; [ -z "$bad" ] || { echo "Fluff: the files are back, but these did not read them again: ${bad#, } — they count from the next restart." >&2; exit 1; }' fluff-undo 41 42 && { busctl --user call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus ReloadConfig >/dev/null || { echo "Fluff: your session bus didn't read its rules again: they count from your next login." >&2; false; }; }"##,
            r##"sudo sh -c 'set -eu; d=$(mktemp -d); trap "rm -rf -- \"\$d\"" EXIT; bsdtar -xqOf "$1" "$2" > "$d/base"; diff3 -m "$3" "$d/base" "$4" > "$d/merged" || { echo "Fluff: both changed the same lines, so nothing was written." >&2; exit 1; }; printf "%s  %s\n" "$6" "$d/merged" | sha256sum -c --quiet - >/dev/null 2>&1 || { echo "Fluff: the files changed since you looked, so nothing was written. Look again." >&2; exit 1; }; cp -a -- "$3" "$3.before-fluff-$5"; cp -- "$d/merged" "$3"; rm -- "$4"; echo "Fluff merged it. Your old one is kept as $3.before-fluff-$5"' fluff-merge '/var/cache/pacman/pkg/pacman-7.1.0-4-x86_64.pkg.tar.zst' 'etc/pacman.conf' '/etc/pacman.conf' '/etc/pacman.conf.pacnew' '20261104-120000' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'"##,
            r##"kwriteconfig6 --file kwinrc --group Xwayland --key XwaylandEisNoPrompt false && kwriteconfig6 --file kwinrc --group Xwayland --key XwaylandEisNoPromptApps --delete && qdbus6 org.kde.KWin /KWin reconfigure && { r=$(kreadconfig6 --file kwinrc --group Xwayland --key XwaylandEisNoPrompt); [ "$r" = false ] || { echo "Fluff: KWin's setting says \"$r\", not false." >&2; false; }; } && { r=$(kreadconfig6 --file kwinrc --group Xwayland --key XwaylandEisNoPromptApps); [ -z "$r" ] || { echo "Fluff: KWin still always allows: $r." >&2; false; }; } && printf '%s\n' '# TuxCopilot: /dev/uinput closed to your account (Security). Delete this file to open it again.' 'KERNEL=="uinput", TAG-="uaccess", TAG-="udev-acl"' | sudo tee /etc/udev/rules.d/72-tuxcopilot-uinput.rules >/dev/null && sudo udevadm control --reload && sudo udevadm trigger --name-match=/dev/uinput && { ! sudo getfacl -cp /dev/uinput 2>/dev/null | grep -q "^user:$USER:" || sudo setfacl -x u:"$USER" /dev/uinput; } && { [ ! -w /dev/uinput ] || { echo "Fluff: /dev/uinput is still open to your account." >&2; false; }; } && { ! systemctl --user cat ydotool.service >/dev/null 2>&1 || systemctl --user disable --now ydotool.service; } && { ! systemctl --user is-active -q ydotool.service || { echo "Fluff: ydotool's service is still running." >&2; false; }; } && printf '%s\n' '<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">' '<!-- TuxCopilot: no program may take your keyboard and mouse without a window (Security, Block). Delete this file to undo. -->' '<busconfig>' '  <policy context="mandatory">' '    <deny send_destination="org.kde.KWin" send_path="/org/kde/KWin/EIS/RemoteDesktop"/>' '    <deny send_destination="org.kde.KWin" send_path="/org/kde/KWin/EIS/InputCapture"/>' '    <deny send_destination="org.freedesktop.portal.Desktop" send_interface="org.freedesktop.portal.RemoteDesktop"/>' '    <deny send_destination="org.freedesktop.portal.Desktop" send_interface="org.freedesktop.portal.InputCapture"/>' '  </policy>' '</busconfig>' | sudo tee /etc/dbus-1/session.d/tuxcopilot-input.conf >/dev/null && busctl --user call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus ReloadConfig >/dev/null && { ! busctl --user introspect org.kde.KWin /org/kde/KWin/EIS/RemoteDesktop >/dev/null 2>&1 || { echo "Fluff: KWin's door still answers. Log out and in again, then look here." >&2; false; }; } && { [ ! -e /usr/local/bin/Xwayland ] || grep -qs TuxCopilot /usr/local/bin/Xwayland || { echo "Fluff: /usr/local/bin/Xwayland is not TuxCopilot's, so it is left alone." >&2; false; }; } && printf '%s\n' '#!/bin/sh' '# TuxCopilot: Xwayland without XTEST, so no X11 program can type or click for you (Security, Block). Delete this file to undo; it counts from your next login.' 'exec /usr/bin/Xwayland "$@" -extension XTEST' | sudo tee /usr/local/bin/Xwayland >/dev/null && sudo chmod 755 /usr/local/bin/Xwayland && { [ -x /usr/local/bin/Xwayland ] && grep -q -- '-extension XTEST' /usr/local/bin/Xwayland || { echo "Fluff: /usr/local/bin/Xwayland wasn't written as it should be." >&2; false; }; } && { ! systemctl --user cat app-org.kde.krdpserver.service >/dev/null 2>&1 || systemctl --user disable --now app-org.kde.krdpserver.service; } && { ! systemctl --user is-active -q app-org.kde.krdpserver.service || { echo "Fluff: KDE's Remote Desktop server is still running." >&2; false; }; }"##,
        ] {
            assert_eq!(wrecks(c), None, "{c}");
        }
    }

    /// … and those of the same evening: USBGuard on and off, USB sticks and SD cards, groups.
    #[test]
    fn fluffs_own_device_and_group_commands_are_not_wrecks() {
        for c in [
            r##"sudo pacman -Syu --needed usbguard && sudo sh -c 'set -eu; f=/etc/usbguard/rules.conf; if [ -s "$f" ] && ! head -n1 "$f" | grep -q "^# TuxCopilot"; then echo "Fluff: $f already has rules Fluff did not write, so they are left alone." >&2; exit 1; fi; umask 077; { echo "# TuxCopilot: the USB devices plugged in when USBGuard was switched on (Security). Others are blocked until you allow them."; usbguard generate-policy -P; } > "$f.new"; mv -f -- "$f.new" "$f"; a=/etc/usbguard/IPCAccessControl.d/$1; [ -e "$a" ] || printf "Devices=list,listen\n" > "$a"' fluff-usbguard "$USER" && sudo systemctl start usbguard.service && sleep 1 && b=$(usbguard list-devices --blocked) && { [ -z "$b" ] || { echo "Fluff: USBGuard blocked something plugged in now: $b" >&2; false; }; }"##,
            r##"sudo systemctl disable --now usbguard.service && { ! systemctl is-active -q usbguard.service || { echo "Fluff: USBGuard is still running." >&2; false; }; } && { bad=; for c in /sys/bus/usb/devices/usb*/authorized_default /sys/bus/usb/devices/*/authorized; do [ -e "$c" ] || continue; [ "$(cat "$c")" = 1 ] || { echo 1 | sudo tee "$c" >/dev/null; [ "$(cat "$c")" = 1 ] || bad="$bad $c"; }; done; [ -z "$bad" ] || { echo "Fluff: still closed:$bad" >&2; false; }; } && echo "Fluff: USBGuard is off, and every USB device plugged in now is let in.""##,
            r##"sudo systemctl enable usbguard.service && { systemctl is-enabled -q usbguard.service || { echo "Fluff: USBGuard isn't set to start at every boot." >&2; false; }; }"##,
            r##"printf '%s\n' '// TuxCopilot: USB sticks and SD cards — opening one is refused (Security). Delete this file to undo.' 'polkit.addRule(function (action, subject) {' '  if (action.id == "org.freedesktop.udisks2.filesystem-mount" || action.id == "org.freedesktop.udisks2.filesystem-mount-other-seat" || action.id == "org.freedesktop.udisks2.encrypted-unlock" || action.id == "org.freedesktop.udisks2.encrypted-unlock-other-seat") {' '    return polkit.Result.NO;' '  }' '});' | sudo tee /etc/polkit-1/rules.d/00-tuxcopilot-storage.rules >/dev/null && printf '%s\n' '# TuxCopilot: USB sticks, USB disks and SD cards refused (Security, Block). Delete this file to undo.' 'install usb_storage /bin/false' 'install uas /bin/false' 'install mmc_block /bin/false' | sudo tee /etc/modprobe.d/tuxcopilot-storage.conf >/dev/null && { c=$(sudo modprobe --showconfig) && printf '%s\n' "$c" | grep -qx 'install usb_storage /bin/false' && printf '%s\n' "$c" | grep -qx 'install uas /bin/false' && printf '%s\n' "$c" | grep -qx 'install mmc_block /bin/false' || { echo "Fluff: modprobe doesn't refuse the drivers." >&2; false; }; } && for d in mmc_block uas usb_storage; do ! grep -q "^$d " /proc/modules || sudo modprobe -r "$d" || echo "Fluff: $d is in use now (a USB stick, disk or SD card is in): it keeps working until you take it out, and not again after."; done && { ok=; for i in 1 2 3 4 5; do pkcheck --action-id org.freedesktop.udisks2.filesystem-mount --process $$ >/dev/null 2>&1; [ $? -eq 1 ] && ok=1 && break; sleep 1; done; [ -n "$ok" ] || { echo "Fluff: polkit doesn't say no yet. Log out and in again, then look here." >&2; false; }; }"##,
            r##"sudo rm -f /etc/polkit-1/rules.d/00-tuxcopilot-storage.rules && sudo rm -f /etc/modprobe.d/tuxcopilot-storage.conf && { ok=; for i in 1 2 3 4 5; do pkcheck --action-id org.freedesktop.udisks2.filesystem-mount --process $$ >/dev/null 2>&1; [ $? -eq 0 ] && ok=1 && break; sleep 1; done; [ -n "$ok" ] || { echo "Fluff: polkit doesn't say yes yet. Log out and in again, then look here." >&2; false; }; }"##,
            r##"{ others=$(getent group wheel | cut -d: -f4 | tr ',' '\n' | grep -vx "$USER" | grep -c .); rootpw=$(sudo passwd -S root | cut -d' ' -f2); [ "$others" -gt 0 ] || [ "$rootpw" = P ] || { echo "Fluff: you are the only one who can use sudo, and root has no password, so out of wheel nobody could put you back. Nothing was changed." >&2; false; }; } && sudo gpasswd -d "$USER" wheel && ! id -nG "$USER" | tr ' ' '\n' | grep -qx wheel && echo "Fluff: done. sudo reads it at once.""##,
            r##"sudo gpasswd -a "$USER" docker && m=$(id -nG "$USER") && { printf '%s\n' $m | grep -qx docker || { echo "Fluff: you are not in docker." >&2; false; }; } && echo "Fluff: done. It counts from your next login: log out and in again.""##,
        ] {
            assert_eq!(wrecks(c), None, "{c}");
        }
    }
}
