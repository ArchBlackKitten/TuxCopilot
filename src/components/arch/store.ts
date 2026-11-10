import { NO_BRAIN, type Brain } from "@/lib/brain";
import { mergeAdditions } from "@/lib/commands/catalog";
import { changesNotDone, snapshotReady, touchesSystem, withSnapshot } from "@/lib/snapshot";
import { HANDS_SECONDS, pickWord, type HandsCheck } from "@/lib/hands-check";
import { DEFAULT_WINDOW, getWindowPref, saveWindowPref, type WindowPref } from "@/lib/window";
import { create } from "zustand";
import * as api from "@/lib/api";
import { getGitDirs, saveGitDirs } from "@/lib/gitrepos";
import { DEFAULT_LOOK, getLook, sameIcon, saveLook, type Look } from "@/lib/look";
import { setMenuIcon } from "@/lib/look-runtime";
import { getSignWith, saveSignWith, setExportSigner } from "@/lib/integrity";
import { errText, inv } from "@/lib/host";
import { loadSystemProfile, type SystemProfile } from "@/lib/system-profile";
import { EMPTY as NO_TRACKING, loadTracking, saveTracking, type Tracking } from "@/lib/tracking";
import { setOsChoice } from "@/lib/system-profile";
import {
  EMPTY_HISTORY,
  newId,
  pendingOsChoice,
  previewConfirmCount, previewRunTerminal, previewGitDirs, previewLook, previewSignWith, previewWindowPref, previewBrain,
  previewTracking,
  previewTree,
  redo as redoH,
  dropTarget as dropTargetH,
  sameNode,
  stageOnce,
  undo as undoH,
  withIds,
  type Change,
  type History,
  type NodeFields,
  type Target,
} from "@/lib/changes";
import type { ParsedNode, RunStep } from "@/lib/types";
import type { NodeDTO, RunState } from "@/lib/types";
import type { OllamaState } from "@/lib/ollama";
import type { SpecRow, MachineProfile } from "@/lib/system-specs";
import type { RecommendationResult, Priority } from "@/lib/llm-recommend";
import { getChosen, withChosen, type Chosen, type SecurityArea } from "@/lib/level-chosen";

export type View = "home" | "commands" | "apps" | "updates" | "appmanager" | "services" | "troubleshoot" | "git" | "security" | "ports" | "docker" | "tor" | "ollama" | "history" | "feedback" | "settings";

/** One "Are you sure?" prompt waiting on screen (see ConfirmRunDialog). */
export interface PendingConfirm {
  title: string;
  commands: string[]; // as they will run: Fluff's, or as you edited them in an earlier round
  suggested: string[]; // Fluff's, before any edit
  round: number; // 1-based
  rounds: number;
  notes?: string[]; // what Fluff left out, and why (said above the commands)
  answer: (yes: boolean, edited?: string[]) => void; // `edited`: the commands as you changed them
}

/** Security's sub-sections. */
export type SecurityTab = "glance" | "network" | "devices" | "accounts" | "system";

export type OllamaAction = "install" | "remove" | "run" | "stop";

/** Where you are: the section, and the page open inside it. Back / Up / Forward move through these. */
export interface Place {
  view: View;
  appPage: { app: string; source: string } | null;
  commandPage: string | null;
  commandsTab: "mine" | "arch";
  securityTab: SecurityTab;
}

/** A place as one string (for remembering where the page was scrolled). */
export const placeKey = (p: Place) => [p.view, p.commandsTab, p.securityTab, p.commandPage ?? "", p.appPage ? `${p.appPage.source}:${p.appPage.app}` : ""].join("|");

const samePlace = (a: Place, b: Place) =>
  a.view === b.view && a.commandPage === b.commandPage && a.commandsTab === b.commandsTab && a.securityTab === b.securityTab && a.appPage?.app === b.appPage?.app && a.appPage?.source === b.appPage?.source;

interface ArchStore {
  view: View;
  setView: (v: View) => void;
  /** The app whose page is open in Apps (null: the Apps lists). */
  appPage: { app: string; source: string } | null;
  openAppPage: (app: string, source: string) => void;
  closeAppPage: () => void;
  /** The command whose page is open in Commands (null: the Commands lists). */
  commandPage: string | null;
  openCommand: (name: string) => void;
  closeCommand: () => void;
  /** Never lose the page you were on: where you have been, and where Back took you from. */
  nav: { past: Place[]; future: Place[] };
  /** How you got here: somewhere new opens at the top; Back and Forward return where you were. */
  lastMove: "go" | "back" | "forward";
  goBack: () => void;
  goForward: () => void;
  /** One level up: from a page to its list, from a section to Home. */
  goUp: () => void;

