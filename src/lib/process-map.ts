// App Manager — process → app mapping.
//
// `ps -eo comm=` truncates the command name to 15 characters, so the map
// contains the truncated forms users actually see on a running system
// (e.g. "telegram-deskt" for telegram-desktop). Everything that clearly
// belongs to the OS / this app itself is in NOISE so it never pollutes
// the usage log.

export interface ProcessMapEntry {
  app: string; // display name (usually the package name)
  source: "pacman" | "aur" | "flatpak" | "git" | "other";
}

// The table itself lives in process-map.json, so the Rust sampler (src-tauri/src/usage.rs)
// reads the very same data — one map, two readers, no drift.
import TABLE from "./process-map.json";

/** Binary / comm name → app. Keys must match `ps comm` output (≤15 chars, lowercase). */
export const PROCESS_MAP: Record<string, ProcessMapEntry> = TABLE.map as Record<string, ProcessMapEntry>;

/** Processes that belong to the OS, the desktop, shells, or this app itself. */
export const NOISE_EXACT = new Set<string>(TABLE.noiseExact);

/** Matches kernel threads like `kworker/0:1-events` and bracketed helpers. */
export function isNoise(comm: string): boolean {
  if (!comm) return true;
  if (comm.startsWith("[") && comm.endsWith("]")) return true;
  if (comm.startsWith("kworker")) return true;
  if (comm.startsWith("ksoftirqd")) return true;
  if (comm.startsWith("migration")) return true;
  if (comm.startsWith("kcompactd")) return true;
  if (comm.startsWith("khugepaged")) return true;
  if (NOISE_EXACT.has(comm)) return true;
  return false;
}

/** Map a `ps comm` value to a tracked app, or null when uninteresting. */
export function mapComm(comm: string): ProcessMapEntry | null {
  const c = comm.trim().toLowerCase();
  if (isNoise(comm.trim())) return null;
  const direct = PROCESS_MAP[c] ?? PROCESS_MAP[comm.trim()];
  if (direct) return direct;
  // soffice.bin arrives as "oosplash" while LibreOffice warms up — ignore it
  if (c === "oosplash") return null;
  return null;
}
