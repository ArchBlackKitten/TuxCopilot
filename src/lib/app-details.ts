// App pages: how an app works, what it needs, and what you can change — read from pacman
// (or flatpak) and the app's own files, never guessed. Every change offered is a command
// that runs through the run manager, shown first.

import { inv } from "./host";
import { isPlannableName, sanitizeAppName } from "./eliminate";

// ── reading pacman ───────────────────────────────────────────────────────

export interface OptionalDep {
  name: string;
  why: string;
  installed: boolean;
}

export interface PkgInfo {
  name: string;
  version: string;
  description: string;
  url: string | null;
  licenses: string;
  size: string;
  installDate: string;
  explicit: boolean;
  from: string | null; // repo it came from (pacman 7 prints it), or null
  depends: string[];
  optional: OptionalDep[];
  requiredBy: string[];
  configs: Array<{ path: string; modified: boolean }>;
}

/** `pacman -Qii` (LC_ALL=C): "Key : value", continuation lines indented. */
export function parseQii(text: string): PkgInfo {
  const fields = new Map<string, string[]>();
  let key = "";
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z][A-Za-z ]+?)\s+:\s?(.*)$/);
    if (m && !line.startsWith(" ")) {
      key = m[1];
      fields.set(key, [m[2]]);
    } else if (key && /^\s+\S/.test(line)) {
      fields.get(key)!.push(line.trim());
    } else if (!line.trim()) {
      key = "";
    }
  }
  const one = (k: string) => fields.get(k)?.join(" ").trim() ?? "";
  const list = (k: string) => {
    const v = one(k);
    return v === "None" || !v ? [] : v.split(/\s+/).filter(Boolean);
  };
  const optional = (fields.get("Optional Deps") ?? [])
    .filter((l) => l && l !== "None")
    .map((l) => {
      const installed = /\[installed\]\s*$/.test(l);
      const clean = l.replace(/\s*\[installed\]\s*$/, "");
      const i = clean.indexOf(":");
      return { name: (i > 0 ? clean.slice(0, i) : clean).trim(), why: i > 0 ? clean.slice(i + 1).trim() : "", installed };
    });
  const configs = (fields.get("Backup Files") ?? [])
    .filter((l) => l.startsWith("/"))
    .map((l) => ({ path: l.split(/\s+/)[0], modified: /\[modified\]/.test(l) }));
  const url = one("URL");
  return {
    name: one("Name"),
    version: one("Version"),
    description: one("Description"),
    url: url && url !== "None" ? url : null,
    licenses: one("Licenses"),
    size: one("Installed Size"),
    installDate: one("Install Date"),
    explicit: /Explicitly installed/.test(one("Install Reason")),
    from: one("Installed From") || null,
    // "libfoo.so=1-64" style provides are libraries, not packages: kept out of the list
    depends: list("Depends On").filter((d) => !/\.so(=|$)/.test(d)).map((d) => d.replace(/[<>=].*$/, "")),
    optional,
    requiredBy: list("Required By"),
    configs,
  };
}

export interface HomePath {
  path: string;
  place: "settings" | "data" | "cache" | "state" | "autostart";
  backups: string[];
}

export interface UnitState {
  name: string;
  user: boolean;
  enabled: string;
  active: string;
}

export interface AppDetails {
  kind: "pacman";
  name: string; // the installed package (asked by what it provides → the provider)
  foreign: boolean; // AUR / hand-built
  info: PkgInfo;
  programs: string[]; // what it puts in /usr/bin
  menu: string[]; // .desktop files
  autostart: string[]; // starts at login for everyone (/etc/xdg/autostart)
  home: HomePath[];
  units: UnitState[];
  pacnew: string[];
  fileCount: number;
  processes: Proc[];
  offRecord: string | null; // turned off by TuxCopilot (what to turn back on), or null
}

export interface Proc {
  pid: number;
  name: string;
  uid: number;
  parent: number;
  mine: boolean;
}

