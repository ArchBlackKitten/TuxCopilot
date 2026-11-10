// "Did anyone change my system files?", checked two ways.
//   1. Against the packages' own recorded SHA-256s (pacman -Qkk; filecheck.rs).
//   2. Against Fluff's own recorded SHA-256s, for what no package tracks: kept in the sealed
//      database, so changing the record needs your lock opened.
// It only reads. A program file that differs from its package can be put back by reinstalling it.

import { inv } from "./host";

export interface FileChange {
  package: string;
  path: string;
  reasons: string[];
  settings: boolean;
}
export interface PackageCheck {
  changed: FileChange[];
  unreadable: number;
  packages: number;
}
export interface Fingerprint {
  path: string;
  sha256: string;
}
export const packageFilesCheck = () => inv<PackageCheck>("package_files_check");
export const untrackedFingerprints = () => inv<Fingerprint[]>("untracked_fingerprints");

export type ChangeKind = "contents" | "owner" | "missing";
export function changeKind(c: Pick<FileChange, "reasons">): ChangeKind {
  if (c.reasons.some((r) => /No such file|missing/i.test(r))) return "missing";
  if (c.reasons.some((r) => /SHA256|Size|File type|Symlink path/i.test(r))) return "contents";
  return "owner";
}

export const KIND_WORDS: Record<ChangeKind, string> = {
  contents: "its contents differ from what the package put there",
  owner: "who owns it, or who may read and change it, differs from the package",
  missing: "it is gone",
};

// changes Fluff knows the system makes itself (path → why it is fine)
const KNOWN: Array<[RegExp, string]> = [
  [/^\/usr\/lib\/vlc\/plugins\/plugins\.dat$/, "VLC's plugin list, rebuilt on purpose after each update."],
  [/^\/etc\/lsb-release$/, "your distribution's name, written by CachyOS over Arch's."],
  [/^\/boot$/, "your boot folder made private (only root may read it) — safer than the package's."],
  [/^\/etc\/cups\/(classes|printers|subscriptions)\.conf$/, "the printer service (CUPS) keeps these private itself."],
  [/^\/var\/lib\/[^/]+(\/.*)?$/, "a service's own data folder, handed to the service's own user when it started."],
  [/^\/var\/log\/.+/, "a log folder, handed to the service that writes it."],
  [/^\/usr\/lib\/plymouth\/plymouth-update-initrd$/, "the boot splash's helper, replaced by your distribution's own."],
  [/^\/usr\/lib\/utempter\/utempter$/, "a terminal helper whose group your distribution sets differently."],
];

/** Why a change is fine, when Fluff knows; null: look closer. */
export const knownChange = (path: string): string | null => KNOWN.find(([re]) => re.test(path))?.[1] ?? null;

/** Program files (not settings), worst first: unknown contents first. */
export function toLookAt(changed: FileChange[]): FileChange[] {
  const rank = (c: FileChange) => (knownChange(c.path) ? 2 : 0) + (changeKind(c) === "contents" || changeKind(c) === "missing" ? 0 : 1);
  return changed.filter((c) => !c.settings).sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
}

/** Put program files back as their package has them: reinstalled (the whole system updated first). Settings files are left alone. */
export function reinstallCommand(packages: string[]): string {
  const ps = [...new Set(packages)].sort();
  if (!ps.length || ps.some((p) => !/^[a-z0-9@_+][a-z0-9@._+-]*$/.test(p))) throw new Error("not package names");
  return `sudo pacman -Syu ${ps.join(" ")}`;
}

/** Root-only files, checked as root: only what differs is shown — and "nothing differs" only when
 *  pacman really checked (a sudo that wasn't allowed printed nothing, which read as "all fine"). */
export const CHECK_AS_ROOT = `out=$(sudo pacman -Qkk 2>&1); printf '%s\\n' "$out" | grep -q ' total files' || { printf '%s\\n' "$out" >&2; echo "Fluff: pacman couldn't check the files, so nothing is known." >&2; exit 1; }; d=$(printf '%s\\n' "$out" | grep -E 'mismatch|missing' | grep -v 'Modification time mismatch'); if [ -n "$d" ]; then printf '%s\\n' "$d"; else echo "Fluff: no file differs from what its package recorded."; fi`;

// ── Fluff's own recorded fingerprints ──────────────────────────────────

export interface Recorded {
  when: string;
  files: Record<string, string>; // path → SHA-256
}
const KEY = "files.recorded";
export async function getRecorded(): Promise<Recorded | null> {
  try {
    const raw = await inv<string | null>("setting_get", { key: KEY });
    const v = raw ? (JSON.parse(raw) as Recorded) : null;
    return v && typeof v.when === "string" && v.files && typeof v.files === "object" ? v : null;
  } catch {
    return null;
  }
}
export const RECORDED_KEY = KEY; // written by Apply only (api.ts saveFilesRecorded): every edit waits for Apply
export const record = (now: Fingerprint[], when = new Date().toISOString()): Recorded => ({ when, files: Object.fromEntries(now.map((f) => [f.path, f.sha256])) });

export interface Compared {
  added: string[];
  changed: string[];
  removed: string[];
}
export function compare(recorded: Recorded, now: Fingerprint[]): Compared {
  const seen = new Map(now.map((f) => [f.path, f.sha256]));
  const was = recorded.files;
  return {
    added: [...seen.keys()].filter((p) => !(p in was)).sort(),
    changed: [...seen.entries()].filter(([p, s]) => p in was && was[p] !== s).map(([p]) => p).sort(),
    removed: Object.keys(was).filter((p) => !seen.has(p)).sort(),
  };
}

/** Why a file there matters, in plain words. */
export function placeWords(path: string): string {
  const p = path.replace(/^\/home\/[^/]+/, "~");
  if (/^~\/\.ssh\/authorized_keys$/.test(p)) return "who may log in to this computer over SSH with a key";
  if (/^~\/\.(bashrc|bash_profile|bash_login|profile|zshrc|zprofile|zshenv|zlogin|xprofile|xinitrc)$/.test(p) || /^~\/\.ssh\/rc$/.test(p)) return "runs every time you open a terminal or log in";
  if (/^~\/\.config\/(autostart|autostart-scripts|plasma-workspace\/env|plasma-workspace\/shutdown)\//.test(p)) return "starts by itself when you log in (or out)";
  if (/^~\/\.config\/systemd\/user\//.test(p)) return "a background service of yours";
  if (/^~\/\.config\/environment\.d\//.test(p)) return "settings every program you start gets";
  if (/^~\/\.local\/bin\//.test(p)) return "a program of yours, found before the system's";
  if (/^\/usr\/local\//.test(p)) return "a program installed by hand, found before the system's";
  if (/^\/etc\/ca-certificates\/|^\/etc\/ssl\//.test(p)) return "a certificate your computer trusts for secure websites";
  if (/^\/etc\/pam\.d\//.test(p)) return "how logging in and sudo check who you are";
  if (/^\/etc\/systemd\//.test(p)) return "a service the system starts";
  if (/^\/etc\/udev\//.test(p)) return "what happens when a device is plugged in";
  if (/^\/etc\/(profile\.d|xdg\/autostart)\//.test(p)) return "runs when anyone logs in";
  return "a settings file no package owns";
}
