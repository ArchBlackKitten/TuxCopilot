// The safety gate for App Manager's removal plans: nothing that keeps Arch booting, logging in
// or drawing the desktop may ever get a plan, and ordinary apps must stay removable.
import { describe, expect, it } from "vitest";
import { protectedReason } from "@/lib/protected";
import { eliminationPlans } from "@/lib/api";

// what an old "Fully unused" list once offered: the system itself
const WOULD_BREAK_THIS_MACHINE = [
  "linux-cachyos", "linux-firmware", "base", "sudo", "limine", "sddm", "networkmanager",
];

const CORE_ELSEWHERE = [
  "linux", "linux-lts", "linux-zen", "linux-headers", "linux-firmware-intel", "grub", "efibootmgr",
  "systemd", "pacman", "plasma-desktop", "plasma-workspace", "systemsettings", "kwin", "gdm",
  "gnome-shell", "mesa", "nvidia", "nvidia-utils", "lib32-nvidia-utils", "pipewire",
  "pipewire-pulse", "wireplumber", "xdg-desktop-portal-kde", "intel-ucode", "yay", "paru",
  "cachyos-settings", "mkinitcpio", "xorg-xwayland", "qt6-base", "cosmic-settings", "cosmic-comp",
  "xfce4-settings", "xfce4-power-manager", "limine-snapper-sync",
  "btrfs-assistant", "snapper", "timeshift",
];

const ORDINARY_APPS = [
  // printing and the Bluetooth manager are apps you chose ("system" is base software the machine
  // needs to run), so they aren't refused
  "cups", "blueman",
  "firefox", "vlc", "gimp", "libreoffice-fresh", "brave-bin", "vscodium-bin", "steam", "krita",
  "obs-studio", "discord", "telegram-desktop", "kate", "konsole", "dolphin", "spectacle",
  "audacity", "org.gimp.GIMP", "inkscape", "thunderbird", "keepassxc", "handbrake",
  "signal-desktop", "thunar", "kitty",
];

describe("protected packages", () => {
  it.each(WOULD_BREAK_THIS_MACHINE)("%s is refused", (p) => expect(protectedReason(p)).not.toBeNull());
  it.each(CORE_ELSEWHERE)("%s is refused", (p) => expect(protectedReason(p)).not.toBeNull());
  it.each(ORDINARY_APPS)("%s stays removable", (p) => expect(protectedReason(p)).toBeNull());

  it("a protected package gets no removal plan at all, from any source", () => {
    for (const source of ["pacman", "aur", "other", "simulated"]) {
      const r = eliminationPlans("linux-cachyos", source);
      expect(r.plans).toEqual([]);
      expect(r.protectedReason).toMatch(/kernel/);
    }
  });

  it("an ordinary app still gets its three plans", () => {
    const r = eliminationPlans("vlc", "pacman");
    expect(r.protectedReason).toBeNull();
    expect(r.plans.map((p) => p.level)).toEqual(["full", "mid", "partial"]);
  });
});