/** The main processes (whose parent is not one of them), each with how many helpers it runs. */
export function mainProcesses(ps: Proc[]): Array<Proc & { helpers: number }> {
  const pids = new Set(ps.map((p) => p.pid));
  const rootOf = (p: Proc): number => {
    let cur = p;
    const seen = new Set<number>();
    while (pids.has(cur.parent) && !seen.has(cur.pid)) {
      seen.add(cur.pid);
      cur = ps.find((x) => x.pid === cur.parent)!;
    }
    return cur.pid;
  };
  const count = new Map<number, number>();
  for (const p of ps) count.set(rootOf(p), (count.get(rootOf(p)) ?? 0) + 1);
  return ps.filter((p) => !pids.has(p.parent)).map((p) => ({ ...p, helpers: (count.get(p.pid) ?? 1) - 1 }));
}

/** End your own processes (the main ones; their helpers go with them). */
export function endCommand(pids: number[]): string {
  if (!pids.length || !pids.every((p) => Number.isInteger(p) && p > 1)) throw new Error("no process to end");
  return `kill ${pids.join(" ")}`;
}

export async function pkgDetails(pkg: string): Promise<AppDetails> {
  const r = await inv<{ name: string; foreign: boolean; info: string; files: string[]; home: HomePath[]; units: UnitState[]; pacnew: string[]; processes: Proc[]; offRecord: string | null }>("pkg_details", { pkg });
  const files = r.files.filter((f) => !f.endsWith("/"));
  return {
    kind: "pacman",
    name: r.name,
    foreign: r.foreign,
    info: parseQii(r.info),
    programs: files.filter((f) => /^\/usr\/bin\/[^/]+$/.test(f)).map((f) => f.slice("/usr/bin/".length)),
    menu: files.filter((f) => /^\/usr\/share\/applications\/[^/]+\.desktop$/.test(f)),
    autostart: files.filter((f) => f.startsWith("/etc/xdg/autostart/")),
    home: r.home,
    units: r.units,
    pacnew: r.pacnew,
    fileCount: files.length,
    processes: r.processes,
    offRecord: r.offRecord,
  };
}

// ── flatpak ──────────────────────────────────────────────────────────────

export interface FlatpakPerms {
  [section: string]: Record<string, string[]>; // [Context] shared=network;ipc; → Context.shared = [network, ipc]
}

/** `flatpak info --show-permissions` / `override --show`: an ini file of ;-lists. */
export function parsePerms(text: string): FlatpakPerms {
  const out: FlatpakPerms = {};
  let sec = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const s = line.match(/^\[(.+)\]$/);
    if (s) {
      sec = s[1];
      out[sec] = {};
    } else if (sec && line.includes("=")) {
      const i = line.indexOf("=");
      out[sec][line.slice(0, i)] = line.slice(i + 1).split(";").filter(Boolean);
    }
  }
  return out;
}

export interface FlatpakDetails {
  kind: "flatpak";
  id: string;
  info: Record<string, string>; // Name, Version, Origin, Installed size…
  perms: FlatpakPerms;
  overrides: FlatpakPerms;
  data: string | null;
}

export async function flatpakDetails(id: string): Promise<FlatpakDetails> {
  const r = await inv<{ info: string; permissions: string; overrides: string; data: string | null }>("flatpak_details", { id });
  const info: Record<string, string> = {};
  for (const l of r.info.split("\n")) {
    const m = l.match(/^\s*([A-Z][\w ]+?):\s+(.*)$/);
    if (m) info[m[1]] = m[2].trim();
  }
  const first = r.info.split("\n").find((l) => l.trim())?.trim();
  if (first && !info.Name) info.Title = first;
  return { kind: "flatpak", id, info, perms: parsePerms(r.permissions), overrides: parsePerms(r.overrides), data: r.data };
}

