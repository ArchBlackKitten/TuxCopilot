// What used to be the Next.js /api routes, as plain functions. Pure logic (parsing,
// composing, recommending, elimination plans) runs here in the webview; storage, the run
// engine and the usage tracker live in Rust and are reached through inv().
//
// Each function keeps the response shape its route returned, so the views did not have to
// learn a new vocabulary. Failures reject with a message string (what the routes used to
// return as `{ error }`).

import { BRAIN_KEY, NO_BRAIN, type Brain } from "./brain";
import { NO_ADDITIONS, joinAdditions, type CatalogueAdditions } from "./commands/catalog";
import { execOut, inv } from "./host";
import { saveFile, type Saved } from "./integrity";
import { parseDocument } from "./parser";
import { composeSteps } from "./composer";
import { detectSpecs, type MachineProfile, type SpecRow } from "./system-specs";
import { getOllamaState, type OllamaState } from "./ollama";
import { recommend, type Priority, type RecommendationResult } from "./llm-recommend";
import { buildEliminationPlans, sanitizeAppName } from "./eliminate";
import { detectInstalledApps, forgetInstalledApps, type DetectResult } from "./apps-detect";
export { packagingTools, type SnapState } from "./apps-detect";

/** The apps on this machine (menu apps from pacman/AUR, flatpaks, snaps), for the Apps list. */
export async function installedApps(): Promise<Array<{ name: string; kind: string }>> {
  const d = await detectInstalledApps();
  return d.mode === "detected" ? [...d.apps].sort((a, b) => a.name.localeCompare(b.name)) : [];
}
import { archSync } from "./arch-sync";
import { clearLookupCaches } from "./lookups";
import { loadSystemProfile } from "./system-profile";
import { protectedReason } from "./protected";
import type {
  AppSource,
  AppUsageRow,
  EliminationPlan,
  NodeDTO,
  ParsedNode,
  RunState,
  RunStep,
  TrackerStatus,
  UnusedAppRow,
  UsageSnapshot,
} from "./types";

// ── nodes ────────────────────────────────────────────────────────────────

export interface NodeInput {
  /** chosen when the node was staged, so pending children can point at it */
  id?: string;
  name: string;
  category: "command" | "download";
  source: string | null;
  content: string | null;
  parentId: string | null;
  enabled?: boolean;
}

export const fetchTree = (): Promise<NodeDTO[]> => inv<NodeDTO[]>("tree_get");

export const createNode = (input: NodeInput): Promise<NodeDTO> => inv<NodeDTO>("node_create", { input });

/** Partial update — only the keys present are changed (as the PATCH route did). */
export const updateNode = (id: string, patch: Partial<NodeInput>): Promise<NodeDTO> =>
  inv<NodeDTO>("node_update", { id, patch });

export const deleteNode = (id: string): Promise<void> => inv("node_delete", { id });

export const moveNode = (id: string, direction: "up" | "down"): Promise<boolean> =>
  inv<boolean>("node_move", { id, direction });

// ── parse / backup ───────────────────────────────────────────────────────

function countNodes(nodes: Array<{ children?: unknown[] }>): number {
  return nodes.reduce<number>(
    (acc, n) => acc + 1 + countNodes((n.children ?? []) as Array<{ children?: unknown[] }>),
    0
  );
}

/** Imports nodes that already carry their (staged) ids — used by Apply. */
export const importParsed = (roots: ParsedNode[], mode: "append" | "replace") =>
  inv<number>("nodes_import", { roots, mode });

/** Saves what is saved (not pending edits) as a JSON backup. */
export async function exportBackup(): Promise<Saved | null> {
  const tree = await fetchTree();
  const payload = { app: "tuxcopilot", version: 1, exportedAt: new Date().toISOString(), tree };
  const name = `tuxcopilot-backup-${new Date().toISOString().slice(0, 10)}.json`;
  return saveFile(name, JSON.stringify(payload, null, 2));
}

function backupToParsed(n: NodeDTO): ParsedNode {
  const src = n.source;
  return {
    name: String(n.name ?? "Untitled").slice(0, 200),
    category: n.category === "download" ? "download" : "command",
    source: src === "pacman" || src === "yay" || src === "github" || src === "ollama" ? src : null,
    content: n.content ?? null,
    enabled: n.enabled !== false,
    children: (n.children ?? []).map(backupToParsed),
  };
}

