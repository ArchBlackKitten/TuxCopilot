// The template for all security: Tor's levels, and always a way back to Arch's own settings. Each
// sub-section of Security gets one row of cards in Tor's shape (tor.ts PRESETS):
// what it does in plain words, what it sets, line by line, and what it costs. Four levels:
//   As it comes    Arch's own settings — always the way back
//   Good security  Fluff recommends it: protection that costs nothing you'd notice
//   Secured        more, with small costs said
//   Hardened       the strictest, its costs said plainly
// A level is exact, like Tor's presets: choosing one sets each thing its card lists. Where nothing
// matches one exactly (you chose in the panels below), no card says "now".

export type Level = "arch" | "good" | "secured" | "hardened";

export const LEVELS: Array<{ id: Level; label: string }> = [
  { id: "arch", label: "As it comes" },
  { id: "good", label: "Good security" },
  { id: "secured", label: "Secured" },
  { id: "hardened", label: "Hardened" },
];
export const RECOMMENDED: Level = "good";
export const levelLabel = (l: Level): string => LEVELS.find((x) => x.id === l)!.label;

export interface LevelCard {
  id: Level;
  what: string; // in plain words
  sets: string[]; // every thing it sets, said plainly
  caution: string | null; // what it costs
  unavailable?: string; // why it can't be chosen on this computer
}

/** The level a reading is at: the first whose every part matches, or null (a mix). A part not read
 *  (null) is never a level's value, so it never matches. */
export function levelOf<P extends Record<string, unknown>>(now: { [K in keyof P]: P[K] | null }, parts: Record<Level, P>): Level | null {
  return (
    LEVELS.map((l) => l.id).find((l) => Object.entries(parts[l]).every(([k, v]) => now[k as keyof P] === v)) ?? null
  );
}
