// A level that slips. Choosing a level in a Security
// sub-section, once its commands ended well, also puts "Fluff watches for it" in your changes; Apply
// saves it in your locked database (security.chosen), and gives the weekly checkup — which opens no
// database — its fingerprints (marks.rs). Later, when the level read now is another one, the
// sub-section says so and puts it back with one button (only what differs runs, like any choice).
// As it comes is the way back, not a level to keep: choosing it stops the watching.

import { inv } from "./host";
import { levelLabel, type Level } from "./levels";
import type { Change } from "./changes";

export type SecurityArea = "network" | "devices" | "accounts" | "system";
export const AREA_NAMES: Record<SecurityArea, string> = { network: "Network", devices: "Devices", accounts: "Accounts & login", system: "System" }; // marks.rs AREAS
export const WATCHED: Level[] = ["good", "secured", "hardened"]; // marks.rs WATCHED

export interface ChosenLevel {
  level: Level;
  when: string; // ISO
}
export type Chosen = Partial<Record<SecurityArea, ChosenLevel>>;
export const CHOSEN_KEY = "security.chosen";

export async function getChosen(): Promise<Chosen> {
  try {
    const raw = await inv<string | null>("setting_get", { key: CHOSEN_KEY });
    return raw ? (JSON.parse(raw) as Chosen) : {};
  } catch {
    return {};
  }
}

/** What Apply saves: this choice joined in; As it comes takes the sub-section out. */
export function withChosen(saved: Chosen, area: SecurityArea, level: Level, when: string): Chosen {
  const next = { ...saved };
  if (WATCHED.includes(level)) next[area] = { level, when };
  else delete next[area];
  return next;
}

/** The change put in your list when a level was chosen and ended well (current: chosenFor); null when nothing would change. */
export function chosenChange(area: SecurityArea, level: Level, current: ChosenLevel | null): Extract<Change, { kind: "security.chosen" }> | null {
  const watched = WATCHED.includes(level);
  if (watched ? current?.level === level : !current) return null;
  const label = watched ? `Security → ${AREA_NAMES[area]}: Fluff watches that it stays ${levelLabel(level)}` : `Security → ${AREA_NAMES[area]}: Fluff stops watching its level`;
  return { kind: "security.chosen", label, area, level };
}

/** The level that counts for a sub-section: one waiting in your changes, else the saved one. */
export function chosenFor(area: SecurityArea, saved: Chosen, pending: Change[]): ChosenLevel | null {
  const waiting = pending.filter((c): c is Extract<Change, { kind: "security.chosen" }> => c.kind === "security.chosen" && c.area === area).pop();
  if (waiting) return WATCHED.includes(waiting.level) ? { level: waiting.level, when: "" } : null;
  return saved[area] ?? null;
}

/** When you changed it yourself, in a panel of that sub-section. */
export const changedHereLabel = (area: SecurityArea, was: Level) => `Security → ${AREA_NAMES[area]}: you changed it here, so Fluff stops watching that it stays ${levelLabel(was)}`;

const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "");

/** Said above the cards when the level read now isn't the one you chose (undefined: still looking). */
export function slipWords(chosen: ChosenLevel | null, now: Level | null | undefined): string | null {
  if (!chosen || now === undefined || now === chosen.level) return null;
  const when = day(chosen.when);
  return `You chose ${levelLabel(chosen.level)}${when ? ` on ${when}` : ""}, and now it is ${now ? levelLabel(now) : "a mix of your own"}. Something changed it: an update, another program, or a change by hand. The panels below say what each part is now.`;
}

/** For the weekly checkup's fingerprints: the saved sub-sections whose level still holds. */
export function holding(saved: Chosen, now: Partial<Record<SecurityArea, Level | null | undefined>>): Partial<Record<SecurityArea, Level>> {
  const out: Partial<Record<SecurityArea, Level>> = {};
  for (const [area, c] of Object.entries(saved) as Array<[SecurityArea, ChosenLevel]>) if (c && now[area] === c.level) out[area] = c.level;
  return out;
}

/** The weekly checkup's fingerprints taken again for the levels that still hold (so a harmless
 *  change isn't said every week). Like arch-sync's cache, this is TuxCopilot learning the machine,
 *  not an edit of yours: the levels themselves change only through Apply. Rust writes only on a change. */
export const refreshMarks = (levels: Partial<Record<SecurityArea, Level>>) =>
  Object.keys(levels).length ? inv("security_marks_save", { levels }).catch(() => {}) : Promise.resolve();
