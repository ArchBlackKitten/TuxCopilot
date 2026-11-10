// Safe updates: the steps Fluff walks you through before `pacman -Syu` — read the Arch news
// that came out since your last update (some ask you to do something by hand first), make
// sure a snapshot is taken, check the mirrors are fresh, and look at AUR packages before yay
// builds them (an orphaned, flagged or brand-new AUR package is worth a closer look).

import { httpGet, inv } from "./host";

export interface Update {
  name: string;
  from: string;
  to: string;
}

export interface UpdatesFacts {
  repo: Update[] | null;
  repoError: string | null;
  aur: Update[] | null;
  lastUpgrade: string | null; // pacman.log time: 2026-10-24T13:06:34+0000
  btrfs: boolean;
  snapperRoot: boolean;
  snapPac: boolean;
  limineSnapper: boolean;
  mirrorlistDays: number | null;
  reflector: boolean;
  reflectorTimer: boolean;
  cachyosMirrors?: boolean; // CachyOS's cachyos-rate-mirrors (updates.rs; absent: plain Arch)
  cachyosMirrorsTimer?: boolean;
}

export const updatesFacts = () => inv<UpdatesFacts>("updates_facts");

export const UPDATE_REPO = "sudo pacman -Syu";
export const UPDATE_ALL = "yay -Syu";

