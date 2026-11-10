// Pending changes — the rule: every edit, in every section, waits until
// Apply, and Undo / Redo step through what is waiting. Nothing here touches the database or
// the system; it describes changes and previews their effect. The store applies them.
//
// Two kinds:
//   data changes   the tree, tracking and links, settings — saved to the app's database
//   system changes commands that change the system (pacman marks, orphan removal) — run,
//                  through the "Are you sure?" prompts, after the data is saved

import type { WindowPref } from "./window";
import type { Brain } from "./brain";
import type { CatalogueAdditions } from "./commands/catalog";
import type { NodeDTO, ParsedNode, Source } from "./types";
import type { Tracking } from "./tracking";
import type { Look } from "./look";
import type { Recorded } from "./filecheck";
import type { Level } from "./levels";
import type { SecurityArea } from "./level-chosen";

export interface NodeFields {
  name: string;
  category: "command" | "download";
  source: string | null;
  content: string | null;
  parentId: string | null;
  enabled?: boolean;
}

export interface ImportRoot extends Omit<ParsedNode, "children"> {
  id: string;
  children: ImportRoot[];
}

export type Change =
  | { kind: "node.create"; label: string; id: string; fields: NodeFields }
  | { kind: "node.update"; label: string; id: string; patch: Partial<NodeFields> }
  | { kind: "node.delete"; label: string; id: string }
  | { kind: "node.move"; label: string; id: string; direction: "up" | "down" }
  | { kind: "nodes.import"; label: string; roots: ImportRoot[]; mode: "append" | "replace" }
  | { kind: "tracking"; label: string; next: Tracking }
  | { kind: "setting"; label: string; key: "confirm.count"; value: number }
  | { kind: "os.choice"; label: string; id: string | null }
  | { kind: "run.terminal"; label: string; value: string } // "" = inside TuxCopilot
  | { kind: "git.dirs"; label: string; value: string[] } // folders you added to the git search
  | { kind: "look"; label: string; value: Look } // palette, colour vision, imported palettes, icon
  | { kind: "export.sign"; label: string; value: string | null } // the GPG key exports are signed with
  | { kind: "window.size"; label: string; value: WindowPref } // the size TuxCopilot opens at
  | { kind: "fluff.brain"; label: string; value: Brain } // Ask Fluff's local model
  | { kind: "apps.removed"; label: string; apps: string[]; answer: "keep" | "forget" } // removed apps: keep listed, or forget
  | { kind: "commands.learn"; label: string; additions: CatalogueAdditions } // what you ticked in "Ask AI to refresh"
  | { kind: "files.recorded"; label: string; value: Recorded } // Fluff's own fingerprints of untracked files (filecheck.ts)
  | { kind: "security.chosen"; label: string; area: SecurityArea; level: Level } // the level chosen in a Security sub-section, watched (level-chosen.ts)
  | { kind: "system"; label: string; command: string; packages?: string[]; target?: Target };

/** What a system change changes: `id` names the thing (one app's pacman record, one service, the
 *  torrc), `to` what it becomes, `from` what it is now when the screen knows it. A later change to
 *  the same thing replaces the earlier one; one that puts it back to `from` leaves nothing waiting. */
export type Target = { id: string; to: string; from?: string };

/** A short fingerprint of a text, so a target can say "this text" without carrying it. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return `${text.length}:${h.toString(16)}`;
}

const sameCommand = (a: string, b: string) => a.trim().replace(/\s+/g, " ") === b.trim().replace(/\s+/g, " ");

export const newId = (): string => `n${crypto.randomUUID().replace(/-/g, "")}`;

/** Gives every node of a parsed document its own id, so it can be previewed before Apply. */
export function withIds(nodes: ParsedNode[]): ImportRoot[] {
  return nodes.map((n) => ({ ...n, id: newId(), children: withIds(n.children) }));
}

// ── undo / redo ──────────────────────────────────────────────────────────

export interface History {
  pending: Change[]; // oldest first; Apply runs them in this order
  redo: Change[]; // most recently undone last
}