  // ── pending changes: every edit waits for Apply; Undo / Redo step through them ──
  // `tree`, `tracking` and `confirmCount` are what the screen shows (saved + pending);
  // the `saved…` fields are what the database holds.
  history: History;
  applying: boolean;
  stageChange: (c: Change) => void;
  /** Recompute the screen from saved + pending (after something saved was reloaded). */
  refreshView: () => void;
  undo: () => void;
  redo: () => void;
  discard: () => void;
  apply: () => Promise<{ applied: number; error: string | null; systemLeft: number }>;
  /** Stages a node; returns its id (usable at once as a parent for more pending nodes). */
  nodeCreate: (fields: NodeFields, label?: string) => string;
  nodeUpdate: (id: string, patch: Partial<NodeFields>, label: string) => void;
  nodeDelete: (id: string, label: string) => void;
  nodeMove: (id: string, direction: "up" | "down", label: string) => void;
  importNodes: (roots: ParsedNode[], mode: "append" | "replace", label: string) => number;
  /** A root section by name, staging it if it does not exist yet. */
  ensureSection: (name: string) => string;
  /** `target`: what it changes, so changing it again replaces this and changing it back clears it. */
  stageSystem: (label: string, command: string, packages?: string[], target?: Target) => void;
  /** Takes back whatever waits for one target. */
  dropTarget: (id: string) => void;

  savedTree: NodeDTO[];
  tree: NodeDTO[];
  treeLoading: boolean;
  loadTree: () => Promise<void>;

  run: RunState | null;
  runOutputOffset: number;
  pollRun: () => Promise<void>;
  resetRun: () => void;

  dryRun: boolean;
  toggleDryRun: () => void;
  needed: boolean;
  toggleNeeded: () => void;

  terminalOpen: boolean;
  setTerminalOpen: (open: boolean) => void;
  /** A report written into the terminal panel without running anything (Troubleshoot). */
  terminalNote: { title: string; text: string; at: number } | null;
  noteTerminal: (title: string, text: string) => void;

  startPlay: (scope: "all" | string) => Promise<string | null>;
  /** preConfirmed: prompts the caller already showed (its own dialog counts as one). */
  /** `mustRun`: a way back that runs even if no snapshot can be taken first (snapshot.ts withSnapshot). */
  runQuick: (label: string, command: string, dryRun: boolean, preConfirmed?: number, mustRun?: boolean) => Promise<string | null>;
  /** runQuick, then waits for the run's end: "ok" only when it ran and every step ended well; "no"
   *  when you said no at "Are you sure?" (nothing ran); "failed" with what went wrong. A level
   *  choice is remembered only after "ok" (level-chosen.ts). */
  runToEnd: (label: string, command: string, dryRun: boolean) => Promise<{ end: "ok" | "dry-run" | "no" | "failed"; error?: string }>;
  /** The Security sub-sections a panel changed something in, this session (not a level's cards):
   *  a level that moved there was changed here, not behind your back (level-chosen.ts). */
  securityTouched: SecurityArea[];
  untouch: (area: SecurityArea) => void;

  // "Are you sure?" before every live run — how many is a Settings choice
  savedConfirmCount: number;
  confirmCount: number;
  /** Where commands run: "" inside TuxCopilot, else your terminal (saved / shown with pending). */
  savedRunTerminal: string;
  runTerminal: string;
  /** Folders added to the git search (saved / shown with pending). */
  savedGitDirs: string[];
  gitDirs: string[];
  setGitDirs: (next: string[], label: string) => void;
  /** Settings → Look: palette, colour vision, imported palettes, icon (saved / shown with pending). */
  savedLook: Look;
  look: Look;
  setLook: (next: Look, label: string) => void;
  /** Settings → Lock and signing: the GPG key exports are signed with (saved / shown with pending). */
  savedSignWith: string | null;
  signWith: string | null;
  setSignWith: (fingerprint: string | null, label: string) => void;
  setRunTerminal: (id: string, name: string) => void;
  /** Settings → Window: the size it opens at (saved / shown with pending). */
  savedWindowPref: WindowPref;
  windowPref: WindowPref;
  setWindowPref: (next: WindowPref, label: string) => void;
  savedBrain: Brain;
  brain: Brain;
  setBrain: (next: Brain, label: string) => void;
  setConfirmCount: (n: number) => void;
  setOs: (id: string | null) => void;
  pendingConfirm: PendingConfirm | null;
  /** A command Fluff won't run (it would wreck the system): its window is open. */
  wreck: api.Wreck | null;
  closeWreck: () => void;
  /** "Can you still type and click?" — not passed in time, and `undo` runs by itself (hands-check.ts). */
  handsCheck: HandsCheck | null;
  checkHands: (c: { title: string; what: string; undoLabel: string; undo: string; seconds?: number }) => Promise<boolean>;
  askSure: (title: string, commands: string[], preConfirmed?: number) => Promise<boolean>;
  /** Like askSure, and the commands can be edited in the prompt: they come back as they will run (null: cancelled). */
  askSureEdit: (title: string, commands: string[], preConfirmed?: number, notes?: string[]) => Promise<string[] | null>;
  stopRun: () => Promise<void>;