/** The permissions people most often want to change, and the override that changes them. */
export const FLATPAK_TOGGLES: Array<{ key: string; section: string; field: string; value: string; label: string; off: string; on: string }> = [
  { key: "home", section: "Context", field: "filesystems", value: "home", label: "Your home folder", off: "--nofilesystem=home", on: "--filesystem=home" },
  { key: "host", section: "Context", field: "filesystems", value: "host", label: "Every file on the computer", off: "--nofilesystem=host", on: "--filesystem=host" },
  { key: "network", section: "Context", field: "shared", value: "network", label: "The internet", off: "--unshare=network", on: "--share=network" },
  { key: "devices", section: "Context", field: "devices", value: "all", label: "All devices (webcam, USB…)", off: "--nodevice=all", on: "--device=all" },
];

export function hasPerm(p: FlatpakPerms, section: string, field: string, value: string): boolean {
  return (p[section]?.[field] ?? []).includes(value);
}

export const flatpakOverride = (id: string, flag: string) => `flatpak override --user ${flag} ${id}`;
export const flatpakResetOverrides = (id: string) => `flatpak override --user --reset ${id}`;

export const unitLog = (name: string, user: boolean) => inv<string>("unit_log", { name, user });

// ── the commands ─────────────────────────────────────────────────────────

