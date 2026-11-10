// App Manager — detects which apps exist on this machine, so the usage
// ranking and the "fully unused" list are grounded in reality.
//
// Order of preference:
//   1. `pacman -Qe` (native) + `pacman -Qm` (foreign = AUR)   → detected
//   2. `flatpak list --app`                                    → detected
//   3. `snap list` (snapd from the AUR)                        → detected
//   4. If nothing works (no pacman, no flatpak, no snap): a small sample
//      catalogue clearly labelled "sample" so the UI still works.

import { execOut, inv } from "./host";
import { loadSystemProfile } from "./system-profile";
import { PROCESS_MAP } from "./process-map";

export type AppKind = "pacman" | "aur" | "flatpak" | "snap" | "appimage" | "sample";

export interface InstalledApp {
  name: string; // package / app id — used as the log key
  kind: AppKind;
}

export interface DetectResult {
  apps: InstalledApp[];
  mode: "detected" | "sample";
  pacmanAvailable: boolean;
  flatpakAvailable: boolean;
  snapAvailable: boolean;
  checkedAt: string;
  note: string;
}

// Rejects on a missing program or non-zero exit, as execFile did.
const execFileP = async (cmd: string, args: string[], timeout = 8000): Promise<string> => {
  const out = await execOut(cmd, args, timeout);
  if (out === null) throw new Error(`${cmd} unavailable`);
  return out;
};

/** Sample catalogue used only when pacman AND flatpak are unavailable. */
export const SAMPLE_CATALOGUE: InstalledApp[] = [
  "firefox", "chromium", "code", "kitty", "alacritty", "thunderbird",
  "vlc", "mpv", "gimp", "krita", "blender", "obs-studio", "steam",
  "discord", "telegram-desktop", "libreoffice-fresh", "keepassxc",
  "qbittorrent", "dolphin", "thunar", "nautilus", "spotify-launcher",
  "inkscape", "darktable",
].map((name) => ({ name, kind: "sample" as const }));

let cache: DetectResult | null = null;
let cacheAt = 0;
const CACHE_MS = 10 * 60 * 1000; // re-detect every 10 minutes

async function listPacman(): Promise<{ ok: boolean; apps: InstalledApp[] }> {
  try {
    const out = await execFileP("pacman", ["-Qe", "--color=never"]);
    const native = out
      .split("\n")
      .map((l) => l.trim().split(/\s+/)[0])
      .filter(Boolean)
      .map<InstalledApp>((name) => ({ name, kind: "pacman" }));

    let foreign: InstalledApp[] = [];
    try {
      const fm = await execFileP("pacman", ["-Qem", "--color=never"]);
      foreign = fm
        .split("\n")
        .map((l) => l.trim().split(/\s+/)[0])
        .filter(Boolean)
        .map<InstalledApp>((name) => ({ name, kind: "aur" }));
    } catch {
      // -Qem with zero foreign packages still exits 0; a missing pacman is caught above
    }
    // -Qe lists AUR packages too: each app once, as AUR when -Qem names it
    const aur = new Set(foreign.map((a) => a.name));
    return { ok: true, apps: [...native.filter((a) => !aur.has(a.name)), ...foreign] };
  } catch {
    return { ok: false, apps: [] };
  }
}

async function listFlatpak(): Promise<{ ok: boolean; apps: InstalledApp[] }> {
  try {
    const out = await execFileP("flatpak", [
      "list", "--app", "--columns=application", "--user",
    ]);
    const user = out.split("\n").map((l) => l.trim()).filter(Boolean);
    let system: string[] = [];
    try {
      const so = await execFileP("flatpak", [
        "list", "--app", "--columns=application", "--system",
      ]);
      system = so.split("\n").map((l) => l.trim()).filter(Boolean);
    } catch {
      // no system remote — fine
    }
    const ids = [...new Set([...user, ...system])];
    // flatpak answered: available even with no apps (so a removed last flatpak is noticed)
    return { ok: true, apps: ids.map<InstalledApp>((name) => ({ name, kind: "flatpak" })) };
  } catch {
    return { ok: false, apps: [] };
  }
}

/**
 * Snaps from `snap list`. The header line is dropped; bases, snapd itself and shared content
 * (themes, GNOME/KDE platforms) are runtimes the apps stand on, not apps: never listed.
 */
export function parseSnapList(out: string): InstalledApp[] {
  return out
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((c) => c[0] && !isSnapRuntime(c[0], c[5] ?? ""))
    .map((c) => ({ name: c[0], kind: "snap" as const }));
}

