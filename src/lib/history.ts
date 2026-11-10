// One history: each run that changed the system carries its own snapshot pair, with
// "What it changed" and "Undo this change" beside it. The pair is found by what both share: its
// label is the run's own (snapshot.ts snapshotLabel), and the after-snapshot is taken while the run
// is going. A pair whose run is no longer among the last 50 is still listed, on its own; nothing is
// ever left out.

import type { RemovedApp, RunLogRow } from "./api";
import { snapshotLabel, type FluffSnapshot } from "./snapshot";

export type RunRow = Pick<RunLogRow, "id" | "label" | "status" | "dryRun" | "createdAt" | "updatedAt">;
export type Removal = RemovedApp & { back?: true };
export type Pair = FluffSnapshot & { unfinished: boolean; base: string }; // base: the label without "(not finished)"

export type Entry =
  | { kind: "run"; at: string; run: RunRow; pair: Pair | null }
  | { kind: "pair"; at: string; pair: Pair } // its run is no longer among the last 50
  | { kind: "removed"; at: string; removal: Removal };

const NOT_FINISHED = " (not finished)";
export const asPair = (s: FluffSnapshot): Pair => ({ ...s, unfinished: s.label.endsWith(NOT_FINISHED), base: s.label.endsWith(NOT_FINISHED) ? s.label.slice(0, -NOT_FINISHED.length) : s.label });

/** The after-snapshot's time ("2026-11-05T10:00:00", this computer's own clock) in milliseconds. */
const localMs = (when: string): number => (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(when) ? new Date(when).getTime() : NaN);

/** A run's pair: the same label, and taken while it ran — the after-snapshot is taken inside its own
 *  run, written to the second (so it can read as a moment before the run's start). Each pair goes to
 *  one run, each run has one at most; a pair no run holds (an interrupted run's, or one older than
 *  the last 50) is listed on its own. */
export function joinHistory(runs: RunRow[], snaps: FluffSnapshot[], removed: Removal[]): Entry[] {
  const pairs = snaps.map(asPair);
  const pairOf = new Map<RunRow, Pair>();
  const alone: Pair[] = [];
  for (const p of pairs) {
    const t = localMs(p.when);
    const holds = (r: RunRow) => t >= Math.floor(Date.parse(r.createdAt) / 1000) * 1000 && t <= Date.parse(r.updatedAt);
    const fits = runs.filter((r) => !r.dryRun && !pairOf.has(r) && p.base === snapshotLabel(r.label) && holds(r));
    if (fits.length) pairOf.set(fits[0], p); // runs come newest first (runs_list), and never overlap
    else alone.push(p);
  }
  const entries: Entry[] = runs.map((run) => ({ kind: "run", at: run.createdAt, run, pair: pairOf.get(run) ?? null }));
  for (const p of alone) entries.push({ kind: "pair", at: Number.isNaN(localMs(p.when)) ? "" : new Date(localMs(p.when)).toISOString(), pair: p });
  for (const removal of removed) entries.push({ kind: "removed", at: removal.noticedAt, removal });
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}
