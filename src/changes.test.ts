// Apply / Undo / Redo: changes wait, previews show their effect, undo and redo step through.
import { describe, expect, it } from "vitest";
import {
  EMPTY_HISTORY,
  previewConfirmCount,
  previewTracking,
  previewTree,
  redo,
  slot,
  stage,
  stageOnce,
  undo,
  withIds,
  type Change,
} from "@/lib/changes";
import { EMPTY, track } from "@/lib/tracking";
import type { NodeDTO } from "@/lib/types";
import { useArch } from "@/components/arch/store";

const node = (id: string, name: string, order: number, parentId: string | null = null, children: NodeDTO[] = []): NodeDTO => ({
  id, name, category: "command", source: null, content: null, enabled: true, order, parentId, children,
});
const BASE = [node("a", "A", 0, null, [node("a1", "A1", 0, "a")]), node("b", "B", 1)];
const names = (t: NodeDTO[]): string[] => t.flatMap((n) => [n.name, ...names(n.children).map((c) => `${n.name}/${c}`)]);

describe("previews", () => {
  it("creates (even inside a pending section), edits, moves and deletes", () => {
    const changes: Change[] = [
      { kind: "node.create", label: "", id: "s", fields: { name: "S", category: "command", source: null, content: null, parentId: null } },
      { kind: "node.create", label: "", id: "s1", fields: { name: "S1", category: "command", source: null, content: "echo", parentId: "s" } },
      { kind: "node.update", label: "", id: "b", patch: { enabled: false, name: "B2" } },
      { kind: "node.move", label: "", id: "b", direction: "up" },
      { kind: "node.delete", label: "", id: "a1" },
    ];
    const t = previewTree(BASE, changes);
    expect(names(t)).toEqual(["B2", "A", "S", "S/S1"]);
    expect(t[0].enabled).toBe(false);
    expect(BASE[1].name, "the saved tree is never touched").toBe("B");
  });

  it("moves a node to another parent", () => {
    const t = previewTree(BASE, [{ kind: "node.update", label: "", id: "a1", patch: { parentId: "b" } }]);
    expect(names(t)).toEqual(["A", "B", "B/A1"]);
  });

  it("previews an import, appended or replacing", () => {
    const roots = withIds([{ name: "New", category: "command", source: null, content: null, enabled: true, children: [] }]);
    expect(names(previewTree(BASE, [{ kind: "nodes.import", label: "", roots, mode: "append" }]))).toEqual(["A", "A/A1", "B", "New"]);
    expect(names(previewTree(BASE, [{ kind: "nodes.import", label: "", roots, mode: "replace" }]))).toEqual(["New"]);
  });

  it("the latest tracking and setting changes win", () => {
    const one = track(EMPTY, "obs");
    const two = track(one, "vlc");
    const c: Change[] = [
      { kind: "tracking", label: "", next: one },
      { kind: "setting", label: "", key: "confirm.count", value: 3 },
      { kind: "tracking", label: "", next: two },
    ];
    expect(previewTracking(EMPTY, c).tracked).toEqual(["obs", "vlc"]);
    expect(previewConfirmCount(2, c)).toBe(3);
    expect(previewConfirmCount(2, [])).toBe(2);
  });
});

describe("undo / redo", () => {
  const c = (n: number): Change => ({ kind: "setting", label: `set ${n}`, key: "confirm.count", value: n });

  it("undo steps back, redo steps forward, in order", () => {
    let h = stage(stage(stage(EMPTY_HISTORY, c(1)), c(2)), c(3));
    h = undo(undo(h));
    expect(h.pending.map((x) => x.label)).toEqual(["set 1"]);
    h = redo(h);
    expect(h.pending.map((x) => x.label)).toEqual(["set 1", "set 2"]);
    h = redo(h);
    expect(h.pending.map((x) => x.label)).toEqual(["set 1", "set 2", "set 3"]);
    expect(redo(h)).toBe(h);
  });

  it("a new change after undo clears what could be redone", () => {
    let h = undo(stage(stage(EMPTY_HISTORY, c(1)), c(2)));
    h = stage(h, c(9));
    expect(h.redo).toEqual([]);
    expect(h.pending.map((x) => x.label)).toEqual(["set 1", "set 9"]);
  });

  it("undo on nothing does nothing", () => {
    expect(undo(EMPTY_HISTORY)).toBe(EMPTY_HISTORY);
  });
});