  // Ollama section
  ollama: OllamaState | null;
  ollamaLoading: boolean;
  loadOllama: () => Promise<void>;

  specs: { rows: SpecRow[]; profile: MachineProfile } | null;
  specsLoading: boolean;
  loadSpecs: () => Promise<void>;

  priority: Priority;
  setPriority: (p: Priority) => void;
  recommendation: RecommendationResult | null;
  recLoading: boolean;
  loadRecommendations: (p?: Priority) => Promise<void>;

  ollamaAction: (action: OllamaAction, model: string, dryRun: boolean) => Promise<string | null>;

  // "Explain" on any saved command: opens Commands → Arch Commands with it loaded
  commandsTab: "mine" | "arch";
  setCommandsTab: (t: "mine" | "arch") => void;
  explainTarget: { command: string; at: number } | null;
  explain: (command: string) => void;

  // Security's sub-sections; `openSecurity` also scrolls to one panel (Security at a glance)
  securityTab: SecurityTab;
  setSecurityTab: (t: SecurityTab) => void;
  securityAnchor: { id: string; at: number } | null;
  openSecurity: (t: SecurityTab, anchor?: string) => void;
  /** The guide's step on screen (guide.ts), or null when there is no guide. */
  guide: number | null;
  setGuide: (step: number | null) => void;

  // tracked apps (keep) and "A uses B" links — App Manager's domino rules
  savedTracking: Tracking;
  tracking: Tracking;
  loadTracking: () => Promise<void>;
  /** Stages a tracking change (applied with everything else). */
  setTracking: (next: Tracking, label?: string) => void;

  // what the app has learned about this machine, and the top-bar Refresh
  profile: SystemProfile | null;
  loadProfile: () => Promise<void>;
  refreshing: boolean;
  refreshKnowledge: () => Promise<{ done: string[]; failed: string[] }>;
  /** Bumped whenever the machine may have changed (a real run finished, or Refresh): views
   *  that read installed apps re-read them. */
  machineVersion: number;
}