export const EMPTY_HISTORY: History = { pending: [], redo: [] };

/** A new change: it goes on top, and whatever was undone can no longer be redone. */
export const stage = (h: History, c: Change): History => ({ pending: [...h.pending, c], redo: [] });

/** What a change sets: a later change to the same thing replaces it (the last one wins).
 *  null: a step of its own (creating, deleting, moving, importing, a system command). */
export function slot(c: Change): string | null {
  switch (c.kind) {
    case "node.update":
      return `node.update:${c.id}:${Object.keys(c.patch).sort().join(",")}`;
    case "setting":
      return `setting:${c.key}`;
    case "security.chosen":
      return `security.chosen:${c.area}`;
    case "apps.removed":
      return `apps.removed:${[...c.apps].sort().join(",")}`;
    case "tracking":
    case "os.choice":
    case "run.terminal":
    case "git.dirs":
    case "look":
    case "export.sign":
    case "window.size":
    case "fluff.brain":
    case "files.recorded":
      return c.kind;
    default:
      return null;
  }
}

/** The kinds whose effect the screen previews (so "nothing would change" can be seen). */
const PREVIEWED = new Set<Change["kind"]>(["node.update", "setting", "tracking", "run.terminal", "git.dirs", "look", "export.sign", "window.size", "fluff.brain"]);

/**
 * A change, staged without repeats: pressing what is already there adds nothing; changing the
 * same thing again replaces the earlier change; changing it back to how it was removes it.
 * `same` says whether two histories show the same screen.
 */
export function stageOnce(h: History, c: Change, same: (a: History, b: History) => boolean): History {
  if (c.kind === "system") return stageSystemOnce(h, c);
  const k = slot(c);
  if (k === null) return stage(h, c); // a move pressed twice moves twice
  const without: History = { pending: h.pending.filter((x) => slot(x) !== k), redo: [] };
  const next: History = { pending: [...without.pending, c], redo: [] };
  if (!PREVIEWED.has(c.kind)) return next;
  if (same(next, h)) return h; // what you pressed is what is already showing
  if (same(next, without)) return without; // back to how it was: nothing waits for it
  return next;
}

/** A system change, staged without repeats: the same command already waiting (whatever its label)
 *  adds nothing; a change to the same target replaces the earlier one; back to how it was: nothing. */
function stageSystemOnce(h: History, c: Extract<Change, { kind: "system" }>): History {
  const t = c.target;
  if (!t) return h.pending.some((x) => x.kind === "system" && !x.target && sameCommand(x.command, c.command)) ? h : stage(h, c);
  const isIt = (x: Change) => x.kind === "system" && x.target?.id === t.id;
  const earlier = h.pending.find(isIt) as Extract<Change, { kind: "system" }> | undefined;
  const from = earlier?.target?.from ?? t.from;
  const without: History = { pending: h.pending.filter((x) => !isIt(x)), redo: [] };
  if (from !== undefined && t.to === from) return earlier ? without : h; // back to how it is now
  if (earlier && earlier.target!.to === t.to && sameCommand(earlier.command, c.command)) return h; // already waiting
  return { pending: [...without.pending, { ...c, target: from === undefined ? t : { ...t, from } }], redo: [] };
}

/** Takes back what waits for one target (e.g. untracking an app whose pacman mark only waited). */
export function dropTarget(h: History, id: string): History {
  const left = h.pending.filter((x) => !(x.kind === "system" && x.target?.id === id));
  return left.length === h.pending.length ? h : { pending: left, redo: [] };
}

/** The node already there (or already waiting) that this one would only repeat. */
export function sameNode(tree: NodeDTO[], f: { name: string; category: string; content: string | null; parentId?: string | null; source?: string | null }): string | null {
  const siblings = (nodes: NodeDTO[], parent: string | null): NodeDTO[] | null => {
    if (parent === null) return nodes;
    for (const n of nodes) {
      if (n.id === parent) return n.children;
      const found = siblings(n.children, parent);
      if (found) return found;
    }
    return null;
  };
  const hit = (siblings(tree, f.parentId ?? null) ?? []).find(
    (n) => n.name.trim() === f.name.trim() && n.category === f.category && sameCommand(n.content ?? "", f.content ?? "") && (n.source ?? null) === (f.source ?? null),
  );
  return hit?.id ?? null;
}

