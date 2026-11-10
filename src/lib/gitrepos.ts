// Git clones in your home (read by gitrepos.rs): used or unused — something running from it
// now, or touched in the last 30 days, the same window as "Fully unused" — and what removing
// one would lose. Your own projects (they hold your commits) are listed, never offered for
// removal.

import { inv } from "./host";

export interface Repo {
  path: string;
  name: string;
  size: number;
  remote: string | null;
  lastCommit: number | null;
  lastTouched: number;
  running: number[];
  uncommitted: number | null;
  unpushed: number | null;
  yours: boolean;
  holdsHome: boolean; // your home folder, or one above it: never removed
}

/** Searched: home's own clones, ~/git ~/src ~/repos ~/github ~/code ~/clones, and `added`. */
export const gitRepos = (added: string[]) => inv<Repo[]>("git_repos", { added });
export const USUAL_FOLDERS = ["~/git", "~/src", "~/repos", "~/github", "~/code", "~/clones"];

export async function getGitDirs(): Promise<string[]> {
  try {
    const raw = await inv<string | null>("setting_get", { key: "git.dirs" });
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.startsWith("/")) : [];
  } catch {
    return [];
  }
}

export async function saveGitDirs(dirs: string[]): Promise<void> {
  await inv("setting_set", { key: "git.dirs", value: JSON.stringify(dirs) });
}

export const pickFolder = () => inv<string | null>("pick_folder");

export const UNUSED_DAYS = 30;

export function usage(r: Repo, nowSec = Date.now() / 1000): { used: boolean; text: string } {
  if (r.running.length) return { used: true, text: `in use now (${r.running.length} process${r.running.length === 1 ? "" : "es"})` };
  const days = Math.floor((nowSec - r.lastTouched) / 86400);
  if (days < UNUSED_DAYS) return { used: true, text: days === 0 ? "used today" : `used ${days} day${days === 1 ? "" : "s"} ago` };
  return { used: false, text: `unused for ${days} days` };
}

/** Why removing it would lose something — or null when nothing but the download goes. */
export function wouldLose(r: Repo): string | null {
  if (r.yours) return "it is your own project";
  if (r.running.length) return "something is running from it right now";
  if (r.uncommitted === null) return "git did not answer about its changes";
  if (r.uncommitted > 0) return `${r.uncommitted} changed file${r.uncommitted === 1 ? "" : "s"} were never committed`;
  if (r.unpushed && r.unpushed > 0) return `${r.unpushed} commit${r.unpushed === 1 ? "" : "s"} exist only here`;
  return null;
}

const q = (p: string) => {
  if (/['\n]/.test(p) || !p.startsWith("/")) throw new Error(`unusual path: ${p}`);
  return `'${p}'`;
};

export const updateCommand = (r: Repo) => `git -C ${q(r.path)} pull --ff-only`;

/** Never offered at all: your own projects, and clones something runs from right now. */
export function cannotRemove(r: Repo): string | null {
  if (r.holdsHome || r.path === "/" || r.path.split("/").filter(Boolean).length < 2) return "it is your home folder, or holds it — removing it would remove everything of yours";
  if (r.yours) return "it is your own project";
  if (r.running.length) return "something is running from it right now — stop it first";
  return null;
}

/** `anyway`: you chose to lose what wouldLose names (changed files, unpushed commits). */
export function removeCommand(r: Repo, anyway = false): string {
  const never = cannotRemove(r);
  if (never) throw new Error(`not removed: ${never}`);
  const why = wouldLose(r);
  if (why && !anyway) throw new Error(`not removed: ${why}`);
  return `rm -rf ${q(r.path)}`;
}

/** https link to where it was cloned from (git@github.com:a/b.git → https://github.com/a/b). */
export function webUrl(remote: string | null): string | null {
  if (!remote) return null;
  const ssh = remote.match(/^git@([^:]+):(.+?)(\.git)?$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  return /^https:\/\//.test(remote) ? remote.replace(/\.git$/, "") : null;
}