/** pacman.log's "+0000" has no colon; Date wants one. */
export const logTime = (t: string | null): number | null => {
  if (!t) return null;
  const ms = Date.parse(t.replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  return Number.isNaN(ms) ? null : ms;
};

// ── Arch news ────────────────────────────────────────────────────────────

export interface News {
  title: string;
  link: string;
  date: number; // ms
  text: string; // the description, as plain text
  byHand: boolean; // asks you to do something yourself
}

const unescape = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const plain = (html: string) =>
  unescape(unescape(html).replace(/<\/p>\s*/g, "\n").replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
const tag = (item: string, t: string) => item.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1] ?? "";

/** Words the Arch team uses when an update needs you to act. */
export const BY_HAND = /manual intervention|requires? (?:manual|user) (?:action|intervention)|before upgrading|you (?:will )?need to|must be (?:done|run)|action required/i;

/** The news feed (RSS) → items, newest first. */
export function parseNews(xml: string): News[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .map(([, item]) => {
      const title = plain(tag(item, "title"));
      const text = plain(tag(item, "description"));
      return { title, link: unescape(tag(item, "link")).trim(), date: Date.parse(tag(item, "pubDate")), text, byHand: BY_HAND.test(title) || BY_HAND.test(text) };
    })
    .filter((n) => n.title && !Number.isNaN(n.date))
    .sort((a, b) => b.date - a.date);
}

/** The news since your last full update (all of the last 30 days if there was none). */
export function newsSince(items: News[], lastUpgrade: string | null, now = Date.now()): News[] {
  const since = logTime(lastUpgrade) ?? now - 30 * 86_400_000;
  return items.filter((n) => n.date > since);
}

export async function archNews(): Promise<News[] | null> {
  const r = await httpGet("https://archlinux.org/feeds/news/", { "User-Agent": "tuxcopilot/0.1 (local system manager app)", Accept: "application/rss+xml" }, 10_000);
  return r?.ok ? parseNews(r.text) : null;
}

// ── AUR safety ───────────────────────────────────────────────────────────

export interface AurInfo {
  Name: string;
  Maintainer: string | null;
  NumVotes: number;
  Popularity: number;
  OutOfDate: number | null; // seconds
  FirstSubmitted: number; // seconds
  LastModified: number; // seconds
  URL?: string | null;
}

export interface AurLook {
  name: string;
  level: "ok" | "look" | "careful";
  why: string[]; // plain words; empty when nothing stands out
  page: string;
}

const DAY = 86_400;

/** What stands out about an AUR package, in plain words. `info` undefined: not in the AUR. */
export function aurLook(name: string, info: AurInfo | undefined, nowSec = Date.now() / 1000): AurLook {
  const page = `https://aur.archlinux.org/packages/${encodeURIComponent(name)}`;
  if (!info) return { name, level: "careful", why: ["not in the AUR any more (removed or renamed): nobody looks after it"], page };
  const why: string[] = [];
  let careful = false;
  if (!info.Maintainer) {
    why.push("orphaned: it has no maintainer, so nobody checks new versions");
    careful = true;
  }
  if (nowSec - info.FirstSubmitted < 30 * DAY) {
    why.push(`new: first put on the AUR ${Math.max(1, Math.round((nowSec - info.FirstSubmitted) / DAY))} days ago`);
    careful = true;
  }
  if (info.OutOfDate) why.push(`flagged out of date ${Math.max(1, Math.round((nowSec - info.OutOfDate) / DAY))} days ago`);
  if (info.NumVotes < 5) why.push(`few people use it (${info.NumVotes} vote${info.NumVotes === 1 ? "" : "s"})`);
  return { name, level: careful ? "careful" : why.length ? "look" : "ok", why, page };
}

/** The AUR's own facts for these packages (at most 100 per question). */
export async function aurInfo(names: string[]): Promise<Map<string, AurInfo> | null> {
  const out = new Map<string, AurInfo>();
  for (let i = 0; i < names.length; i += 100) {
    const q = names.slice(i, i + 100).map((n) => `arg[]=${encodeURIComponent(n)}`).join("&");
    const r = await httpGet(`https://aur.archlinux.org/rpc/v5/info?${q}`, { "User-Agent": "tuxcopilot/0.1 (local system manager app)", Accept: "application/json" }, 10_000);
    if (!r?.ok) return null;
    try {
      for (const p of (JSON.parse(r.text) as { results?: AurInfo[] }).results ?? []) out.set(p.Name, p);
    } catch {
      return null;
    }
  }
  return out;
}

/** The safety look for each name (worst first); null when the AUR didn't answer. */
export async function aurSafety(names: string[]): Promise<AurLook[] | null> {
  if (!names.length) return [];
  const info = await aurInfo(names);
  if (!info) return null;
  const rank = { careful: 0, look: 1, ok: 2 } as const;
  return names.map((n) => aurLook(n, info.get(n))).sort((a, b) => rank[a.level] - rank[b.level] || a.name.localeCompare(b.name));
}

// ── what Fluff recommends ────────────────────────────────────────────────

export interface Step {
  id: "news" | "snapshot" | "mirrors" | "aur";
  level: "ok" | "info" | "warn" | "bad";
  title: string;
  detail: string;
  fix?: { label: string; command: string };
  link?: { label: string; url: string };
}

export const SNAPPER_SETUP = "sudo pacman -Syu --needed snapper snap-pac && sudo snapper -c root create-config /";
// your list is kept beside it first, like a torrc or a .pacnew's "use the new one"
export const MIRRORLIST = "/etc/pacman.d/mirrorlist";
export const MIRRORS_NOW = `b=${MIRRORLIST}.before-fluff-$(date +%Y%m%d-%H%M%S) && sudo cp -a -- ${MIRRORLIST} "$b" && sudo reflector --latest 20 --protocol https --sort rate --save ${MIRRORLIST} && echo "Fluff kept your old list as $b"`;
export const MIRRORS_WEEKLY = "sudo systemctl enable --now reflector.timer";
// On CachyOS its own tool, never reflector: it ranks all the
// lists — Arch's, with CachyOS's own fast Arch mirror first, and CachyOS's — and keeps a copy of
// each (<list>-backup); reflector would rewrite Arch's alone and drop that mirror.
export const CACHYOS_MIRRORS_NOW = "sudo cachyos-rate-mirrors";
export const CACHYOS_MIRRORS_WEEKLY = "sudo systemctl enable --now cachyos-rate-mirrors.timer";
export const REFLECTOR_TIMER_OFF = "sudo systemctl disable --now reflector.timer";

/** The steps before an update, in order, each with what Fluff found. */
export function steps(f: UpdatesFacts, news: News[] | null, aur: AurLook[] | null): Step[] {
  const out: Step[] = [];
  const since = news && newsSince(news, f.lastUpgrade);
  if (since === null)
    out.push({ id: "news", level: "info", title: "Fluff couldn't read the Arch news", detail: "No network, or archlinux.org didn't answer. Read it before updating:", link: { label: "archlinux.org/news", url: "https://archlinux.org/news/" } });
  else if (since.some((n) => n.byHand))
    out.push({ id: "news", level: "bad", title: "Read the news first: an update asks you to do something by hand", detail: "Do what the news below says before (or while) you update — it is how Arch keeps an update from breaking." });
  else if (since.length)
    out.push({ id: "news", level: "warn", title: `${since.length} news item${since.length === 1 ? "" : "s"} since your last update`, detail: "Nothing in them asks for work by hand, but they are worth a read." });
  else out.push({ id: "news", level: "ok", title: "No Arch news since your last update", detail: "" });

  if (f.btrfs && f.snapperRoot && f.snapPac)
    out.push({
      id: "snapshot",
      level: "ok",
      title: "A snapshot is taken before every update",
      detail: `snap-pac makes one before and one after each pacman run${f.limineSnapper ? ", and limine-snapper-sync lists them in the boot menu, so you can start a snapshot if an update goes wrong" : ""}.`,
    });
  else if (f.btrfs)
    out.push({
      id: "snapshot",
      level: "warn",
      title: f.snapperRoot ? "Snapshots are set up, but not taken by updates" : "Your disk can take snapshots, but none are set up",
      detail: f.snapperRoot
        ? "snap-pac makes snapper take a snapshot before and after every update."
        : "Your system is on btrfs: a snapshot before each update lets you go back if one breaks something. snapper takes them, snap-pac makes every update take one. If your install made a /.snapshots folder already (archinstall does), the setup needs one more step: the Arch wiki's Snapper page shows it.",
      fix: { label: f.snapperRoot ? "Install snap-pac" : "Set up snapper", command: f.snapperRoot ? "sudo pacman -Syu --needed snap-pac" : SNAPPER_SETUP },
      link: { label: "Arch wiki: Snapper", url: "https://wiki.archlinux.org/title/Snapper" },
    });
  else
    out.push({
      id: "snapshot",
      level: "info",
      title: "No snapshots (your system is not on btrfs)",
      detail: "Snapshots need btrfs. Keep a copy of your own files instead, and of /etc if you change settings there.",
    });

  out.push(mirrorsStep(f));

  if (f.aur?.length) {
    const careful = aur?.filter((a) => a.level === "careful") ?? [];
    out.push(
      aur === null
        ? { id: "aur", level: "info", title: "Fluff couldn't ask the AUR about your AUR updates", detail: "Look at each package's AUR page before yay builds it." }
        : careful.length
          ? { id: "aur", level: "warn", title: `${careful.length} AUR update${careful.length === 1 ? "" : "s"} to look at closely`, detail: `${careful.map((a) => a.name).join(", ")} — see why below. AUR packages are made by users, not Arch. When yay asks "Diffs to show?", type A: it shows what changed in each build recipe (PKGBUILD) — what it downloads and runs.` }
          : { id: "aur", level: "ok", title: "Nothing stands out about your AUR updates", detail: `Each still comes from a user, not Arch: when yay asks "Diffs to show?", type A to see what changed in each build recipe (PKGBUILD).` },
    );
  }
  return out;
}

/** The mirror lists: fresh, and kept fresh by the right tool — CachyOS's own on CachyOS, reflector on Arch. */
export function mirrorsStep(f: UpdatesFacts): Step {
  const days = f.mirrorlistDays;
  const old = days !== null && days > 30;
  const age = days === null ? "Fluff couldn't read the mirror list's age" : old ? `Your mirror list is ${days} days old` : `Your mirror list is fresh (${days} day${days === 1 ? "" : "s"} old)`;
  if (f.cachyosMirrors) {
    // two tools rewriting the same list: reflector's would undo CachyOS's
    if (f.reflectorTimer)
      return {
        id: "mirrors",
        level: "warn",
        title: "Two tools rewrite your mirror list",
        detail: "reflector's weekly timer and CachyOS's cachyos-rate-mirrors both write it, and reflector's list leaves out CachyOS's own fast Arch mirror. On CachyOS, its own tool is the one to keep: switch reflector's timer off.",
        fix: { label: "Switch reflector's timer off", command: REFLECTOR_TIMER_OFF },
      };
    const what = "CachyOS's cachyos-rate-mirrors ranks all your lists — Arch's, with CachyOS's own fast mirror first, and CachyOS's — and keeps a copy of each (…-backup).";
    if (old) return { id: "mirrors", level: "warn", title: age, detail: `Old mirrors can be slow or behind (updates fail with 404). ${what}`, fix: { label: "Fresh mirrors now", command: CACHYOS_MIRRORS_NOW } };
    if (!f.cachyosMirrorsTimer) return { id: "mirrors", level: "ok", title: age, detail: `${what} Its timer is off: it keeps them fresh by itself.`, fix: { label: "Every week", command: CACHYOS_MIRRORS_WEEKLY } };
    return { id: "mirrors", level: "ok", title: age, detail: "CachyOS's cachyos-rate-mirrors keeps them fresh by itself (its timer is on)." };
  }
  if (old)
    return {
      id: "mirrors",
      level: "warn",
      title: age,
      detail: "Old mirrors can be slow or behind (updates fail with 404). reflector picks fresh, fast ones; its timer does it every week.",
      fix: f.reflector ? { label: "Fresh mirrors now", command: MIRRORS_NOW } : { label: "Install reflector", command: "sudo pacman -Syu --needed reflector" },
    };
  return { id: "mirrors", level: "ok", title: age, detail: f.reflector && !f.reflectorTimer ? "reflector's weekly timer is off: it keeps the list fresh by itself." : "", fix: f.reflector && !f.reflectorTimer ? { label: "Every week", command: MIRRORS_WEEKLY } : undefined };
}