export const undo = (h: History): History =>
  h.pending.length ? { pending: h.pending.slice(0, -1), redo: [...h.redo, h.pending[h.pending.length - 1]] } : h;

export const redo = (h: History): History =>
  h.redo.length ? { pending: [...h.pending, h.redo[h.redo.length - 1]], redo: h.redo.slice(0, -1) } : h;

// ── previews ─────────────────────────────────────────────────────────────

const SOURCES = new Set(["pacman", "yay", "github", "ollama"]);
const sourceOf = (s: string | null | undefined): Source | null => (s && SOURCES.has(s) ? (s as Source) : null);

function clone(nodes: NodeDTO[]): NodeDTO[] {
  return nodes.map((n) => ({ ...n, children: clone(n.children) }));
}

function find(nodes: NodeDTO[], id: string): NodeDTO | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = find(n.children, id);
    if (hit) return hit;
  }
  return null;
}

/** The sibling list a node lives in (the roots, or its parent's children). */
function siblingsOf(roots: NodeDTO[], id: string): NodeDTO[] | null {
  if (roots.some((n) => n.id === id)) return roots;
  for (const n of roots) {
    const hit = siblingsOf(n.children, id);
    if (hit) return hit;
  }
  return null;
}

const nextOrder = (list: NodeDTO[]) => list.reduce((m, n) => Math.max(m, n.order), -1) + 1;
const sortByOrder = (list: NodeDTO[]) => list.sort((a, b) => a.order - b.order);

function fromImport(r: ImportRoot, parentId: string | null, order: number): NodeDTO {
  return {
    id: r.id,
    name: r.name.slice(0, 200),
    category: r.category === "download" ? "download" : "command",
    source: sourceOf(r.source),
    content: r.content,
    enabled: r.enabled,
    order,
    parentId,
    children: r.children.map((c, i) => fromImport(c, r.id, i)),
  };
}

/** The tree as it will be once the pending changes are applied — mirrors what nodes.rs does. */
export function previewTree(base: NodeDTO[], changes: Change[]): NodeDTO[] {
  let roots = clone(base);
  for (const c of changes) {
    switch (c.kind) {
      case "node.create": {
        const parent = c.fields.parentId ? find(roots, c.fields.parentId) : null;
        const list = parent ? parent.children : roots;
        list.push({
          id: c.id,
          name: c.fields.name.trim(),
          category: c.fields.category === "download" ? "download" : "command",
          source: sourceOf(c.fields.source),
          content: c.fields.content?.trim() || null,
          enabled: c.fields.enabled !== false,
          order: nextOrder(list),
          parentId: parent ? parent.id : null,
          children: [],
        });
        break;
      }
      case "node.update": {
        const n = find(roots, c.id);
        if (!n) break;
        const p = c.patch;
        if (p.name !== undefined && p.name.trim()) n.name = p.name.trim();
        if (p.category !== undefined) n.category = p.category === "download" ? "download" : "command";
        if (p.source !== undefined) n.source = sourceOf(p.source);
        if (p.content !== undefined) n.content = p.content?.trim() || null;
        if (p.enabled !== undefined) n.enabled = Boolean(p.enabled);
        if (p.parentId !== undefined && p.parentId !== n.parentId) {
          const from = siblingsOf(roots, n.id);
          const to = p.parentId ? find(roots, p.parentId) : null;
          // never under itself or its own subsection: the database refuses it (nodes.rs), so the
          // preview does too, and never shows a tree that can't be saved
          if (from && (p.parentId === null || (to && !find([n], to.id)))) {
            from.splice(from.indexOf(n), 1);
            const list = to ? to.children : roots;
            n.parentId = to ? to.id : null;
            n.order = nextOrder(list);
            list.push(n);
          }
        }
        break;
      }
      case "node.delete": {
        const list = siblingsOf(roots, c.id);
        if (list) list.splice(list.findIndex((n) => n.id === c.id), 1);
        break;
      }
      case "node.move": {
        const list = siblingsOf(roots, c.id);
        if (!list) break;
        sortByOrder(list);
        const i = list.findIndex((n) => n.id === c.id);
        const j = c.direction === "down" ? i + 1 : i - 1;
        if (j < 0 || j >= list.length) break;
        [list[i].order, list[j].order] = [list[j].order, list[i].order];
        break;
      }
      case "nodes.import": {
        const base0 = c.mode === "append" ? nextOrder(roots) : 0;
        const imported = c.roots.map((r, i) => fromImport(r, null, base0 + i));
        roots = c.mode === "replace" ? imported : [...roots, ...imported];
        break;
      }
    }
  }
  const sortAll = (list: NodeDTO[]) => {
    sortByOrder(list);
    list.forEach((n) => sortAll(n.children));
  };
  sortAll(roots);
  return roots;
}