function lsBool(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function lsSet(key: string, v: string) {
  try {
    window.localStorage.setItem(key, v);
  } catch {}
}

// Pending changes survive a restart (they were not applied yet). They are kept in the sealed
// database, not in the window's own storage: they can hold what you were about to change.
const HISTORY_SETTING = "changes.history";
const OLD_HISTORY_KEY = "am.changes"; // where they were kept before the lock

function asHistory(raw: string | null): History | null {
  try {
    const h = raw ? (JSON.parse(raw) as History) : null;
    return h && Array.isArray(h.pending) && Array.isArray(h.redo) ? h : null;
  } catch {
    return null;
  }
}

async function loadHistory(): Promise<History> {
  const saved = asHistory(await inv<string | null>("setting_get", { key: HISTORY_SETTING }).catch(() => null));
  let old: History | null = null;
  try {
    old = asHistory(window.localStorage.getItem(OLD_HISTORY_KEY));
    window.localStorage.removeItem(OLD_HISTORY_KEY); // moved into the sealed database, gone from here
  } catch {}
  return saved ?? old ?? EMPTY_HISTORY;
}

let historySaving: ReturnType<typeof setTimeout> | null = null;
function saveHistory(h: History) {
  if (historySaving) clearTimeout(historySaving);
  historySaving = setTimeout(() => void inv("setting_set", { key: HISTORY_SETTING, value: JSON.stringify(h) }).catch(() => {}), 300);
}

const NAV_KEEP = 50;

export const useArch = create<ArchStore>((set, get) => {
  api.setWreckHandler((w) => set({ wreck: w, pendingConfirm: null }));
  /** A quick run started: what it ran (steps; 0 when you said no), or why it couldn't start. A run
   *  that isn't a level's own, from a Security sub-section, marks it changed here (not a Dry Run). */
  const startQuick = async (label: string, command: string, dryRun: boolean, preConfirmed: number, mustRun: boolean, level: boolean): Promise<{ error: string | null; steps: number }> => {
    try {
      const plan = withSnapshot([command], label, touchesSystem(command) && (await snapshotReady().catch(() => false)), mustRun);
      const sure = dryRun ? plan.commands : await get().askSureEdit(label, plan.commands, preConfirmed);
      if (!sure) return { error: null, steps: 0 };
      if (plan.offset) {
        const labels = plan.labels([label]);
        await api.runSteps(sure.map((c, i) => ({ id: `quick-${i}`, label: labels[i], command: c, kind: "shell", nodeIds: [] })), label, dryRun);
      } else await api.quick(label, sure[0], dryRun);
      const { view, securityTab, securityTouched } = get();
      const area = securityTab as SecurityArea;
      if (!dryRun && !level && view === "security" && securityTab !== "glance" && !securityTouched.includes(area)) set({ securityTouched: [...securityTouched, area] });
      set({ terminalOpen: true, runOutputOffset: 0, run: null });
      await get().pollRun();
      return { error: null, steps: sure.length };
    } catch (e) {
      return { error: errText(e, "Fluff couldn't start the run"), steps: 0 };
    }
  };
  const here = (): Place => {
    const { view, appPage, commandPage, commandsTab, securityTab } = get();
    return { view, appPage, commandPage, commandsTab, securityTab };
  };
  /** Go somewhere new: where you were joins the past, and the way forward is forgotten (as in a browser). */
  const go = (next: Partial<Place>) => {
    const from = here();
    const to = { ...from, ...next };
    if (samePlace(from, to)) return;
    set({ ...to, lastMove: "go", nav: { past: [...get().nav.past, from].slice(-NAV_KEEP), future: [] } });
  };

  /** What the screen shows for this history: what is saved + what is pending. */
  const previews = (history: History) => {
    const { savedTree, savedTracking, savedConfirmCount, savedRunTerminal, savedGitDirs, savedLook, savedSignWith, savedWindowPref, savedBrain } = get();
    return {
      brain: previewBrain(savedBrain, history.pending),
      tree: previewTree(savedTree, history.pending),
      tracking: previewTracking(savedTracking, history.pending),
      confirmCount: previewConfirmCount(savedConfirmCount, history.pending),
      runTerminal: previewRunTerminal(savedRunTerminal, history.pending),
      gitDirs: previewGitDirs(savedGitDirs, history.pending),
      look: previewLook(savedLook, history.pending),
      signWith: previewSignWith(savedSignWith, history.pending),
      windowPref: previewWindowPref(savedWindowPref, history.pending),
    };
  };
  const sameScreen = (a: History, b: History) => JSON.stringify(previews(a)) === JSON.stringify(previews(b));

  /** Recomputes what the screen shows from what is saved + what is pending. */
  const show = (history: History) => {
    saveHistory(history);
    set({ history, ...previews(history) });
  };

  return {
  view: "home",
  setView: (v) => go({ view: v, appPage: null, commandPage: null }),
  appPage: null,
  openAppPage: (app, source) => go({ appPage: { app, source }, view: "apps" }),
  closeAppPage: () => go({ appPage: null }),
  commandPage: null,
  openCommand: (name) => go({ view: "commands", commandsTab: "arch", commandPage: name, appPage: null }),
  closeCommand: () => go({ commandPage: null }),
  nav: { past: [], future: [] },
  lastMove: "go",
  goBack: () => {
    const { past, future } = get().nav;
    if (!past.length) return;
    set({ ...past[past.length - 1], lastMove: "back", nav: { past: past.slice(0, -1), future: [here(), ...future].slice(0, NAV_KEEP) } });
  },
  goForward: () => {
    const { past, future } = get().nav;
    if (!future.length) return;
    set({ ...future[0], lastMove: "forward", nav: { past: [...past, here()].slice(-NAV_KEEP), future: future.slice(1) } });
  },
  goUp: () => {
    const { commandPage, appPage, view } = get();
    if (commandPage) go({ commandPage: null });
    else if (appPage) go({ appPage: null });
    else if (view !== "home") go({ view: "home" });
  },

  history: EMPTY_HISTORY,
  applying: false,
  stageChange: (c) => {
    const h = stageOnce(get().history, c, sameScreen);
    if (h !== get().history) show(h);
  },
  refreshView: () => show(get().history),
  undo: () => show(undoH(get().history)),
  redo: () => show(redoH(get().history)),
  discard: () => show(EMPTY_HISTORY),

  nodeCreate: (fields, label) => {
    const already = sameNode(get().tree, fields); // the same node, already there or waiting: not again
    if (already) return already;
    const id = newId();
    get().stageChange({ kind: "node.create", label: label ?? `Add "${fields.name.trim()}"`, id, fields });
    return id;
  },
  nodeUpdate: (id, patch, label) => get().stageChange({ kind: "node.update", label, id, patch }),
  nodeDelete: (id, label) => get().stageChange({ kind: "node.delete", label, id }),
  nodeMove: (id, direction, label) => get().stageChange({ kind: "node.move", label, id, direction }),
  importNodes: (roots, mode, label) => {
    const withIdsRoots = withIds(roots);
    get().stageChange({ kind: "nodes.import", label, roots: withIdsRoots, mode });
    const count = (ns: ParsedNode[]): number => ns.reduce((a, n) => a + 1 + count(n.children), 0);
    return count(roots);
  },
  ensureSection: (name) => {
    const hit = get().tree.find((n) => n.name === name);
    return hit ? hit.id : get().nodeCreate({ name, category: "command", source: null, content: null, parentId: null }, `Add section "${name}"`);
  },
  stageSystem: (label, command, packages, target) => get().stageChange({ kind: "system", label, command, packages, ...(target ? { target } : {}) }),
  dropTarget: (id) => {
    const h = dropTargetH(get().history, id);
    if (h !== get().history) show(h);
  },

  apply: async () => {
    const { pending } = get().history;
    if (!pending.length) return { applied: 0, error: null, systemLeft: 0 };
    set({ applying: true });
    let error: string | null = null;
    let applied = 0;
    const left: Change[] = []; // system changes, and anything after a failure
    let osTouched = false;
    let chosen: Chosen | null = null; // the levels chosen in Security, as Apply saves them
    const marks: Record<string, string> = {}; // …and the ones the weekly checkup fingerprints now
    const iconBefore = get().savedLook.icon;
    try {
      for (const c of pending) {
        if (error) {
          left.push(c);
          continue;
        }
        try {
          switch (c.kind) {
            case "node.create":
              await api.createNode({ ...c.fields, id: c.id });
              break;
            case "node.update":
              await api.updateNode(c.id, c.patch);
              break;
            case "node.delete":
              await api.deleteNode(c.id).catch((e) => {
                if (!/not found/i.test(errText(e))) throw e; // already gone with its parent
              });
              break;
            case "node.move":
              await api.moveNode(c.id, c.direction);
              break;
            case "nodes.import":
              await api.importParsed(c.roots, c.mode);
              break;
            case "tracking":
              await saveTracking(c.next);
              break;
            case "setting":
              await api.setConfirmCount(c.value);
              break;
            case "run.terminal":
              await api.setRunTerminal(c.value);
              break;
            case "git.dirs":
              await saveGitDirs(c.value);
              break;
            case "look":
              await saveLook(c.value);
              break;
            case "export.sign":
              await saveSignWith(c.value);
              break;
            case "apps.removed":
              await api.answerRemoved(c.apps, c.answer);
              break;
            case "fluff.brain":
              await api.saveBrain(c.value);
              set({ savedBrain: c.value });
              break;
            case "commands.learn":
              mergeAdditions(await api.saveCommandAdditions(c.additions));
              break;
            case "window.size":
              await saveWindowPref(c.value);
              set({ savedWindowPref: c.value });
              break;
            case "security.chosen":
              chosen = withChosen(chosen ?? (await getChosen()), c.area, c.level, new Date().toISOString());
              await api.saveChosen(chosen);
              marks[c.area] = c.level;
              break;
            case "files.recorded":
              await api.saveFilesRecorded(c.value);
              break;
            case "os.choice":
              await setOsChoice(c.id);
              osTouched = true;
              break;
            case "system":
              left.push(c); // runs after all data is saved
              continue;
          }
          applied++;
        } catch (e) {
          error = `${c.label}: ${errText(e)}`;
          left.push(c);
        }
      }
      if (Object.keys(marks).length)
        await api.securityMarksSave(marks).catch((e) => {
          error ??= `The weekly checkup's fingerprints of your levels: ${errText(e)}`;
        });
      // what the database now holds
      const [savedTree, savedTracking, savedConfirmCount, savedRunTerminal, savedGitDirs, savedLook, savedSignWith] = await Promise.all([
        api.fetchTree(),
        loadTracking(),
        api.getConfirmCount(),
        api.getRunTerminal(),
        getGitDirs(),
        getLook(),
        getSignWith(),
      ]);
      set({ savedTree, savedTracking, savedConfirmCount, savedRunTerminal, savedGitDirs, savedLook, savedSignWith });
      setExportSigner(savedSignWith);
      if (osTouched) set({ profile: await loadSystemProfile() });
      // a new icon: the menu's copy too (the window already shows it)
      if (!sameIcon(iconBefore, savedLook.icon)) {
        await setMenuIcon(savedLook.icon).catch((e) => {
          error ??= `The menu's icon: ${errText(e)}`;
        });
      }

      // system changes: one run, through the "Are you sure?" prompts; in Dry Run they are only
      // previewed and stay pending, so they can be applied for real later
      const system = error ? [] : left.filter((c): c is Extract<Change, { kind: "system" }> => c.kind === "system");
      let ran: Change[] = [];
      if (system.length) {
        const { dryRun } = get();
        const label = `Apply: ${system.length} system change${system.length === 1 ? "" : "s"}`;
        // a snapper pair around them when they change the system
        const commands = system.map((c) => c.command);
        const plan = withSnapshot(commands, label, commands.some(touchesSystem) && (await snapshotReady().catch(() => false)));
        const labels = plan.labels(system.map((c) => c.label));
        const sure = dryRun ? plan.commands : await get().askSureEdit(label, plan.commands);
        if (sure) {
          const steps: RunStep[] = sure.map((command, i) => ({ id: `apply-${i}`, label: labels[i], command, kind: "shell", nodeIds: [] }));
          await api.runSteps(steps, label, dryRun);
          set({ terminalOpen: true, runOutputOffset: 0, run: null });
          await get().pollRun();
          if (!dryRun) {
            // only what really ended well leaves the list: a failed or never-run step's change
            // stays pending, so Apply can try it again
            const end = await api.runEnd();
            const left = new Set(changesNotDone(api.notDone(end, sure.length), plan.offset, system.length));
            ran = system.filter((_, i) => !left.has(i));
            applied += ran.length;
            if (left.size) error ??= `${left.size} of ${system.length} system change${system.length === 1 ? "" : "s"} didn't finish, so ${left.size === 1 ? "it stays" : "they stay"} in your list: ${system.filter((_, i) => left.has(i)).map((c) => c.label).join("; ")}`;
          }
        }
      }
      show({ pending: left.filter((c) => !ran.includes(c)), redo: [] });
      return { applied, error, systemLeft: left.filter((c) => c.kind === "system" && !ran.includes(c)).length };
    } finally {
      set({ applying: false });
    }
  },

  savedTree: [],
  tree: [],
  treeLoading: true,
  loadTree: async () => {
    try {
      set({ savedTree: await api.fetchTree(), treeLoading: false });
      show(get().history);
    } catch {
      set({ treeLoading: false });
    }
  },

  run: null,
  runOutputOffset: 0,
  pollRun: async () => {
    const { runOutputOffset, run } = get();
    try {
      const data: RunState & { total: number } = await api.runSnapshot(runOutputOffset);
      if (data.status === "idle" && (!run || data.total === 0)) {
        // Nothing has run yet in this session
        set({ run: run && run.status === "idle" ? run : null, runOutputOffset: 0 });
        return;
      }
      // a real run just ended: something may have been installed or removed
      if (run?.status === "running" && data.status !== "running" && !data.dryRun) {
        void api.machineChanged().then(() => set((s) => ({ machineVersion: s.machineVersion + 1 })));
      }
      const append = run && runOutputOffset > 0 ? run.output + data.output : data.output;
      set({
        run: { ...data, output: append },
        runOutputOffset: data.status === "running" ? data.total : 0,
      });
    } catch {
      // transient error — keep last state
    }
  },
  resetRun: () => set({ run: null, runOutputOffset: 0 }),

  dryRun: true,
  toggleDryRun: () =>
    set((s) => {
      const next = !s.dryRun;
      lsSet("arch.dryRun", next ? "1" : "0");
      return { dryRun: next };
    }),
  needed: true,
  toggleNeeded: () =>
    set((s) => {
      const next = !s.needed;
      lsSet("arch.needed", next ? "1" : "0");
      return { needed: next };
    }),

  terminalOpen: false,
  setTerminalOpen: (open) => set({ terminalOpen: open }),
  terminalNote: null,
  noteTerminal: (title, text) => set({ terminalNote: { title, text, at: Date.now() }, terminalOpen: true }),

  startPlay: async (scope) => {
    const { dryRun, needed, pollRun } = get();
    try {
      const shown = get().tree; // Play runs what you see, pending changes included
      if (dryRun) await api.play(scope, needed, dryRun, shown);
      else {
        // Play runs what was composed, as you left it in "Are you sure?"
        const { steps, label, notes } = await api.composePlay(scope, needed, shown);
        const sure = await get().askSureEdit(label, steps.map((s) => s.command), 0, notes);
        if (!sure) return null;
        await api.runSteps(steps.map((s, i) => ({ ...s, command: sure[i] })), label, dryRun);
      }
      set({ terminalOpen: true, runOutputOffset: 0, run: null });
      await pollRun();
      return null;
    } catch (e) {
      return errText(e, "Fluff couldn't start the run");
    }
  },
  runQuick: async (label, command, dryRun, preConfirmed = 0, mustRun = false) => (await startQuick(label, command, dryRun, preConfirmed, mustRun, false)).error,
  runToEnd: async (label, command, dryRun) => {
    const s = await startQuick(label, command, dryRun, 0, false, true);
    if (s.error) return { end: "failed", error: s.error };
    if (!s.steps) return { end: "no" };
    if (dryRun) return { end: "dry-run" };
    const end = await api.runEnd();
    await get().pollRun();
    const ok = end.status === "success" && end.label === label && api.notDone(end, s.steps).length === 0;
    return ok ? { end: "ok" } : { end: "failed", error: `${label}: it didn't end well (${end.status}) — the terminal says why.` };
  },
  securityTouched: [],
  untouch: (area) => set((st) => ({ securityTouched: st.securityTouched.filter((a) => a !== area) })),

  stopRun: async () => {
    try {
      await api.stopRun();
      await get().pollRun();
    } catch {}
  },

  // ── "Are you sure?" ───────────────────────────────────────────────────
  savedConfirmCount: api.CONFIRM_DEFAULT,
  confirmCount: api.CONFIRM_DEFAULT,
  savedRunTerminal: "",
  runTerminal: "",
  savedWindowPref: DEFAULT_WINDOW,
  windowPref: DEFAULT_WINDOW,
  setWindowPref: (next, label) => get().stageChange({ kind: "window.size", label, value: next }),
  savedBrain: NO_BRAIN,
  brain: NO_BRAIN,
  setBrain: (next, label) => get().stageChange({ kind: "fluff.brain", label, value: next }),
  savedGitDirs: [],
  gitDirs: [],
  setGitDirs: (next, label) => get().stageChange({ kind: "git.dirs", label, value: next }),
  savedLook: DEFAULT_LOOK,
  look: DEFAULT_LOOK,
  setLook: (next, label) => {
    // a look change carries the whole look and replaces one waiting before it: a moved section
    // order stays said in the label (sections.ts), whatever else changed after it
    const moved = next.order.join(",") !== get().savedLook.order.join(",");
    const said = moved && !/sections in /i.test(label) ? `${label} · sections in your order` : label;
    get().stageChange({ kind: "look", label: said, value: next });
  },
  savedSignWith: null,
  signWith: null,
  setSignWith: (fingerprint, label) => get().stageChange({ kind: "export.sign", label, value: fingerprint }),
  setRunTerminal: (id, name) =>
    get().stageChange({ kind: "run.terminal", label: id ? `Run commands in ${name}` : "Run commands inside TuxCopilot", value: id }),
  setConfirmCount: (n) =>
    get().stageChange({ kind: "setting", label: `"Are you sure?" asked ${n} time${n === 1 ? "" : "s"}`, key: "confirm.count", value: n }),
  setOs: (id) => get().stageChange({ kind: "os.choice", label: id ? `OS set to ${id}` : "OS detected automatically", id }),
  pendingConfirm: null,
  wreck: null,
  closeWreck: () => set({ wreck: null }),
  handsCheck: null,
  checkHands: async ({ title, what, undoLabel, undo, seconds = HANDS_SECONDS }) => {
    if (get().dryRun) return true; // nothing was changed
    const passed = await new Promise<boolean>((resolve) => {
      // the first answer counts (a promise settles once): the circle, Go back now, or the clock
      const done = (ok: boolean) => {
        clearTimeout(timer);
        resolve(ok);
      };
      // the clock is here, not in the window: it runs out even if the window can't be seen
      const timer = setTimeout(() => done(false), seconds * 1000);
      set({ handsCheck: { title, what, undoLabel, undo, word: pickWord(), deadline: Date.now() + seconds * 1000, done } });
    });
    set({ handsCheck: null });
    // the undo was shown in the window: it runs without another "Are you sure?" (you may have no hands to answer it)
    // and it runs even if no snapshot can be taken first
    if (!passed) await get().runQuick(undoLabel, undo, false, Number.MAX_SAFE_INTEGER, true);
    return passed;
  },
  askSure: async (title, commands, preConfirmed = 0) => (await get().askSureEdit(title, commands, preConfirmed)) !== null,
  askSureEdit: async (title, suggested, preConfirmed = 0, notes = []) => {
    // the SAVED count: a lowered count only counts once it is applied
    const rounds = Math.max(0, get().savedConfirmCount - preConfirmed);
    let commands = suggested;
    for (let round = 1; round <= rounds; round++) {
      const sure = await new Promise<string[] | null>((done) =>
        set({ pendingConfirm: { title, commands, suggested, round, rounds, notes, answer: (yes, edited) => done(yes ? edited ?? commands : null) } })
      );
      set({ pendingConfirm: null });
      if (!sure) return null;
      // an edit never adds or drops a step, and a step is never left empty
      if (sure.length === suggested.length && sure.every((c) => c.trim())) commands = sure.map((c) => c.trim());
    }
    return commands;
  },

  // ── explain ───────────────────────────────────────────────────────────
  commandsTab: "mine",
  setCommandsTab: (t) => go({ commandsTab: t, commandPage: null }),
  explainTarget: null,
  explain: (command) => {
    go({ view: "commands", commandsTab: "arch", commandPage: null, appPage: null });
    set({ explainTarget: { command, at: Date.now() } });
  },

  // ── security's sub-sections ───────────────────────────────────────────
  securityTab: "glance",
  setSecurityTab: (t) => go({ securityTab: t }),
  securityAnchor: null,
  guide: null,
  setGuide: (step) => set({ guide: step }),
  openSecurity: (t, anchor) => {
    go({ view: "security", securityTab: t, commandPage: null, appPage: null });
    set({ securityAnchor: anchor ? { id: anchor, at: Date.now() } : null });
  },

  // ── tracked apps and links ────────────────────────────────────────────
  savedTracking: NO_TRACKING,
  tracking: NO_TRACKING,
  loadTracking: async () => {
    set({ savedTracking: await loadTracking() });
    show(get().history);
  },
  setTracking: (next, label = "Tracking changed") => get().stageChange({ kind: "tracking", label, next }),

  // ── what the app knows about this machine ─────────────────────────────
  profile: null,
  loadProfile: async () => set({ profile: await loadSystemProfile() }),
  refreshing: false,
  machineVersion: 0,
  refreshKnowledge: async () => {
    set({ refreshing: true });
    try {
      const result = await api.refreshKnowledge();
      set((s) => ({ machineVersion: s.machineVersion + 1 }));
      set({ profile: await loadSystemProfile() });
      // views that hold their own copy re-read on the next visit; these live in the store
      await Promise.all([get().loadTree(), get().loadOllama(), get().loadSpecs()]);
      void get().loadRecommendations();
      return result;
    } finally {
      set({ refreshing: false });
    }
  },

  // ── Ollama ────────────────────────────────────────────────────────────
  ollama: null,
  ollamaLoading: true,
  loadOllama: async () => {
    set({ ollamaLoading: true });
    try {
      const data: OllamaState = await api.ollamaInstalled();
      set({ ollama: data, ollamaLoading: false });
    } catch {
      set({ ollamaLoading: false });
    }
  },

  specs: null,
  specsLoading: false,
  loadSpecs: async () => {
    set({ specsLoading: true });
    try {
      set({ specs: await api.systemSpecs() });
    } catch {
      // keep old specs
    } finally {
      set({ specsLoading: false });
    }
  },

  priority: "quality",
  setPriority: (p) => {
    lsSet("arch.priority", p);
    set({ priority: p });
    void get().loadRecommendations(p);
  },
  recommendation: null,
  recLoading: false,
  loadRecommendations: async (p) => {
    const priority = p ?? get().priority;
    set({ recLoading: true, priority });
    try {
      set({ recommendation: await api.ollamaRecommend(priority) });
    } catch {
      // keep old recommendation
    } finally {
      set({ recLoading: false });
    }
  },

  ollamaAction: async (action, model, dryRun) => {
    try {
      // the model dialog already asked once
      const fluffs = `ollama ${action === "install" ? "pull" : action === "remove" ? "rm" : action} ${model}`;
      const sure = dryRun ? [fluffs] : await get().askSureEdit(`Ollama: ${action} ${model}`, [fluffs], 1);
      if (!sure) return null;
      if (sure[0] === fluffs) await api.ollamaAction(action, model, true, dryRun);
      else await api.quick(`Ollama: ${action} ${model} (as you changed it)`, sure[0], dryRun);
      set({ terminalOpen: true, runOutputOffset: 0, run: null });
      await get().pollRun();
      return null;
    } catch (e) {
      return errText(e, "Fluff couldn't do that");
    }
  },
  };
});

export function initSettings() {
  const prios: Priority[] = ["speed", "quality", "low"];
  const stored = typeof window !== "undefined" ? window.localStorage.getItem("arch.priority") : null;
  const priority = prios.includes(stored as Priority) ? (stored as Priority) : "quality";
  useArch.setState({ dryRun: lsBool("arch.dryRun", true), needed: lsBool("arch.needed", true), priority });
  void loadHistory().then((history) => {
    useArch.setState({ history });
    useArch.getState().refreshView();
  });
  void Promise.all([api.getConfirmCount(), api.getRunTerminal(), getGitDirs(), getLook(), getSignWith()]).then(([n, t, g, look, sign]) => {
    useArch.setState({ savedConfirmCount: n, savedRunTerminal: t, savedGitDirs: g, savedLook: look, savedSignWith: sign });
    setExportSigner(sign);
    useArch.getState().refreshView();
  });
  void api.getBrain().then((b) => {
    useArch.setState({ savedBrain: b });
    useArch.getState().refreshView();
  });
  void api.commandAdditions().then((a) => {
    mergeAdditions(a);
    useArch.getState().refreshView();
  });
  void getWindowPref().then((w) => {
    useArch.setState({ savedWindowPref: w });
    useArch.getState().refreshView();
  });
  void useArch.getState().loadProfile();
  void useArch.getState().loadTracking();
}