/**
 * A pasted document, checked and ready to stage: sources only on download items, at most
 * 500 nodes. Throws the message to show when it can't be imported.
 */
export function prepareParsed(raw: string): { roots: ParsedNode[]; errors: string[]; total: number } {
  const parsed = parseDocument(raw);
  const total = countNodes(parsed.roots);
  if (total === 0) throw "Fluff found nothing to import";
  if (total > 500) throw `That is too big for Fluff: ${total} items (500 at most)`;
  const strip = (n: ParsedNode): ParsedNode => ({
    ...n,
    source: n.category === "download" ? n.source : null,
    children: n.children.map(strip),
  });
  return { roots: parsed.roots.map(strip), errors: parsed.errors, total };
}

/** A backup file, checked and ready to stage (it replaces the whole tree). */
export function prepareBackup(text: string): { roots: ParsedNode[]; total: number } {
  let body: { tree?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    throw "That isn't a TuxCopilot backup (it isn't JSON)";
  }
  if (!Array.isArray(body?.tree)) throw "That isn't a TuxCopilot backup (it has no sections)";
  const tree = body.tree as NodeDTO[];
  if (countNodes(tree) > 1000) throw "That backup is too big for Fluff (1,000 items at most)";
  return { roots: tree.map(backupToParsed), total: countNodes(tree) };
}

// ── runs ─────────────────────────────────────────────────────────────────

export type RunSnapshot = RunState & { total: number };

/** A command Fluff won't run (wreck.rs): what it does and why not, and the whole command to copy. */
export interface Wreck {
  part: string;
  what: string;
  why: string;
  command: string;
}
export const WRECK_PREFIX = "FLUFF_WONT_RUN:"; // runner.rs WRECK_PREFIX
let onWreck: (w: Wreck) => void = () => {};
/** The screen that shows the window (the store sets it once). */
export const setWreckHandler = (fn: (w: Wreck) => void) => {
  onWreck = fn;
};

/** Every run starts here: what would wreck the system is refused by the runner, and shown. */
const startRun = async (steps: RunStep[], label: string, dryRun: boolean) => {
  try {
    await inv("run_start", { steps, label, dryRun });
  } catch (e) {
    const t = typeof e === "string" ? e : String((e as Error)?.message ?? e);
    if (!t.startsWith(WRECK_PREFIX)) throw e;
    const w = JSON.parse(t.slice(WRECK_PREFIX.length)) as Omit<Wreck, "command">;
    onWreck({ ...w, command: steps.find((s) => s.command.includes(w.part))?.command ?? w.part });
    throw "Fluff won't run this one: it would wreck the system. The window says why.";
  }
};

/** Several commands as one run (Apply's system changes). */
export const runSteps = (steps: RunStep[], label: string, dryRun: boolean) => startRun(steps, label, dryRun);

