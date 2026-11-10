// Packages App Manager must never offer to remove: the ones that keep Arch booting, logging
// in, drawing the desktop, reaching the network, making sound, and installing software.
// Removing one of these can leave a beginner with a machine that no longer starts.
//
// The primary source is what this machine's OS says is core: src-tauri/src/system.rs learns
// it (base, kernels, bootloader, login screen, every desktop session, services started at
// boot, the distribution's own packages, and everything they depend on) and setCoreSystem()
// loads it here. The lists below are only a fallback safety net, for when detection has not
// run or could not read pacman's database.

const EXACT = new Set([
  // the base system and its package manager
  "base", "base-devel", "filesystem", "glibc", "gcc-libs", "bash", "coreutils", "util-linux",
  "shadow", "pam", "systemd", "systemd-sysvcompat", "systemd-libs", "dbus", "dbus-broker",
  "dbus-broker-units", "pacman", "pacman-mirrorlist", "pacman-contrib", "archlinux-keyring",
  "sudo", "doas", "opendoas", "polkit", "procps-ng", "iproute2", "kmod", "e2fsprogs",
  "btrfs-progs", "dosfstools", "xfsprogs", "cryptsetup", "lvm2", "mdadm", "zram-generator",
  // AUR helpers and other installers
  "yay", "yay-bin", "paru", "paru-bin", "flatpak", "pamac", "octopi",
  // booting
  "mkinitcpio", "dracut", "booster", "grub", "limine", "refind", "efibootmgr", "syslinux",
  "os-prober", "intel-ucode", "amd-ucode", "sof-firmware", "alsa-firmware", "plymouth",
  // network
  "networkmanager", "network-manager-applet", "nm-connection-editor", "iwd", "wpa_supplicant",
  "dhcpcd", "openresolv", "systemd-resolvconf", "modemmanager", "bluez", "bluez-utils",
  // login screens and sessions
  "sddm", "sddm-kcm", "gdm", "lightdm", "ly", "greetd", "xorg-server", "xorg-xwayland",
  "xorg-xinit", "wayland", "xdg-utils", "xdg-user-dirs",
  // KDE Plasma
  "plasma", "plasma-meta", "plasma-desktop", "plasma-workspace", "plasma-nm", "plasma-pa",
  "plasma-login-manager", "kwin", "kwin-x11", "kwayland", "systemsettings", "kscreen",
  "powerdevil", "bluedevil", "kde-gtk-config", "breeze", "kded", "kinit", "kio",
  "polkit-kde-agent", "kwallet", "kwalletmanager", "ksshaskpass", "discover", "drkonqi",
  // GNOME and other desktops
  "gnome", "gnome-shell", "gnome-session", "gnome-control-center", "gnome-settings-daemon",
  "mutter", "nautilus", "gnome-keyring", "seahorse", "xfce4", "xfce4-session", "xfwm4",
  "xfdesktop", "xfce4-panel", "cinnamon", "mate", "lxqt", "lxqt-openssh-askpass",
  "hyprland", "sway", "niri", "wayfire", "xfce4-settings", "xfce4-power-manager",
  "cosmic-session", "cosmic-comp", "cosmic-panel", "cosmic-settings", "cosmic-settings-daemon",
  "cosmic-greeter", "cosmic-launcher", "cosmic-applets", "cosmic-bg", "cosmic-osd",
  "cosmic-notifications", "cosmic-idle", "cosmic-randr", "cosmic-workspaces", "cosmic-app-library",
  // the snapshots that let you roll back a broken update (printing and Bluetooth managers
  // are apps you chose, not what the machine needs to run)
  "snapper", "snap-pac", "btrfs-assistant", "timeshift", "grub-btrfs",
  // audio and portals
  "pipewire", "pipewire-pulse", "pipewire-alsa", "pipewire-jack", "wireplumber",
  "pulseaudio", "alsa-utils", "rtkit", "udisks2", "upower", "power-profiles-daemon",
  // graphics
  "mesa", "lib32-mesa", "vulkan-icd-loader",
  // this app's own needs
  "webkit2gtk-4.1", "openssl", "sqlite",
]);

const PREFIXES: Array<[RegExp, string]> = [
  [/^linux(-.*)?$/, "the Linux kernel, its headers or its firmware"],
  [/^cachyos-/, "part of CachyOS itself"],
  [/^limine-/, "part of the Limine bootloader and its snapshot entries"],
  [/^(lib32-)?nvidia/, "the NVIDIA graphics driver"],
  [/^(lib32-)?vulkan-/, "a graphics (Vulkan) driver"],
  [/^xf86-video-/, "a graphics driver"],
  [/^mesa-/, "part of the graphics stack"],
  [/^pipewire-/, "part of the sound system"],
  [/^xdg-desktop-portal/, "lets apps open files and share the screen"],
  [/^plasma-/, "part of the KDE Plasma desktop"],
  [/^kwin/, "the KDE window manager"],
  [/^qt[56]-/, "a toolkit many apps are built on"],
  [/^gtk[234]?$/, "a toolkit many apps are built on"],
  // No blanket /^lib/: it would catch libreoffice. Libraries have no menu entry, so they never
  // reach the lists, and pacman itself refuses to remove one another package needs.
];

let core = new Map<string, string>();

/** Loads the core system learned from this machine (package → why it is core). */
export function setCoreSystem(entries: Array<{ package: string; reason: string }>): void {
  core = new Map(entries.map((e) => [e.package.toLowerCase(), e.reason]));
}

export const coreSystemSize = (): number => core.size;

/** Why a package must not be removed, or null when it is an ordinary app. */
export function protectedReason(pkg: string): string | null {
  const name = pkg.trim().toLowerCase();
  if (!name) return null;
  const learned = core.get(name);
  if (learned) return learned;
  if (EXACT.has(name)) return "part of the system that keeps Arch running";
  for (const [re, why] of PREFIXES) if (re.test(name)) return why;
  return null;
}

export const isProtected = (pkg: string): boolean => protectedReason(pkg) !== null;
