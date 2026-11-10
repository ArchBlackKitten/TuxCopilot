// Your penguin: the whole of TuxCopilot in one sealed file, to move it to another computer
// (penguin.rs does the sealing; this side only ever sees counts, never what is inside).

import { inv } from "./host";
import { saveTorrcCommand } from "./torrc";
import { exportSigner, type Integrity, type Saved } from "./integrity";

export interface PenguinSummary {
  made: string;
  from: string; // the computer it was made on
  appVersion: string;
  items: number;
  runs: number;
  usageDays: number;
  settings: number;
  pacman: number;
  aur: number;
  flatpak: number;
  git: number;
  ollama: number;
  docker: number;
  torrc: boolean;
  firewall: boolean;
  configs: Carried[];
}

export type Place = "config" | "home";
export interface Pick {
  place: Place;
  name: string;
}
/** A settings folder or file in the penguin. */
export interface Carried extends Pick {
  size: number;
}
/** One that could go in, and whether it starts ticked. */
export interface Candidate extends Carried {
  ticked: boolean;
}
export const shownPath = (p: Pick) => (p.place === "config" ? `~/.config/${p.name}` : `~/${p.name}`);
export const pickKey = (p: Pick) => `${p.place}:${p.name}`;

/** Words to use as the passphrase, for anyone who would rather not make one up: 9 is the standard, any number is yours to choose. */
export const passphraseWords = (count = 9) => inv<string[]>("penguin_words", { count });

/** Save dialog → the sealed penguin, its .sha256, and its .asc when a key is chosen. null: cancelled. */
export const exportPenguin = (passphrase: string, configs: Pick[], torrc: boolean, firewall: boolean) =>
  inv<Saved | null>("penguin_export", { passphrase, signWith: exportSigner(), configs, torrc, firewall });

/** Choose Fluff's belongings; their checksum and signature are checked at once. null: cancelled. */
export const pickPenguin = () => inv<{ name: string; integrity: Integrity } | null>("penguin_pick");

/** What the picked penguin holds (counts only): the passphrase is checked, nothing changes. */
export const peekPenguin = (passphrase: string) => inv<PenguinSummary>("penguin_peek", { passphrase });

export interface Restored {
  kept: string; // what TuxCopilot held before, packed as belongings
  configs: Array<[string, string | null]>; // each setting put back, and where what was there went
  configError: string | null;
}

/** Replace this TuxCopilot with the picked penguin, and put back the settings you ticked. */
export const restorePenguin = (passphrase: string, putBack: Pick[]) => inv<Restored>("penguin_restore", { passphrase, putBack });

/** "12 items, 340 runs, 95 days of app use, 14 settings" */
export function contentsLine(s: PenguinSummary): string {
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  return [n(s.items, "item"), n(s.runs, "run"), n(s.usageDays, "day of app use", "days of app use"), n(s.settings, "setting")].join(", ");
}

/** "your apps: 120 from pacman, 15 from the AUR, 4 Flatpak apps and 6 git clones" */
export function appsLine(c: { pacman: number; aur: number; flatpak: number; git: number; ollama?: number; docker?: number }): string {
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  const parts = [
    c.pacman && `${c.pacman} from pacman`,
    c.aur && `${c.aur} from the AUR`,
    c.flatpak && n(c.flatpak, "Flatpak app"),
    c.git && n(c.git, "git clone"),
    c.ollama && n(c.ollama, "Ollama model"),
    c.docker && n(c.docker, "Docker image"),
  ].filter(Boolean) as string[];
  if (!parts.length) return "no apps";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// ── your apps and clones, back on the new computer ───────────────────────

export interface PenguinPreview {
  pacman: number;
  aur: number;
  flatpak: number;
  git: number;
  ollama: number;
  docker: number;
  torrc: boolean;
  firewall: boolean;
  configs: Candidate[];
  notCarried: { noRemote: string[]; unsavedWork: string[]; outsideHome: string[]; dockerUnreadable: boolean };
}

export interface SysFile {
  path: string; // inside /etc/firewalld
  text: string;
}

export interface GitClone {
  path: string; // inside your home
  remote: string;
  branch: string | null;
}

export interface Missing {
  pacman: string[];
  notInRepos: string[];
  aur: string[];
  flatpak: string[];
  git: GitClone[];
  alreadyHere: number;
  refused: string[];
  yay: boolean;
  ollama: string[];
  docker: string[];
  torrc: string | null;
  firewall: SysFile[];
}

/** Before an export: what goes in, and what cannot come back from it. */
export const previewPenguin = () => inv<PenguinPreview>("penguin_preview");

/** After an import: what of the old computer's apps and clones this one lacks. null: no list. */
export const missingHere = () => inv<Missing | null>("penguin_missing");

export const forgetBelongings = () => inv("penguin_forget_belongings");

// The same rules as belongings.rs, checked again here: a command is only ever built from
// names that cannot be anything but names.
const PACKAGE = /^[a-z0-9@_+][a-z0-9@._+-]{0,127}$/;
const FLATPAK = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,254}$/;
const REMOTE = /^(https:\/\/|ssh:\/\/|git@)[A-Za-z0-9\-._~/:@%+=]+$/;
const BRANCH = /^[A-Za-z0-9._][A-Za-z0-9._/-]{0,199}$/;
const FOLDER = /^[\p{L}\p{N}._+@][\p{L}\p{N} ._+@/-]{0,399}$/u;