export function isSnapRuntime(name: string, notes: string): boolean {
  return (
    /(^|,)(base|core|snapd)(,|$)/.test(notes) ||
    /^(snapd|bare|core\d*|gtk-common-themes|gtk2-common-themes|gnome-\d|kf\d-|kde-frameworks-|mesa-)/.test(name)
  );
}

/**
 * "missing": no snap program. "stopped": snapd is installed but its service is not running —
 * `snap --version` then says "snapd unavailable", and `snap list` would hang, so it is never
 * asked. "running": snaps can be listed and installed.
 */
export type SnapState = "missing" | "stopped" | "running";

export async function snapState(): Promise<SnapState> {
  const v = await execOut("snap", ["--version"]);
  if (v === null) return "missing";
  return parseSnapVersion(v);
}

export function parseSnapVersion(out: string): SnapState {
  const line = out.split("\n").find((l) => /^snapd\s/.test(l.trim()));
  return !line || /unavailable/.test(line) ? "stopped" : "running";
}

async function listSnap(): Promise<{ ok: boolean; apps: InstalledApp[] }> {
  // only a running snapd is asked; no snaps installed → available, no apps
  if ((await snapState()) !== "running") return { ok: false, apps: [] };
  const out = await execOut("snap", ["list"], 8000);
  return { ok: out !== null, apps: out ? parseSnapList(out) : [] };
}

/** Whether flatpak is installed, and what state snapd is in (for the Apps subsections). */
export async function packagingTools(): Promise<{ flatpak: boolean; snap: SnapState }> {
  const [f, s] = await Promise.all([execOut("flatpak", ["--version"]), snapState()]);
  return { flatpak: f !== null, snap: s };
}

/** After something was installed or removed: the next look reads the machine again. */
export function forgetInstalledApps(): void {
  cache = null;
}

export async function detectInstalledApps(force = false): Promise<DetectResult> {
  const now = Date.now();
  if (!force && cache && now - cacheAt < CACHE_MS) return cache;

  const [pac, fp, sn] = await Promise.all([listPacman(), listFlatpak(), listSnap()]);
  const pacmanAvailable = pac.ok;
  const flatpakAvailable = fp.ok;
  const snapAvailable = sn.ok;

  let apps: InstalledApp[];
  let mode: "detected" | "sample";
  let note: string;

  if (pacmanAvailable || flatpakAvailable || snapAvailable) {
    // Only APPS: packages you installed yourself that put an entry in the application menu.
    // The kernel, firmware, bootloader, drivers, libraries and the desktop itself have no menu
    // entry (or are protected), so they can never be offered as "unused apps" to remove.
    // If the menu index is unavailable, no pacman package is listed at all — never everything.
    await loadSystemProfile(); // the core list protected.ts checks against
    let menu = new Set<string>();
    try {
      const entries = await inv<Array<{ package: string }>>("desktop_apps");
      menu = new Set(entries.map((e) => e.package));
    } catch {
      menu = new Set();
    }
    // system apps with a menu entry stay listed — flagged "System" by the snapshot, and still
    // refused by the removal dialog
    const pacApps = pac.apps.filter((a) => menu.has(a.name));
    const fpApps = fp.apps;
    const snApps = sn.apps;
    apps = [...pacApps, ...fpApps, ...snApps];
    mode = "detected";
    const bits: string[] = [];
    if (pac.ok) bits.push(`${pacApps.length} apps you installed`);
    if (fp.ok && fpApps.length) bits.push(`${fpApps.length} flatpaks`);
    if (sn.ok && snApps.length) bits.push(`${snApps.length} snaps`);
    const hidden = pac.apps.length - pacApps.length;
    note =
      `Detected on this machine: ${bits.join(" + ")}.` +
      (hidden > 0
        ? ` ${hidden} background packages (kernel, drivers, libraries…) have no menu entry and are never listed. Apps that are part of your system are listed, flagged System, and can't be removed from here.`
        : "");
  } else {
    apps = SAMPLE_CATALOGUE;
    mode = "sample";
    note = "pacman, flatpak and snap were not found — showing a sample catalogue so the layout is visible. On your Arch machine this lists your real installed packages.";
  }

  cache = {
    apps,
    mode,
    pacmanAvailable,
    flatpakAvailable,
    snapAvailable,
    checkedAt: new Date(now).toISOString(),
    note,
  };
  cacheAt = now;
  return cache;
}

/** Names from the curated process map that are worth watching even when
 *  pacman is unavailable (sample mode) — the tracker can only see processes
 *  that map through PROCESS_MAP anyway. */
export function sampleWatchlist(): string[] {
  return [...new Set(Object.values(PROCESS_MAP).map((e) => e.app))];
}