/** Waits for the run to end (it may wait for your password, or run in your terminal). */
export async function runEnd(everyMs = 700): Promise<RunSnapshot> {
  for (;;) {
    const s = await runSnapshot(0);
    if (s.status !== "running") return s;
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

/** Which of a run's steps did not end well: failed, or never ran (stopped before them). */
export const notDone = (s: Pick<RunState, "okSteps">, count: number): number[] =>
  Array.from({ length: count }, (_, i) => i).filter((i) => !(s.okSteps ?? []).includes(i));

/**
 * What Play would run, without running it (shown in the "Are you sure?" prompt). `shown` is
 * the tree on screen, pending changes included — Play runs what you see.
 */
export async function composePlay(scope: "all" | string, needed: boolean, shown?: NodeDTO[]) {
  const tree = shown ?? (await fetchTree());
  const { steps, notes } = composeSteps(tree, { scope, needed });
  if (steps.length === 0) throw notes.length ? `Fluff found nothing it could run here. ${notes.join(" ")}` : "Fluff found nothing to run here: no item is switched on with a command in it";

  let label = "Play All";
  if (scope !== "all") {
    const find = (nodes: NodeDTO[]): string | null => {
      for (const n of nodes) {
        if (n.id === scope) return n.name;
        const hit = find(n.children);
        if (hit) return hit;
      }
      return null;
    };
    label = `Play: ${find(tree) ?? "Section"}`;
  }
  return { steps, notes, label };
}

export async function play(scope: "all" | string, needed: boolean, dryRun: boolean, shown?: NodeDTO[]) {
  const { steps, notes, label } = await composePlay(scope, needed, shown);
  await startRun(steps, label, dryRun);
  return { ok: true, steps, notes, label, dryRun };
}

// ── "Are you sure?" ──────────────────────────────────────────────────────

export const CONFIRM_MAX = 5;
export const CONFIRM_DEFAULT = 2;

/** How many "Are you sure?" prompts a live run asks before executing (Settings). */
export async function getConfirmCount(): Promise<number> {
  try {
    const v = await inv<string | null>("setting_get", { key: "confirm.count" });
    const n = v === null ? CONFIRM_DEFAULT : parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(CONFIRM_MAX, Math.max(0, n)) : CONFIRM_DEFAULT;
  } catch {
    return CONFIRM_DEFAULT;
  }
}

// ── where commands run: "" = inside TuxCopilot, else a terminal id (Settings) ──
export async function getRunTerminal(): Promise<string> {
  try {
    return (await inv<string | null>("setting_get", { key: "run.terminal" })) ?? "";
  } catch {
    return "";
  }
}

export async function setRunTerminal(id: string): Promise<void> {
  await inv("setting_set", { key: "run.terminal", value: id });
}

export const terminals = () => inv<{ installed: Array<[string, string]>; preferred: string | null }>("terminals");

export async function setConfirmCount(n: number): Promise<number> {
  const v = Math.min(CONFIRM_MAX, Math.max(0, Math.round(n)));
  await inv("setting_set", { key: "confirm.count", value: String(v) });
  return v;
}

// ── refresh: re-learn this machine ───────────────────────────────────────

/** Re-reads everything the app assumes about this machine. Each part reports on its own. */
export async function refreshKnowledge() {
  const done: string[] = [];
  const failed: string[] = [];
  const step = async <T>(label: string, f: () => Promise<T>, say: (r: T) => string) => {
    try {
      done.push(say(await f()));
    } catch {
      failed.push(label);
    }
  };
  clearLookupCaches();
  await step("system", async () => {
    const p = await loadSystemProfile(true);
    if (!p) throw new Error("no profile");
    return p;
  }, (p) => `${p.osName}: ${p.core.length} core packages`);
  await step("menu", () => inv<number>("desktop_refresh"), (n) => `${n} menu apps`);
  await step("apps", () => detectInstalledApps(true), (d) => `${d.apps.length} removable apps`);
  await step("hardware", () => detectSpecs(true), (s) => `hardware: ${s.profile.tier}`);
  await step("commands", () => archSync(), (r) => `${r.newEntries} new command entries`);
  return { done, failed };
}

/** One ad-hoc command through the same engine (the -Syy / -Syu buttons, elimination plans). */
export const QUICK_MAX = 20_000;
export async function quick(label: string, command: string, dryRun: boolean) {
  const lbl = label.trim() || "Quick command";
  const cmd = command.trim();
  // Security's own commands check what they did, and run up to ~5,000
  // (the storage switch's Block); the limit is only a guard against a runaway paste (bash takes 128 KB)
  if (!cmd || cmd.length > QUICK_MAX) throw `Fluff needs a command (${QUICK_MAX.toLocaleString("en")} characters at most)`;
  await startRun([{ id: "step-quick", label: lbl, command: cmd, kind: "shell", nodeIds: [] }], lbl, dryRun);
  return { ok: true, label: lbl, dryRun };
}

export const runSnapshot = (since: number): Promise<RunSnapshot> => inv<RunSnapshot>("run_snapshot", { since });
export const stopRun = (): Promise<boolean> => inv<boolean>("run_stop");

export interface RunLogRow {
  id: string;
  label: string;
  commands: string;
  output?: string;
  status: string;
  dryRun: boolean;
  createdAt: string;
  updatedAt: string;
}
export const listRuns = (): Promise<RunLogRow[]> => inv<RunLogRow[]>("runs_list");
export const getRun = (id: string): Promise<RunLogRow> => inv<RunLogRow>("run_get", { id });

// ── Ollama ───────────────────────────────────────────────────────────────

export const ollamaInstalled = (): Promise<OllamaState> => getOllamaState();
export const systemSpecs = (): Promise<{ rows: SpecRow[]; profile: MachineProfile }> => detectSpecs();

export async function ollamaRecommend(priority: Priority) {
  const [{ profile }, ollama] = await Promise.all([detectSpecs(), getOllamaState()]);
  const installed = ollama.models.map((m) => ({ name: m.name, sizeGB: m.sizeGB, modified: m.modified, params: null }));
  const result: RecommendationResult = recommend(profile, installed, priority);
  return { ...result, ollamaAvailable: ollama.available, ollamaVersion: ollama.version };
}

// Models are never installed, removed or switched without the user's explicit yes: the
// views pass confirmed only from the confirmation dialog.
export async function ollamaAction(
  action: "install" | "remove" | "run" | "stop",
  model: string,
  confirmed: boolean,
  dryRun: boolean
) {
  if (confirmed !== true) {
    throw "Confirmation required — models are never installed, removed or switched without the user's explicit yes.";
  }
  const tag = model.trim();
  if (!tag || tag.length > 120 || !/^[\w.:@/-]+$/.test(tag)) throw "Fluff can't read that model name (it looks like llama3.2:3b)";
  const verb = action === "install" ? "pull" : action === "remove" ? "rm" : action === "run" ? "run" : "stop";
  const command = `ollama ${verb} ${tag}`;
  const label = `Ollama: ${action} ${tag}`;
  await startRun([{ id: "step-ollama", label, command, kind: "ollama", nodeIds: [] }], label, dryRun);
  return { ok: true, label, command, dryRun };
}

// ── App Manager ──────────────────────────────────────────────────────────

export const trackerStatus = (): Promise<TrackerStatus> => inv<TrackerStatus>("tracker_status");

export async function trackerControl(action: "start" | "stop" | "interval", intervalSec?: number) {
  if (action === "interval") {
    if (![15, 30, 60, 120].includes(Number(intervalSec))) throw "intervalSec must be 15, 30, 60 or 120";
    return inv<TrackerStatus>("tracker_set_interval", { sec: Number(intervalSec) });
  }
  const status = await inv<TrackerStatus>("tracker_set_running", { running: action === "start" });
  if (action === "start" && typeof intervalSec === "number") {
    return inv<TrackerStatus>("tracker_set_interval", { sec: intervalSec });
  }
  return status;
}

export async function trackerWithDetection() {
  const [status, detect] = await Promise.all([trackerStatus(), detectInstalledApps()]);
  return { ...status, detectedMode: detect.mode, pacmanAvailable: detect.pacmanAvailable };
}

interface UsageRow {
  day: string;
  month: string;
  app: string;
  source: string;
  seconds: number;
  sessions: number;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const isValidMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

/**
 * Apps that are not on the machine any more: from the usage history, and from the apps seen
 * last time. Each is checked against the machine itself (pacman's full package list, flatpak,
 * snap), so an app that only lost its menu entry, or a tool that could not be asked, is never
 * counted as removed. Newly noticed ones are written to the removal log (History).
 */
async function uninstalledApps(all: UsageRow[], detect: DetectResult): Promise<Set<string>> {
  const gone = new Set<string>();
  if (detect.mode !== "detected") return gone;
  const pkgOut = await execOut("pacman", ["-Qq"]);
  const pkgs = pkgOut === null ? null : new Set(pkgOut.split("\n").map((l) => l.trim()).filter(Boolean));
  const listed = new Set(detect.apps.map((a) => a.name));
  const isGone = (app: string, s: string) =>
    ((s === "pacman" || s === "aur") && pkgs !== null && !pkgs.has(app)) ||
    (s === "flatpak" && detect.flatpakAvailable && !listed.has(app)) ||
    (s === "snap" && detect.snapAvailable && !listed.has(app));

  const lastSeen = await readJson<Array<{ name: string; kind: string }>>(LAST_SEEN_KEY, []);
  const sourceOf = new Map<string, string>();
  for (const r of all) sourceOf.set(r.app, r.source);
  for (const a of lastSeen) sourceOf.set(a.name, a.kind);
  for (const [app, s] of sourceOf) if (!listed.has(app) && isGone(app, s)) gone.add(app);

  const present = (app: string) => listed.has(app) || (pkgs?.has(app) ?? true);
  await noteRemovals([...gone].map((app) => ({ app, source: sourceOf.get(app) ?? "other" })), present);
  await inv("setting_set", { key: LAST_SEEN_KEY, value: JSON.stringify(detect.apps.map((a) => ({ name: a.name, kind: a.kind }))) });
  return gone;
}

const LAST_SEEN_KEY = "apps.lastSeen";
const REMOVED_LOG_KEY = "apps.removedLog";

export interface RemovedApp {
  app: string;
  source: string;
  noticedAt: string; // when the app first saw it was gone (it may have left a little earlier)
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await inv<string | null>("setting_get", { key });
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Log apps that just left the machine; an app reinstalled and removed again is logged again. */
async function noteRemovals(gone: Array<{ app: string; source: string }>, present: (app: string) => boolean) {
  const log = await readJson<Array<RemovedApp & { back?: true }>>(REMOVED_LOG_KEY, []);
  const open = new Set(log.filter((e) => !e.back).map((e) => e.app));
  const fresh = gone.filter((g) => !open.has(g.app));
  // an app that is installed again closes its entry, so a later removal is noticed again
  let changed = fresh.length > 0;
  for (const e of log) {
    if (!e.back && present(e.app)) {
      e.back = true;
      changed = true;
    }
  }
  if (!changed) return;
  const at = new Date().toISOString();
  const next = [...log, ...fresh.map((g) => ({ ...g, noticedAt: at }))].slice(-500);
  await inv("setting_set", { key: REMOVED_LOG_KEY, value: JSON.stringify(next) });
}

/** Look for apps that left the machine now (and log them), without building a whole snapshot. */
export async function checkRemovals(): Promise<void> {
  const [all, detect] = await Promise.all([inv<UsageRow[]>("usage_rows"), detectInstalledApps()]);
  await uninstalledApps(all, detect);
}

type LogEntry = RemovedApp & { back?: true; kept?: true; forgotten?: true };

/**
 * Apps keeps every app it has seen: the ones removed from this computer stay listed, marked
 * removed, until you forget them. `kept`: you already said keep.
 */
export async function removedFromMachine(): Promise<Array<RemovedApp & { kept: boolean }>> {
  const log = await readJson<LogEntry[]>(REMOVED_LOG_KEY, []);
  const latest = new Map<string, LogEntry>();
  for (const e of log) latest.set(e.app, e); // the newest entry of each app says where it stands
  return [...latest.values()].filter((e) => !e.back && !e.forgotten).map((e) => ({ app: e.app, source: e.source, noticedAt: e.noticedAt, kept: !!e.kept }));
}

/** Your answer to Fluff's question for removed apps: keep them listed, or forget them. */
export async function answerRemoved(apps: string[], answer: "keep" | "forget"): Promise<void> {
  const log = await readJson<LogEntry[]>(REMOVED_LOG_KEY, []);
  const names = new Set(apps);
  for (const e of log) if (names.has(e.app) && !e.back) answer === "keep" ? (e.kept = true) : (e.forgotten = true);
  await inv("setting_set", { key: REMOVED_LOG_KEY, value: JSON.stringify(log) });
}

/** The removal log, newest first. */
export async function removedAppsLog(): Promise<Array<RemovedApp & { back?: true }>> {
  const log = await readJson<Array<RemovedApp & { back?: true }>>(REMOVED_LOG_KEY, []);
  return [...log].reverse();
}

/** Something was installed or removed: forget the cached app list and re-read the menu. */
export async function machineChanged(): Promise<void> {
  forgetInstalledApps();
  try {
    await inv<number>("desktop_refresh");
  } catch {
    // the menu index refreshes itself on the next full Refresh
  }
  await checkRemovals().catch(() => {}); // a removal shows in History straight away
}

export async function usageSnapshot(monthParam = ""): Promise<UsageSnapshot> {
  const month = isValidMonth(monthParam) ? monthParam : currentMonth();
  const [all, detect, tracker] = await Promise.all([
    inv<UsageRow[]>("usage_rows"),
    detectInstalledApps(),
    trackerStatus(),
  ]);
  // An app you removed is no longer listed, whatever the history says (its time stays in the
  // CSV log). Only package/flatpak/snap sources can be checked; if pacman can't be asked,
  // nothing is hidden.
  const gone = await uninstalledApps(all, detect);
  const rows = all
    .filter((r) => r.month === month && !gone.has(r.app))
    .sort((a, b) => a.app.localeCompare(b.app) || a.day.localeCompare(b.day));
  const months = [...new Set([currentMonth(), ...all.map((r) => r.month)])].sort().reverse();

  // ranking (by time; the view re-sorts by sessions freely)
  const byApp = new Map<string, AppUsageRow>();
  for (const r of rows) {
    const cur = byApp.get(r.app);
    if (!cur) {
      byApp.set(r.app, { app: r.app, source: r.source as AppSource, system: protectedReason(r.app), seconds: r.seconds, sessions: r.sessions, days: 1, lastDay: r.day });
    } else {
      cur.seconds += r.seconds;
      cur.sessions += r.sessions;
      cur.days += 1;
      if (r.day > (cur.lastDay ?? "")) cur.lastDay = r.day;
    }
  }
  const ranking = [...byApp.values()].sort((a, b) => b.seconds - a.seconds);
  const used = new Set(byApp.keys());

  // fully unused: installed (or ever seen) but not seen this month
  const universe = new Map<string, AppSource>();
  for (const a of detect.apps) universe.set(a.name, a.kind as AppSource);
  for (const r of all) if (!universe.has(r.app) && !gone.has(r.app)) universe.set(r.app, r.source as AppSource);

  const lastMonthByApp = new Map<string, string>();
  for (const r of all) if (r.month > (lastMonthByApp.get(r.app) ?? "")) lastMonthByApp.set(r.app, r.month);

  const unused: UnusedAppRow[] = [];
  for (const [app, source] of universe) {
    if (used.has(app)) continue;
    unused.push({ app, source, lastUsedMonth: lastMonthByApp.get(app) ?? null, system: protectedReason(app) });
  }
  // the ones you could remove first; system apps (flagged) after them
  unused.sort((a, b) => Number(!!a.system) - Number(!!b.system) || a.app.localeCompare(b.app));

  return {
    month,
    months,
    detected: {
      mode: detect.mode,
      pacmanAvailable: detect.pacmanAvailable,
      flatpakAvailable: detect.flatpakAvailable,
      snapAvailable: detect.snapAvailable,
      note: detect.note,
      checkedAt: detect.checkedAt,
      appCount: detect.apps.length,
    },
    ranking,
    unused,
    removed: [...gone].sort(),
    totals: {
      seconds: ranking.reduce((s, r) => s + r.seconds, 0),
      sessions: ranking.reduce((s, r) => s + r.sessions, 0),
      apps: ranking.length,
    },
    tracker,
    simulatedRows: rows.some((r) => r.source === "simulated"),
  };
}

// simulated data (clearly labelled, only for previewing the layout)
const SEED_SPECS: Array<{ app: string; hours: [number, number]; sessions: [number, number]; spread: number }> = [
  { app: "firefox", hours: [38, 55], sessions: [120, 200], spread: 0.9 },
  { app: "code", hours: [45, 70], sessions: [60, 110], spread: 0.85 },
  { app: "kitty", hours: [12, 22], sessions: [50, 90], spread: 0.8 },
  { app: "vlc", hours: [6, 12], sessions: [8, 20], spread: 0.5 },
  { app: "steam", hours: [8, 20], sessions: [10, 30], spread: 0.4 },
  { app: "discord", hours: [10, 25], sessions: [40, 80], spread: 0.7 },
  { app: "gimp", hours: [2, 5], sessions: [4, 10], spread: 0.25 },
  { app: "obs-studio", hours: [1, 4], sessions: [2, 8], spread: 0.15 },
  { app: "telegram-desktop", hours: [3, 8], sessions: [20, 45], spread: 0.6 },
  { app: "libreoffice-fresh", hours: [0.5, 2], sessions: [2, 6], spread: 0.1 },
  { app: "krita", hours: [0.1, 0.5], sessions: [1, 2], spread: 0.05 },
];

export async function usageAction(action: "seed" | "clear", monthArg?: string) {
  if (action === "clear") {
    const deleted = await inv<number>("usage_clear_simulated");
    return { ok: true, deleted };
  }
  const month = monthArg && isValidMonth(monthArg) ? monthArg : currentMonth();
  const [y, mo] = month.split("-").map((x) => parseInt(x, 10));
  const daysInMonth = new Date(y, mo, 0).getDate();
  const today = month === currentMonth() ? new Date().getDate() : daysInMonth;

  // never overwrite real (non-simulated) rows: apps with real data this month are skipped
  const all = await inv<UsageRow[]>("usage_rows");
  const blocked = new Set(all.filter((r) => r.month === month && r.source !== "simulated").map((r) => r.app));

  const out: UsageRow[] = [];
  let skipped = 0;
  for (const spec of SEED_SPECS) {
    if (blocked.has(spec.app)) {
      skipped += 1;
      continue;
    }
    const activeDays = Math.max(1, Math.round(daysInMonth * spec.spread));
    const chosen = new Set<number>();
    while (chosen.size < Math.min(activeDays, daysInMonth)) chosen.add(1 + Math.floor(Math.random() * daysInMonth));
    const totalHours = spec.hours[0] + Math.random() * (spec.hours[1] - spec.hours[0]);
    const totalSessions = Math.round(spec.sessions[0] + Math.random() * (spec.sessions[1] - spec.sessions[0]));
    const days = [...chosen].filter((d) => d <= today);
    if (days.length === 0) continue;
    const weights = days.map(() => 0.5 + Math.random());
    const wSum = weights.reduce((a, b) => a + b, 0);
    days.forEach((d, i) => {
      out.push({
        day: `${month}-${String(d).padStart(2, "0")}`,
        month,
        app: spec.app,
        source: "simulated",
        seconds: Math.round((totalHours * 3600 * weights[i]) / wSum),
        sessions: i === 0 ? totalSessions : Math.max(1, Math.round((totalSessions * weights[i]) / wSum)),
      });
    });
  }
  const inserted = await inv<number>("usage_seed", { rows: out });
  return { ok: true, inserted, skipped, month };
}

// ── what leaves with a package, and orphans (pacman's own rules, src-tauri/src/deps.rs) ──

export interface Family {
  package: string;
  children: string[]; // what `pacman -Rs package` would take along
}

export const removalChildren = (apps: string[]): Promise<Family[]> => inv<Family[]>("removal_children", { apps });
export const orphanList = (): Promise<Family[]> => inv<Family[]>("orphan_list");

const ELIM_SOURCES = new Set(["pacman", "aur", "flatpak", "snap", "appimage", "git", "other", "simulated", "sample"]);

/** Removal plans for one app — none at all for a protected system package. */
export function eliminationPlans(
  rawApp: string,
  source: string
): { app: string; source: string; plans: EliminationPlan[]; protectedReason: string | null } {
  const app = sanitizeAppName(rawApp);
  if (!app) throw "Fluff needs the app's name";
  if (!ELIM_SOURCES.has(source)) throw "Unknown source";
  const reason = protectedReason(app);
  if (reason) return { app, source, plans: [], protectedReason: reason };
  return { app, source, plans: buildEliminationPlans(app, source), protectedReason: null };
}

// ---------------------------------------------------------------- Fluff's brain (Settings)

/** Ask Fluff's model (off until you choose one). */
export const getBrain = (): Promise<Brain> => readJson<Brain>(BRAIN_KEY, NO_BRAIN);
export const saveBrain = (b: Brain) => inv("setting_set", { key: BRAIN_KEY, value: JSON.stringify(b) });

// ---------------------------------------------------------------- commands you taught Fluff

const ADDITIONS_KEY = "commands.added";

/** What "Ask AI to refresh" added to the command catalogue (moves house with Fluff). */
export const commandAdditions = (): Promise<CatalogueAdditions> => readJson<CatalogueAdditions>(ADDITIONS_KEY, NO_ADDITIONS);

/** Adds more to it: what is already kept stays. Returns the whole of it, as now kept. */
export async function saveCommandAdditions(more: CatalogueAdditions): Promise<CatalogueAdditions> {
  const all = joinAdditions(await commandAdditions(), more);
  await inv("setting_set", { key: ADDITIONS_KEY, value: JSON.stringify(all) });
  return all;
}

/** The levels chosen in Security (level-chosen.ts), saved by Apply in the sealed database. */
export const saveChosen = (c: import("./level-chosen").Chosen) => inv("setting_set", { key: "security.chosen", value: JSON.stringify(c) });
/** …and the weekly checkup's fingerprints of them (marks.rs), outside the database it can't open. */
export const securityMarksSave = (levels: Record<string, string>) => inv("security_marks_save", { levels });

/** Fluff's own fingerprints (filecheck.ts), saved by Apply in the sealed database. */
export const saveFilesRecorded = (r: import("./filecheck").Recorded) => inv("setting_set", { key: "files.recorded", value: JSON.stringify(r) });