const q = (p: string) => {
  if (/['\n]/.test(p)) throw new Error(`unusual path: ${p}`);
  return `'${p}'`;
};

/** Settings set aside (never deleted): each folder moves to <folder>.bak-<date-time>. */
export function resetCommand(paths: string[]): string {
  if (!paths.length) return "";
  return `STAMP=$(date +%Y%m%d-%H%M%S) && for p in ${paths.map(q).join(" ")}; do [ ! -e "$p" ] || mv "$p" "$p.bak-$STAMP"; done && echo "Set aside with .bak-$STAMP — the app starts fresh next time you open it."`;
}

/** The newest backup back in place; what was there is kept as <folder>.after-reset-<when>. */
export function restoreCommand(path: string, backup: string): string {
  return `STAMP=$(date +%Y%m%d-%H%M%S) && { [ ! -e ${q(path)} ] || mv ${q(path)} ${q(path)}".after-reset-$STAMP"; } && mv ${q(backup)} ${q(path)} && echo "Your earlier settings are back."`;
}

export const clearCacheCommand = (paths: string[]) => (paths.length ? `rm -rf ${paths.map(q).join(" ")}` : "");

export function reinstallCommand(pkg: string, aur: boolean): string {
  const p = sanitizeAppName(pkg);
  if (!isPlannableName(p)) throw new Error(`not a package name: ${pkg}`);
  // no --needed: a reinstall puts back missing or damaged files; your edited /etc files stay
  return aur ? `yay -Syu --noconfirm ${p}` : `sudo pacman -Syu --noconfirm ${p}`;
}

/** A package that is not installed yet (from an app page reached by a link). */
export function installPkgCommand(pkg: string, aur: boolean): string {
  const p = sanitizeAppName(pkg);
  if (p !== pkg || !isPlannableName(p)) throw new Error(`not a package name: ${pkg}`);
  return aur ? `yay -Syu --needed --noconfirm ${p}` : `sudo pacman -Syu --needed --noconfirm ${p}`;
}

/** An optional extra, installed as a dependency so it leaves together with the app. */
export function optionalCommand(dep: string): string {
  const d = sanitizeAppName(dep);
  if (!isPlannableName(d)) throw new Error(`not a package name: ${dep}`);
  return `sudo pacman -Syu --needed --noconfirm --asdeps ${d}`;
}

export function unitCommand(u: Pick<UnitState, "name" | "user">, on: boolean): string {
  if (!/^[\w@.:-]+\.(service|timer|socket|path)$/.test(u.name)) throw new Error(`not a unit: ${u.name}`);
  const verb = on ? "enable --now" : "disable --now";
  return u.user ? `systemctl --user ${verb} ${u.name}` : `sudo systemctl ${verb} ${u.name}`;
}

/** Toggleable: a unit you can turn on and off (static / generated / masked ones can't be). */
export const toggleable = (u: UnitState) => u.enabled === "enabled" || u.enabled === "disabled";

/** Compare an /etc file with the one the package shipped (needs the package in pacman's cache). */
export function diffCommand(path: string, pkg: string, version: string): string {
  return `diff -u <(bsdtar -xOf /var/cache/pacman/pkg/${sanitizeAppName(pkg)}-${version}-*.pkg.tar.zst ${q(path.replace(/^\//, ""))}) ${q(path)}`;
}

/** What the newer default (.pacnew) would change in your file. */
export const pacnewCommand = (path: string) => `diff -u ${q(path)} ${q(path + ".pacnew")}`;

// ── the on / off switch ──────────────────────────────────────────────────
// Off: its services stop and no longer start, it no longer starts at login, and every copy
// that runs ends. What was switched off is written down (~/.local/state/tuxcopilot/off/<pkg>),
// so On puts back exactly that — nothing it never had — and opens the app again.

const OFF_DIR = "$HOME/.local/state/tuxcopilot/off";
const UNIT = /^[\w@.:-]+\.(service|timer|socket|path)$/;

export function offCommand(d: AppDetails): string {
  const pkg = sanitizeAppName(d.name);
  if (pkg !== d.name || !isPlannableName(pkg)) throw new Error(`not a package name: ${d.name}`);
  const rec = `"${OFF_DIR}/${pkg}"`;
  const parts = [`mkdir -p "${OFF_DIR}"`, `: > ${rec}`];
  for (const u of d.units) {
    if (!UNIT.test(u.name)) continue;
    const ctl = u.user ? "systemctl --user" : "sudo systemctl";
    if (u.enabled === "enabled") parts.push(`${ctl} disable --now ${u.name} && echo "${u.user ? "user" : "system"} ${u.name}" >> ${rec}`);
    else if (u.active === "active") parts.push(`${ctl} stop ${u.name} && echo "${u.user ? "user-started" : "system-started"} ${u.name}" >> ${rec}`);
  }
  for (const h of d.home.filter((x) => x.place === "autostart")) {
    parts.push(`mv ${q(h.path)} ${q(h.path + ".off-by-tuxcopilot")} && echo "autostart ${h.path}" >> ${rec}`);
  }
  for (const a of d.autostart) {
    // a login entry for everyone: hidden for you by a file of the same name in your autostart
    const mine = `$HOME/.config/autostart/${a.split("/").pop()}`;
    if (!/^[\w.@-]+\.desktop$/.test(a.split("/").pop() ?? "")) continue;
    parts.push(`{ [ -e "${mine}" ] || { mkdir -p "$HOME/.config/autostart" && printf '[Desktop Entry]\\nHidden=true\\n' > "${mine}" && echo "hidden ${mine}" >> ${rec}; }; }`);
  }
  parts.push(...endCopies(d));
  parts.push(`echo "${pkg} is off: its services, its login start and every running copy."`);
  return parts.join(" && ");
}

/** Every running copy ended. pkill -x compares the process name, cut at 15 characters: the
 * names the running copies really have, and the package's programs as far as they fit. */
function endCopies(d: AppDetails): string[] {
  const progs = [...new Set([...d.processes.map((p) => p.name), ...d.programs.filter((p) => p.length <= 15)])].filter((p) => /^[\w.+-]+$/.test(p));
  if (!progs.length) return [];
  const out = [`{ for p in ${progs.join(" ")}; do pkill -x "$p"; done 2>/dev/null; true; }`];
  if (d.processes.some((p) => !p.mine)) out.push(`{ for p in ${progs.join(" ")}; do sudo pkill -x "$p"; done 2>/dev/null; true; }`);
  return out;
}

// ── On / Off / Dead ──────────────────────────────────────────────────────
// On: running. Off: stopped for now — its services stay enabled and its login start stays,
// so the next restart (or login) brings it back. Dead: the old Off — kept from starting,
// written down. Read from the machine: started or re-enabled some other way, it shows so.

export type AppState = "on" | "off" | "dead";

export function appState(d: AppDetails): AppState {
  if (d.offRecord !== null) return "dead";
  const running = mainProcesses(d.processes).length > 0 || d.units.some((u) => u.active === "active");
  return running ? "on" : "off";
}

/** Dead only means something when something starts it by itself (a service, a login entry). */
export function canBeDead(d: AppDetails): boolean {
  return d.offRecord !== null || d.units.some((u) => u.enabled === "enabled" || u.active === "active") || d.autostart.length > 0 || d.home.some((h) => h.place === "autostart");
}

/** Off from On: services stopped (still enabled), every copy ended. */
export function stopCommand(d: AppDetails): string {
  const parts: string[] = [];
  for (const u of d.units) {
    if (!UNIT.test(u.name) || u.active !== "active") continue;
    parts.push(u.user ? `systemctl --user stop ${u.name}` : `sudo systemctl stop ${u.name}`);
  }
  parts.push(...endCopies(d), `echo "${d.name} is off for now; it starts again as it normally would."`);
  return parts.join(" && ");
}

/** On from Off: its enabled services started, and the app opened. */
export function startCommand(d: AppDetails): string {
  const parts: string[] = [];
  for (const u of d.units) {
    if (!UNIT.test(u.name) || u.enabled !== "enabled" || u.active === "active") continue;
    parts.push(u.user ? `systemctl --user start ${u.name}` : `sudo systemctl start ${u.name}`);
  }
  const menu = d.menu[0];
  if (menu && /^\/usr\/share\/applications\/[\w.@+-]+\.desktop$/.test(menu)) parts.push(`setsid -f gio launch ${menu} >/dev/null 2>&1`);
  if (!parts.length) throw new Error("nothing to start");
  return parts.join(" && ");
}

/** Off from Dead: able to start again (services enabled, login entries back), not started now. */
export function reviveCommand(pkg: string): string {
  const p = sanitizeAppName(pkg);
  if (p !== pkg || !isPlannableName(p)) throw new Error(`not a package name: ${pkg}`);
  const rec = `"${OFF_DIR}/${p}"`;
  return `[ -f ${rec} ] && while read -r kind what; do case "$kind" in system) sudo systemctl enable "$what";; user) systemctl --user enable "$what";; autostart) mv "$what.off-by-tuxcopilot" "$what";; hidden) rm -f "$what";; esac; done < ${rec}; rm -f ${rec} && echo "${p} starts again as it normally would."`;
}

export function appCommand(d: AppDetails, to: AppState): string {
  const from = appState(d);
  if (from === to) throw new Error("already there");
  if (to === "dead") return offCommand(d);
  if (to === "on") return from === "dead" ? onCommand(d.name, d.menu[0] ?? null) : startCommand(d);
  return from === "on" ? stopCommand(d) : reviveCommand(d.name);
}

export function onCommand(pkg: string, menuEntry: string | null): string {
  const p = sanitizeAppName(pkg);
  if (p !== pkg || !isPlannableName(p)) throw new Error(`not a package name: ${pkg}`);
  const rec = `"${OFF_DIR}/${p}"`;
  const restore = `{ [ ! -f ${rec} ] || { while read -r kind what; do case "$kind" in system) sudo systemctl enable --now "$what";; system-started) sudo systemctl start "$what";; user) systemctl --user enable --now "$what";; user-started) systemctl --user start "$what";; autostart) mv "$what.off-by-tuxcopilot" "$what";; hidden) rm -f "$what";; esac; done < ${rec}; rm -f ${rec}; }; }`;
  const open = menuEntry && /^\/usr\/share\/applications\/[\w.@+-]+\.desktop$/.test(menuEntry) ? ` && setsid -f gio launch ${menuEntry} >/dev/null 2>&1` : "";
  return `${restore}${open} && echo "${p} is on again."`;
}
