// Tracked apps and links — the rules:
//
//   TRACKED = keep. A tracked app is never offered for removal on its own and never listed as
//   unused. If another app uses it, the only way to remove it is to remove that app and let it
//   fall too ("domino"); if nothing uses it, it must be untracked first.
//
//   LINK = "A uses B". Removing A asks, for everything A uses (and what those use, down the
//   chain), whether to keep it or remove it together — one choice per app. Removing B on its
//   own warns that A uses it.
//
// (Not to be confused with yay's "untracked AUR files": those are build folders of AUR
// packages that are no longer installed.)

import { inv } from "./host";

export interface Link {
  user: string; // the app that uses…
  used: string; // …this one
}

export interface Tracking {
  tracked: string[];
  links: Link[];
}

export const EMPTY: Tracking = { tracked: [], links: [] };
const KEY = "apps.tracking";

export async function loadTracking(): Promise<Tracking> {
  try {
    const raw = await inv<string | null>("setting_get", { key: KEY });
    const t = raw ? (JSON.parse(raw) as Partial<Tracking>) : {};
    return {
      tracked: Array.isArray(t.tracked) ? t.tracked.filter((x) => typeof x === "string") : [],
      links: Array.isArray(t.links) ? t.links.filter((l) => l && typeof l.user === "string" && typeof l.used === "string") : [],
    };
  } catch {
    return EMPTY;
  }
}

export async function saveTracking(t: Tracking): Promise<void> {
  await inv("setting_set", { key: KEY, value: JSON.stringify(t) });
}

// ── edits (pure: they return a new Tracking) ─────────────────────────────

const clean = (app: string) => app.trim();

export function track(t: Tracking, app: string): Tracking {
  const a = clean(app);
  return !a || t.tracked.includes(a) ? t : { ...t, tracked: [...t.tracked, a].sort() };
}

export function untrack(t: Tracking, app: string): Tracking {
  return { ...t, tracked: t.tracked.filter((x) => x !== clean(app)) };
}

/** Adds "user uses used". Throws a message the view shows when the link makes no sense. */
export function link(t: Tracking, user: string, used: string): Tracking {
  const u = clean(user);
  const d = clean(used);
  if (!u || !d) throw "Fluff needs both apps' names";
  if (u === d) throw "An app cannot use itself";
  if (t.links.some((l) => l.user === u && l.used === d)) return t;
  if (reachable(t, d).has(u)) throw `${d} already uses ${u} (directly or through other apps) — that would be a loop`;
  return { ...t, links: [...t.links, { user: u, used: d }] };
}

export function unlink(t: Tracking, user: string, used: string): Tracking {
  return { ...t, links: t.links.filter((l) => !(l.user === user && l.used === used)) };
}

// ── questions ────────────────────────────────────────────────────────────

export const uses = (t: Tracking, app: string) => t.links.filter((l) => l.user === app).map((l) => l.used);
export const usedBy = (t: Tracking, app: string) => t.links.filter((l) => l.used === app).map((l) => l.user);
export const isTracked = (t: Tracking, app: string) => t.tracked.includes(app);

/** Everything `app` uses, directly or down the chain. */
function reachable(t: Tracking, app: string): Set<string> {
  const seen = new Set<string>();
  const queue = [app];
  while (queue.length) {
    for (const next of uses(t, queue.shift()!)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

export type Gate =
  | { allowed: true }
  | { allowed: false; reason: "tracked-used"; via: string[] } // remove one of `via` instead
  | { allowed: false; reason: "tracked-alone" }; // untrack it first

/** May `app` be removed on its own? */
export function removalGate(t: Tracking, app: string): Gate {
  if (!isTracked(t, app)) return { allowed: true };
  const via = usedBy(t, app);
  return via.length ? { allowed: false, reason: "tracked-used", via } : { allowed: false, reason: "tracked-alone" };
}

export interface DominoItem {
  app: string;
  usedBy: string[]; // the apps being removed that use it
  stillUsedBy: string[]; // apps that use it and are NOT being removed — it would break them
  tracked: boolean;
}

/**
 * The domino list when `root` goes, given which linked apps the user chose to remove too.
 * Only apps used by something that IS going are asked about; choosing to keep an app also
 * keeps everything below it out of the question.
 */
export function domino(t: Tracking, root: string, chosen: ReadonlySet<string>): DominoItem[] {
  const going = new Set([root]);
  const asked: string[] = [];
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of [...going]) {
      for (const u of uses(t, g)) {
        if (u === root || asked.includes(u)) continue;
        asked.push(u);
        grew = true;
        if (chosen.has(u)) going.add(u);
      }
    }
  }
  return asked.map((app) => {
    const users = usedBy(t, app);
    return {
      app,
      usedBy: users.filter((u) => going.has(u)),
      stillUsedBy: users.filter((u) => !going.has(u)),
      tracked: isTracked(t, app),
    };
  });
}

/** The apps that go with `root`: the chosen ones the domino list still reaches. */
export function goingWith(t: Tracking, root: string, chosen: ReadonlySet<string>): string[] {
  return domino(t, root, chosen)
    .map((d) => d.app)
    .filter((a) => chosen.has(a));
}