/** Tracking as it will be: the latest pending tracking change wins. */
export function previewTracking(base: Tracking, changes: Change[]): Tracking {
  for (let i = changes.length - 1; i >= 0; i--) {
    const c = changes[i];
    if (c.kind === "tracking") return c.next;
  }
  return base;
}

export function previewConfirmCount(base: number, changes: Change[]): number {
  for (let i = changes.length - 1; i >= 0; i--) {
    const c = changes[i];
    if (c.kind === "setting" && c.key === "confirm.count") return c.value;
  }
  return base;
}

export function previewGitDirs(base: string[], changes: Change[]): string[] {
  for (let i = changes.length - 1; i >= 0; i--) {
    const c = changes[i];
    if (c.kind === "git.dirs") return c.value;
  }
  return base;
}

export function previewSignWith(base: string | null, changes: Change[]): string | null {
  for (let i = changes.length - 1; i >= 0; i--) {
    const c = changes[i];
    if (c.kind === "export.sign") return c.value;
  }
  return base;
}

export function previewLook(base: Look, changes: Change[]): Look {
  for (let i = changes.length - 1; i >= 0; i--) {
    const c = changes[i];
    if (c.kind === "look") return c.value;
  }
  return base;
}

/** Removed apps you answered for in pending changes (shown as answered before Apply). */
export function pendingRemovedAnswers(changes: Change[]): Map<string, "keep" | "forget"> {
  const m = new Map<string, "keep" | "forget">();
  for (const c of changes) if (c.kind === "apps.removed") for (const a of c.apps) m.set(a, c.answer);
  return m;
}

export function previewBrain(base: Brain, changes: Change[]): Brain {
  let b = base;
  for (const c of changes) if (c.kind === "fluff.brain") b = c.value;
  return b;
}

export function previewWindowPref(base: WindowPref, changes: Change[]): WindowPref {
  for (let i = changes.length - 1; i >= 0; i--) {
    const c = changes[i];
    if (c.kind === "window.size") return c.value;
  }
  return base;
}

export function previewRunTerminal(base: string, changes: Change[]): string {
  for (let i = changes.length - 1; i >= 0; i--) {
    const c = changes[i];
    if (c.kind === "run.terminal") return c.value;
  }
  return base;
}

/** undefined = no pending OS change; null = back to automatic detection. */
export function pendingOsChoice(changes: Change[]): string | null | undefined {
  for (let i = changes.length - 1; i >= 0; i--) {
    const c = changes[i];
    if (c.kind === "os.choice") return c.id;
  }
  return undefined;
}

/** Packages a pending system change will remove (for "will be removed on Apply" badges). */
export function pendingRemovals(changes: Change[]): Set<string> {
  return new Set(changes.flatMap((c) => (c.kind === "system" && c.packages ? c.packages : [])));
}
