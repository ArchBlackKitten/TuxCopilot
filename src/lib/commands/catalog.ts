// The command catalogue (catalog.json): what each everyday command does, how it is used, its
// options, the words people search with, what it is often used with and what needs it. The
// explainer, the search and each command's own page all read it.

import data from "./catalog.json";

export interface CommandDoc {
  name: string;
  pkg: string;
  group: string;
  what: string;
  usage: string;
  words: string[];
  examples: Array<{ command: string; meaning: string }>;
  options: Array<{ token: string; meaning: string }>;
  caution?: string;
  oftenWith: string[];
  neededBy: string[];
}

export const CATALOG: CommandDoc[] = (data as { commands: CommandDoc[] }).commands;
const BY_NAME = new Map(CATALOG.map((c) => [c.name, c]));

/** What you added through "Ask AI to refresh" (kept in the setting commands.added, so it moves
 *  house with Fluff): more for commands the catalogue has, and commands it didn't have. Only
 *  ever adds: what the catalogue already says is never replaced. */
export interface CatalogueAdditions {
  refreshed: Record<string, { options?: CommandDoc["options"]; examples?: CommandDoc["examples"]; caution?: string; words?: string[] }>;
  added: CommandDoc[];
}
export const NO_ADDITIONS: CatalogueAdditions = { refreshed: {}, added: [] };

let version = 0;
/** Bumped by every merge, so what caches the catalogue (the search) knows to look again. */
export const catalogueVersion = () => version;

const PLAIN_NAME = /^[a-z0-9][a-z0-9._+-]{0,63}$/;
const pair = (x: unknown, a: string, b: string) =>
  typeof x === "object" && x !== null && typeof (x as Record<string, unknown>)[a] === "string" && typeof (x as Record<string, unknown>)[b] === "string";

/** A command the AI proposed, if it has every field a page needs (and a plain name). */
export function validCommand(x: unknown): CommandDoc | null {
  if (typeof x !== "object" || x === null) return null;
  const c = x as Record<string, unknown>;
  const str = (k: string) => typeof c[k] === "string" && (c[k] as string).trim() !== "";
  const strs = (k: string) => c[k] === undefined || (Array.isArray(c[k]) && (c[k] as unknown[]).every((v) => typeof v === "string"));
  const pairs = (k: string, a: string, b: string) => Array.isArray(c[k]) && (c[k] as unknown[]).every((v) => pair(v, a, b));
  if (!str("name") || !PLAIN_NAME.test(c.name as string) || !str("pkg") || !str("group") || !str("what") || !str("usage")) return null;
  if (!strs("words") || !strs("oftenWith") || !strs("neededBy") || !pairs("examples", "command", "meaning") || !pairs("options", "token", "meaning")) return null;
  if (c.caution !== undefined && typeof c.caution !== "string") return null;
  return {
    name: c.name as string, pkg: c.pkg as string, group: c.group as string, what: c.what as string, usage: c.usage as string,
    words: (c.words as string[]) ?? [], examples: c.examples as CommandDoc["examples"], options: c.options as CommandDoc["options"],
    ...(c.caution ? { caution: c.caution as string } : {}),
    oftenWith: (c.oftenWith as string[]) ?? [], neededBy: (c.neededBy as string[]) ?? [],
  };
}

/** Puts your additions into the live catalogue. Safe to run twice: anything already there is skipped. */
export function mergeAdditions(a: CatalogueAdditions): void {
  for (const raw of a.added ?? []) {
    const c = validCommand(raw);
    if (!c || BY_NAME.has(c.name)) continue;
    CATALOG.push(c);
    BY_NAME.set(c.name, c);
  }
  for (const [name, r] of Object.entries(a.refreshed ?? {})) {
    const doc = BY_NAME.get(name);
    if (!doc) continue;
    for (const o of r.options ?? []) if (pair(o, "token", "meaning") && !doc.options.some((x) => x.token === o.token)) doc.options.push(o);
    for (const e of r.examples ?? []) if (pair(e, "command", "meaning") && !doc.examples.some((x) => x.command === e.command)) doc.examples.push(e);
    for (const w of r.words ?? []) if (typeof w === "string" && !doc.words.includes(w)) doc.words.push(w);
    if (typeof r.caution === "string" && r.caution && !doc.caution) doc.caution = r.caution;
  }
  version++;
}

/** Two sets of additions as one (the newer adds to the older; nothing is dropped). */
export function joinAdditions(old: CatalogueAdditions, more: CatalogueAdditions): CatalogueAdditions {
  const refreshed = structuredClone(old.refreshed ?? {});
  for (const [name, r] of Object.entries(more.refreshed ?? {})) {
    const t = (refreshed[name] ??= {});
    if (r.options) t.options = [...(t.options ?? []), ...r.options.filter((o) => !t.options?.some((x) => x.token === o.token))];
    if (r.examples) t.examples = [...(t.examples ?? []), ...r.examples.filter((e) => !t.examples?.some((x) => x.command === e.command))];
    if (r.words) t.words = [...new Set([...(t.words ?? []), ...r.words])];
    if (r.caution && !t.caution) t.caution = r.caution;
  }
  const added = [...(old.added ?? [])];
  for (const c of more.added ?? []) if (!added.some((x) => x.name === c.name)) added.push(c);
  return { refreshed, added };
}

export const commandDoc = (name: string): CommandDoc | undefined => BY_NAME.get(name);

/** What a command is often used with: its own list, and every command that lists it. */
export function usedWith(name: string): string[] {
  const own = BY_NAME.get(name)?.oftenWith ?? [];
  const back = CATALOG.filter((c) => c.oftenWith.includes(name)).map((c) => c.name);
  return [...new Set([...own, ...back])].filter((n) => n !== name);
}

/** Both directions: the commands that need this one, and the ones this one needs. */
export function needs(name: string): { neededBy: string[]; needs: string[] } {
  return {
    neededBy: BY_NAME.get(name)?.neededBy ?? [],
    needs: CATALOG.filter((c) => c.neededBy.includes(name)).map((c) => c.name),
  };
}

/** Groups in the order a beginner meets them (a group you added comes last). */
export const groups = () => [...new Set(CATALOG.map((c) => c.group))];
