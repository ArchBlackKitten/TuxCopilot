// What is TuxCopilot's own, wherever it appears — so everything it put on your computer carries
// its tag (like "system" on what the system needs), and nothing of its looks like a stranger.
// Each function says why it is TuxCopilot's, or null when it isn't.

export const TUX_PACKAGES = ["tuxcopilot", "tuxcopilot-git", "tuxcopilot-bin"];
export const TUX_REPO = "github.com/ArchBlackKitten/TuxCopilot";

/** A package (or program) name. */
export function tuxPackage(name: string): string | null {
  return TUX_PACKAGES.includes(name.trim().toLowerCase()) ? "TuxCopilot itself" : null;
}

/** A systemd unit. */
export function tuxUnit(name: string): string | null {
  const n = name.trim();
  if (n === "tuxcopilot-shadow.service" || n === "tuxcopilot-shadow") return "TuxCopilot put this service here: Tor's Shadow (the Tor section) — it loads the firewall rules that send everything through Tor";
  if (/^tuxcopilot[\w@.-]*$/.test(n)) return "TuxCopilot put this here";
  return null;
}

/** A file or folder (absolute, or starting with ~). */
export function tuxPath(path: string): string | null {
  const p = path.trim().replace(/^\/home\/[^/]+(?=\/)/, "~");
  const rules: Array<[RegExp, string]> = [
    [/^\/etc\/tuxcopilot\/shadow\.nft$/, "TuxCopilot's file: Shadow's firewall rules (the Tor section)"],
    [/^~\/\.local\/state\/tuxcopilot\/off(\/|$)/, "TuxCopilot's records of what it switched off (apps' services, ports), so On can put them back"],
    [/^~\/\.local\/state\/tuxcopilot(\/|$)/, "TuxCopilot's own records"],
    [/^\/etc\/tuxcopilot(\/|$)/, "TuxCopilot's own folder for system settings"],
    [/^\/etc\/tor\/torrc\.d\/tuxcopilot\.conf$/, "TuxCopilot's file: your Tor settings from the Tor section"],
    [/^\/etc\/systemd\/resolved\.conf\.d\/tuxcopilot-dns\.conf$/, "TuxCopilot's file: the DNS you chose in Security → Network"],
    [/^\/etc\/udev\/rules\.d\/72-tuxcopilot-uinput\.rules$/, "TuxCopilot's file: /dev/uinput closed to your account (Security, Block)"],
    [/^\/etc\/dbus-1\/session\.d\/tuxcopilot-input\.conf$/, "TuxCopilot's file: the doors that hand out your keyboard and mouse, refused (Security)"],
    [/^\/usr\/local\/bin\/Xwayland$/, "TuxCopilot's file, when it says so inside: Xwayland started without XTEST (Security, Block)"],
    [/^\/etc\/polkit-1\/rules\.d\/00-tuxcopilot-storage\.rules$/, "TuxCopilot's file: opening USB sticks and SD cards asks or is refused (Security)"],
    [/^\/etc\/modprobe\.d\/tuxcopilot-storage\.conf$/, "TuxCopilot's file: the drivers for USB sticks and SD cards refused (Security, Block)"],
    [/^\/etc\/usbguard\/IPCAccessControl\.d\/[^/]+$/, "TuxCopilot's file, when Fluff switched USBGuard on: your account may list blocked USB devices (never allow them)"],
    [/^\/etc\/systemd\/journald\.conf\.d\/tuxcopilot-keep\.conf$/, "TuxCopilot's file: the journal kept a month, up to 500 MB (Security)"],
    [/^\/etc\/sysctl\.d\/99-tuxcopilot-hardening\.conf$/, "TuxCopilot's file: the kernel's own protections, a preset (Security)"],
    [/^~\/\.config\/systemd\/user\/tuxcopilot-checkup\.(service|timer)$/, "TuxCopilot's file: Fluff's weekly checkup (Troubleshoot), which only reads"],
    [/^~\/\.local\/share\/tuxcopilot\.desk(\/|$)/, "TuxCopilot's own data: your sealed database, the lock, the look, the window"],
    [/^~\/\.(config|cache)\/tuxcopilot(\.desk)?(\/|$)/, "TuxCopilot's own settings and cache"],
    [/\/applications\/tuxcopilot\.desktop$/, "TuxCopilot's entry in your app menu"],
    [/\/icons\/.*\/tuxcopilot\.(png|svg)$|\/pixmaps\/tuxcopilot\.(png|svg)$/, "TuxCopilot's icon"],
    [/^\/usr\/bin\/tuxcopilot$/, "TuxCopilot itself"],
    [/\.before-fluff-\d{8}-\d{6}$/, "a copy Fluff kept of your file before changing it — it can go once all works"],
    [/(^|\/)tuxcopilot-backup-[^/]*\.json$/, "a backup of TuxCopilot's data (your sections, settings and history), saved from TuxCopilot"],
  ];
  return rules.find(([re]) => re.test(p))?.[1] ?? null;
}

/** A git clone's origin. */
export function tuxRepo(origin: string | null | undefined): string | null {
  if (!origin) return null;
  const o = origin.trim().toLowerCase().replace(/^(https?|ssh|git):\/\//, "").replace(/^git@/, "").replace(/^github\.com:/, "github.com/").replace(/\.git$/, "").replace(/\/+$/, "");
  return o === TUX_REPO.toLowerCase() ? "TuxCopilot's own source" : null;
}

/** A line of your torrc. */
export function tuxTorrcLine(line: string): string | null {
  const l = line.trim();
  if (l === "%include /etc/tor/torrc.d/*.conf") return "TuxCopilot added this line, so Tor reads its settings file (torrc.d/tuxcopilot.conf)";
  if (/^# TuxCopilot\b/.test(l)) return "TuxCopilot wrote this";
  return null;
}