function names(list: string[], rule: RegExp, what: string): string {
  if (!list.length) throw new Error(`no ${what} chosen`);
  const bad = list.find((n) => !rule.test(n));
  if (bad !== undefined) throw new Error(`not a ${what}: ${bad}`);
  return list.join(" ");
}

export const pacmanCommand = (pkgs: string[]) => `sudo pacman -Syu --needed ${names(pkgs, PACKAGE, "package name")}`;

/** yay asks before building each one and can show its build script: read it (AUR apps are made by people, not checked by Arch). */
export const aurCommand = (pkgs: string[]) => `yay -Syu --needed ${names(pkgs, PACKAGE, "package name")}`;

/** yay itself, the usual way: built from the AUR with makepkg (git and base-devel first). */
export const YAY_COMMAND =
  'sudo pacman -Syu --needed git base-devel && d=$(mktemp -d) && git clone https://aur.archlinux.org/yay-bin.git "$d/yay-bin" && cd "$d/yay-bin" && makepkg -si';

export const flatpakCommand = (ids: string[]) =>
  `{ command -v flatpak >/dev/null || sudo pacman -Syu --needed flatpak; } && flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo && flatpak install -y flathub ${names(ids, FLATPAK, "Flatpak app")}`;

/** Each clone back where it was in your home; one that fails does not stop the others. */
export function gitCommand(clones: GitClone[]): string {
  if (!clones.length) throw new Error("no git clone chosen");
  return clones
    .map((c) => {
      if (!FOLDER.test(c.path) || c.path.split("/").some((p) => p === ".." || p === "." || p === "" || p.startsWith("-"))) throw new Error(`not a folder in your home: ${c.path}`);
      if (!REMOTE.test(c.remote)) throw new Error(`not a git address: ${c.remote}`);
      if (c.branch !== null && (!BRANCH.test(c.branch) || c.branch.includes(".."))) throw new Error(`not a branch: ${c.branch}`);
      const to = `"$HOME"/'${c.path}'`;
      const branch = c.branch ? `-b '${c.branch}' ` : "";
      return `mkdir -p "$(dirname ${to})" && git clone ${branch}'${c.remote}' ${to} || echo "Could not clone ${c.path}"`;
    })
    .join("; ");
}

const MODEL = /^[A-Za-z0-9_][A-Za-z0-9._:/-]{0,199}$/;
const IMAGE = /^[A-Za-z0-9_][A-Za-z0-9._:/@-]{0,299}$/;
const noDots = (list: string[]) => list.filter((x) => x.includes(".."));

/** Ollama itself if missing (and its service on), then each model downloaded again. */
export function ollamaCommand(models: string[]): string {
  const list = names(models, MODEL, "model name");
  if (noDots(models).length) throw new Error(`not a model name: ${noDots(models)[0]}`);
  return `{ command -v ollama >/dev/null || sudo pacman -Syu --needed ollama; } && { systemctl is-active -q ollama || sudo systemctl enable --now ollama; } && sleep 2 && for m in ${list}; do ollama pull "$m" || echo "Could not download $m"; done`;
}

/** Docker itself if missing (and its service on), then each image pulled again. */
export function dockerCommand(images: string[]): string {
  const list = names(images, IMAGE, "image name");
  if (noDots(images).length) throw new Error(`not an image name: ${noDots(images)[0]}`);
  return `{ command -v docker >/dev/null || sudo pacman -Syu --needed docker; } && { systemctl is-active -q docker || sudo systemctl enable --now docker; } && for i in ${list}; do sudo docker pull "$i" || echo "Could not pull $i"; done`;
}