describe("pressing the same change again", () => {
  // pressing the same mark again must not add a new change
  const s = () => useArch.getState();
  const node = (enabled: boolean): NodeDTO => ({ id: "n1", name: "Fonts", category: "command", source: null, content: null, enabled, order: 0, parentId: null, children: [] });
  const fresh = () => useArch.setState({ history: EMPTY_HISTORY, savedTree: [node(true)], tree: [node(true)], savedWindowPref: { mode: "pocket", width: 900, height: 640 } });

  it("switching off and on again leaves nothing waiting", () => {
    fresh();
    s().nodeUpdate("n1", { enabled: false }, "Switch off Fonts");
    expect(s().history.pending).toHaveLength(1);
    expect(s().tree[0].enabled).toBe(false);
    s().nodeUpdate("n1", { enabled: false }, "Switch off Fonts");
    expect(s().history.pending).toHaveLength(1); // the same press again: nothing new
    s().nodeUpdate("n1", { enabled: true }, "Switch on Fonts");
    expect(s().history.pending).toEqual([]); // back to how it is saved
    expect(s().tree[0].enabled).toBe(true);
  });

  it("choosing what is already chosen adds nothing; choosing again replaces the earlier choice", () => {
    fresh();
    s().setWindowPref({ mode: "pocket", width: 900, height: 640 }, "Window: pocket");
    expect(s().history.pending).toEqual([]);
    s().setWindowPref({ mode: "roomy", width: 900, height: 640 }, "Window: roomy");
    s().setWindowPref({ mode: "custom", width: 1000, height: 700 }, "Window: my own");
    expect(s().history.pending.map((c) => c.label)).toEqual(["Window: my own"]);
    expect(s().windowPref.mode).toBe("custom");
  });

  it("steps of their own count each time (up twice is two steps); the same system command waits once", () => {
    let h = EMPTY_HISTORY;
    const same = () => false;
    const mark = { kind: "system", label: "Mark krita", command: "sudo pacman -D --asexplicit krita" } as const;
    h = stageOnce(h, mark, same);
    h = stageOnce(h, mark, same);
    expect(h.pending).toHaveLength(1);
    h = stageOnce(h, { kind: "node.move", label: "Move up", id: "a", direction: "up" }, same);
    h = stageOnce(h, { kind: "node.move", label: "Move up", id: "a", direction: "up" }, same);
    expect(h.pending).toHaveLength(3); // up twice is two steps up
    expect(slot({ kind: "node.update", label: "", id: "a", patch: { name: "x", enabled: true } })).toBe("node.update:a:enabled,name");
  });
});

describe("the preview refuses what the database refuses", () => {
  it("an item moved under itself or its own subsection stays where it is", () => {
    const deep = [node("a", "A", 0, null, [node("a1", "A1", 0, "a", [node("a11", "A11", 0, "a1")])]), node("b", "B", 1)];
    for (const target of ["a", "a1", "a11"]) {
      const t = previewTree(deep, [{ kind: "node.update", label: "", id: "a", patch: { parentId: target } }]);
      expect(t.map((n) => n.id), target).toEqual(["a", "b"]);
      expect(t[0].parentId, target).toBeNull();
      expect(t[0].children[0].children[0].id).toBe("a11"); // nothing lost
    }
    // a real move still moves
    const ok = previewTree(deep, [{ kind: "node.update", label: "", id: "a1", patch: { parentId: "b" } }]);
    expect(ok[1].children.map((n) => n.id)).toEqual(["a1"]);
  });
});
