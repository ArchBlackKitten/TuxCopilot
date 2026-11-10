// Security → System, as levels (levels.ts): the kernel's own protections, Fluff's weekly checkup,
// and your system files' fingerprints.
//                 the kernel     the weekly checkup   fingerprints
//   As it comes   usual values   off                  not changed
//   Good security Recommended    off                  recorded
//   Secured       Recommended    on                   recorded
//   Hardened      Strict         on                   recorded
// Recording the fingerprints is a change in your list, saved when you Apply — like every record of
// Fluff's (filecheck.ts) — so a level counts them only once they are applied.

import type { Fingerprint, Recorded } from "./filecheck";
import { record } from "./filecheck";
import type { Preset } from "./hardening";
import { presetChanges, presetCommand, presetNow, SETTINGS } from "./hardening";
import type { WeeklyState } from "./weekly";
import { weeklyOffCommand, weeklyOnCommand } from "./weekly";
import { levelLabel, levelOf, type Level, type LevelCard } from "./levels";

export interface SystemNow {
  kernel: { values: Record<string, string | null>; fileThere: boolean };
  weekly: WeeklyState;
  recorded: Recorded | null;
  recordWaiting: boolean; // a record waits in your changes for Apply
}

type Parts = { kernel: Preset; weekly: "on" | "off"; fingerprints?: "recorded" };

export const PARTS: Record<Level, Parts> = {
  arch: { kernel: "usual", weekly: "off" },
  good: { kernel: "recommended", weekly: "off", fingerprints: "recorded" },
  secured: { kernel: "recommended", weekly: "on", fingerprints: "recorded" },
  hardened: { kernel: "strict", weekly: "on", fingerprints: "recorded" },
};

export const systemLevel = (n: SystemNow): Level | null =>
  levelOf({ kernel: presetNow(n.kernel.values, n.kernel.fileThere), weekly: n.weekly.on ? "on" : "off", fingerprints: n.recorded ? "recorded" : null }, PARTS);

export function systemCards(n: SystemNow): LevelCard[] {
  const rec = presetChanges(n.kernel.values, "recommended").length;
  const strictOnly = SETTINGS.filter((s) => s.strict !== s.recommended);
  const noWeekly = n.weekly.exe ? undefined : "Fluff can't name this TuxCopilot in a timer (it isn't installed where a timer can start it), so the weekly checkup can't be switched on.";
  const fp = n.recorded ? "your system files' fingerprints: already recorded" : "your system files' fingerprints recorded (in your changes: saved when you Apply)";
  return [
    {
      id: "arch",
      what: "As Arch and CachyOS come.",
      sets: ["the kernel: its usual values (TuxCopilot's settings file removed; some values come back only at the next restart)", "the weekly checkup: off", "your fingerprints: not changed"],
      caution: null,
    },
    {
      id: "good",
      what: "Every protection of the kernel's that costs nothing on a desktop, and a record of your system files, so a later change shows.",
      sets: [`the kernel: Recommended${rec ? ` (${rec} setting${rec === 1 ? "" : "s"} change)` : ""}`, "the weekly checkup: off", fp],
      caution: null,
    },
    {
      id: "secured",
      what: "Good security, and Fluff looks at your system once a week even with TuxCopilot closed — it only reads, and tells you only when something needs you.",
      sets: ["the kernel: Recommended", "the weekly checkup: on (a timer of yours, no password)", fp],
      caution: null,
      unavailable: noWeekly,
    },
    {
      id: "hardened",
      what: "The strictest the kernel offers, on top of Secured.",
      sets: [`the kernel: Strict — ${strictOnly.map((s) => s.key).join(", ")} too`, "the weekly checkup: on", fp],
      caution: strictOnly.map((s) => s.cost).join(" "),
      unavailable: noWeekly,
    },
  ];
}

/** The command that sets a level's kernel and weekly checkup from how they are now. */
export function systemCommand(to: Level, n: SystemNow): string {
  const want = PARTS[to];
  const steps: string[] = [];
  if (presetNow(n.kernel.values, n.kernel.fileThere) !== want.kernel) steps.push(presetCommand(want.kernel));
  if (want.weekly === "on" && !n.weekly.on) {
    if (!n.weekly.exe) throw new Error("Fluff can't name this TuxCopilot in a timer, so the weekly checkup can't be switched on.");
    steps.push(weeklyOnCommand(n.weekly.exe));
  }
  if (want.weekly === "off" && (n.weekly.on || n.weekly.files)) steps.push(weeklyOffCommand());
  return steps.join(" && ");
}

/** Choosing a level: its commands, then the fingerprints' record put in your changes (it waits for Apply). */
export async function applySystem(
  to: Level,
  n: SystemNow,
  d: {
    run: (label: string, command: string) => Promise<string | null>;
    fingerprints: () => Promise<Fingerprint[]>;
    stage: (c: { kind: "files.recorded"; label: string; value: Recorded }) => void;
  },
): Promise<"done" | "failed"> {
  const command = systemCommand(to, n);
  if (command && (await d.run(`System: ${levelLabel(to)}`, command))) return "failed";
  if (PARTS[to].fingerprints && !n.recorded && !n.recordWaiting) {
    const now = await d.fingerprints();
    d.stage({ kind: "files.recorded", label: `Fluff's fingerprints: ${now.length} files recorded`, value: record(now) });
  }
  return "done";
}