/** Tor if missing, then the old computer's torrc — the Tor section's own save: Tor checks it first, the old one is kept. */
export const torrcBackCommand = (text: string) => `{ command -v tor >/dev/null || sudo pacman -Syu --needed tor; } && ${saveTorrcCommand(text)}`;

const FW_FILE = /^(firewalld\.conf|([A-Za-z0-9_][A-Za-z0-9._-]*\/)*[A-Za-z0-9_][A-Za-z0-9._-]*\.xml)$/;

function b64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * firewalld if missing; then the old computer's firewall settings over this one's — all of
 * /etc/firewalld kept first as /etc/firewalld.before-fluff-<when>. firewalld checks them;
 * if it refuses, the kept ones go back and nothing changed. Each file travels as base64.
 */
export function firewallCommand(files: SysFile[]): string {
  if (!files.length) throw new Error("no firewall settings");
  for (const f of files) if (!FW_FILE.test(f.path) || f.path.split("/").includes("..")) throw new Error(`not a firewalld file: ${f.path}`);
  const writes = files.map((f) => `mkdir -p "$(dirname "$t/${f.path}")" && printf '%s' '${b64(f.text)}' | base64 -d > "$t/${f.path}"`).join(" && ");
  return [
    `{ command -v firewall-cmd >/dev/null || sudo pacman -Syu --needed firewalld; } &&`,
    `t=$(mktemp -d) && ${writes} &&`,
    `b=/etc/firewalld.before-fluff-$(date +%Y%m%d-%H%M%S) && sudo cp -a /etc/firewalld "$b" && sudo cp -r "$t"/. /etc/firewalld/ && rm -rf "$t" &&`,
    `if out=$(sudo firewall-offline-cmd --check-config 2>&1); then`,
    `{ systemctl is-active -q firewalld && sudo firewall-cmd --reload || sudo systemctl enable --now firewalld; } && echo "Your firewall settings are back. This computer's are kept in $b.";`,
    `else sudo rm -rf /etc/firewalld && sudo mv "$b" /etc/firewalld; echo "firewalld refused them, so nothing changed. What it said:"; printf '%s\\n' "$out"; exit 1; fi`,
  ].join(" ");
}

// ── first start ──────────────────────────────────────────────────────────

/** TuxCopilot's very first start on this computer: nothing set up, nothing made yet. */
export async function isFirstStart(): Promise<boolean> {
  if ((await inv<string | null>("setting_get", { key: "welcome.done" })) !== null) return false;
  const tree = await inv<unknown[]>("tree_get");
  if (tree.length > 0) {
    await markWelcomed(); // set up before the welcome existed
    return false;
  }
  return true;
}

export const markWelcomed = () => inv("setting_set", { key: "welcome.done", value: new Date().toISOString() });

/** The welcome's "Import my penguin": Settings opens and the penguin picker with it. */
export const IMPORT_EVENT = "tuxcopilot:import-penguin";

/** What is on this computer, as moving house takes it (penguin.rs apps_here). */
export interface AppsHere {
  pacman: string[];
  aur: string[];
  flatpak: string[];
  git: Array<{ path: string; remote: string; branch: string | null }>;
  ollama: string[];
}
export const appsHere = () => inv<AppsHere>("apps_here");

/** One Apps list's share of it: the names on this computer for that source, minus what the list
 *  already saves (so nothing shows twice). github: the clones, by where they came from. */
export function hereFor(source: string, here: AppsHere | null, saved: string[]): Array<{ name: string; detail?: string }> {
  if (!here) return [];
  const mine = new Set(saved.flatMap((s) => s.split(/[\s,]+/)).map((s) => s.replace(/\.git$/, "").replace(/^https:\/\/github\.com\//, "").toLowerCase()));
  const keep = (n: string) => !mine.has(n.replace(/\.git$/, "").replace(/^https:\/\/github\.com\//, "").toLowerCase());
  switch (source) {
    case "pacman":
      return here.pacman.filter(keep).map((name) => ({ name }));
    case "yay":
      return here.aur.filter(keep).map((name) => ({ name }));
    case "flatpak":
      return here.flatpak.filter(keep).map((name) => ({ name }));
    case "ollama":
      return here.ollama.filter(keep).map((name) => ({ name }));
    case "github":
      return here.git.filter((g) => keep(g.remote)).map((g) => ({ name: g.remote.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, ""), detail: `~/${g.path}` }));
    default:
      return [];
  }
}
