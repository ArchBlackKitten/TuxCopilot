// The Apply counter counts real changes: the same command waiting twice (whatever its label)
// counts once; changing the same thing again (an app's pacman mark, a service, the torrc, Tor's
// settings) replaces the earlier change; changing it back to how it is leaves nothing waiting;
// and the same node saved twice is one node.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/host", () => ({
  errText: (e: unknown) => String(e),
  inv: async (cmd: string) => (cmd === "tree_get" ? [] : null),
  execRaw: async () => null,
  execOut: async () => null,
  readText: async () => null,
  readDir: async () => [],
  httpGet: async () => null,
  openExternal: async () => {},
  saveTextFile: async () => null,
}));

const { EMPTY_HISTORY, dropTarget, fingerprint, sameNode, stageOnce } = await import("@/lib/changes");
const { useArch } = await import("@/components/arch/store");
type C = import("@/lib/changes").Change;

const never = () => false;
const run = (...cs: C[]) => cs.reduce((h, c) => stageOnce(h, c, never), EMPTY_HISTORY);
const sys = (label: string, command: string, target?: { id: string; to: string; from?: string }): C => ({ kind: "system", label, command, ...(target ? { target } : {}) });
const commands = (h: { pending: C[] }) => h.pending.map((c) => (c.kind === "system" ? c.command : c.kind));

describe("the Apply counter counts real changes", () => {
  it("the same command waiting twice counts once, whatever its label or spacing", () => {
    const h = run(sys("Mark vlc as installed on purpose", "sudo pacman -D --asexplicit vlc"), sys("Keep orphan vlc", "sudo  pacman -D --asexplicit vlc "));
    expect(commands(h)).toEqual(["sudo pacman -D --asexplicit vlc"]);
    expect(commands(run(sys("a", "echo one"), sys("b", "echo two")))).toEqual(["echo one", "echo two"]);
  });

  it("changing the same thing again replaces the earlier change; back to how it is leaves nothing", () => {
    const explicit = sys("Mark vlc as installed on purpose", "sudo pacman -D --asexplicit vlc", { id: "pacman.reason:vlc", to: "explicit", from: "deps" });
    const deps = sys("Mark vlc as a dependency", "sudo pacman -D --asdeps vlc", { id: "pacman.reason:vlc", to: "deps" });
    expect(run(explicit, deps).pending).toEqual([]);
    // not knowing how it is now: the last one wins, once
    const noFrom = sys("Mark vlc as installed on purpose", "sudo pacman -D --asexplicit vlc", { id: "pacman.reason:vlc", to: "explicit" });
    expect(commands(run(noFrom, deps))).toEqual(["sudo pacman -D --asdeps vlc"]);
    expect(commands(run(noFrom, noFrom))).toEqual(["sudo pacman -D --asexplicit vlc"]);
    // another app's mark is its own
    expect(run(explicit, sys("x", "sudo pacman -D --asdeps mpv", { id: "pacman.reason:mpv", to: "deps" })).pending).toHaveLength(2);
  });

  it("a service switched again: one change, from how it is now; back to it: none", () => {
    const unit = (to: string, from: string) => sys(`cups.service: make it ${to}`, `systemctl ${to} cups`, { id: "unit:cups.service", to, from });
    const h = run(unit("off", "on"), unit("dead", "off"));
    expect(commands(h)).toEqual(["systemctl dead cups"]);
    expect(h.pending[0].kind === "system" && h.pending[0].target).toEqual({ id: "unit:cups.service", to: "dead", from: "on" });
    expect(run(unit("off", "on"), unit("dead", "off"), unit("on", "dead")).pending).toEqual([]);
    expect(run(unit("on", "on")).pending).toEqual([]); // what it already is: nothing to do
  });

  it("Tor's settings saved twice wait once, as the last text; saved back as they are: nothing", () => {
    const save = (text: string) => sys("Tor settings", `write ${text}`, { id: "tor.settings", to: fingerprint(text), from: fingerprint("SocksPort 9050") });
    expect(commands(run(save("SocksPort 9150"), save("SocksPort 9250")))).toEqual(["write SocksPort 9250"]);
    expect(run(save("SocksPort 9150"), save("SocksPort 9050")).pending).toEqual([]);
    expect(fingerprint("a")).not.toBe(fingerprint("b"));
    expect(fingerprint("ab")).not.toBe(fingerprint("ba"));
  });

  it("the other kinds of change keep their own rules", () => {
    const move: C = { kind: "node.move", label: "Move up", id: "a", direction: "up" };
    expect(run(move, move).pending).toHaveLength(2); // a move pressed twice moves twice
  });

  it("dropTarget takes back only what waits for that target", () => {
    const h = run(
      sys("m", "sudo pacman -D --asexplicit vlc", { id: "pacman.reason:vlc", to: "explicit" }),
      sys("n", "sudo pacman -D --asexplicit mpv", { id: "pacman.reason:mpv", to: "explicit" }),
      sys("o", "echo hi"),
    );
    expect(commands(dropTarget(h, "pacman.reason:vlc"))).toEqual(["sudo pacman -D --asexplicit mpv", "echo hi"]);
    expect(dropTarget(h, "pacman.reason:nothing")).toBe(h);
  });

  it("the same node saved twice is one node; a different one is its own", () => {
    useArch.setState({ history: EMPTY_HISTORY, savedTree: [], tree: [] });
    const st = () => useArch.getState();
    const f = { name: "llama3.2:3b", category: "download" as const, source: "ollama" as const, content: "llama3.2:3b", parentId: null, enabled: true };
    const a = st().nodeCreate(f);
    expect(st().nodeCreate({ ...f })).toBe(a);
    expect(st().history.pending).toHaveLength(1);
    expect(sameNode(st().tree, f)).toBe(a);
    // under a section waiting too
    const sec = st().ensureSection("Saved from READMEs");
    const c = { name: "x — install", category: "command" as const, source: null, content: "make install", parentId: sec };
    const id = st().nodeCreate(c);
    expect(st().nodeCreate({ ...c, content: " make  install " })).toBe(id);
    expect(st().nodeCreate({ ...c, parentId: null })).not.toBe(id); // somewhere else: its own
    expect(st().nodeCreate({ ...f, content: "llama3.2:1b", name: "llama3.2:1b" })).not.toBe(a);
    expect(st().history.pending).toHaveLength(5);
  });

  it("pressing what is already so changes nothing — not even what Redo can bring back", () => {
    const mark = sys("m", "sudo pacman -D --asexplicit vlc", { id: "pacman.reason:vlc", to: "explicit" });
    const withRedo = { pending: [mark], redo: [sys("o", "echo redo me")] };
    expect(stageOnce(withRedo, mark, never)).toBe(withRedo);
    const on = sys("u", "systemctl on cups", { id: "unit:cups.service", to: "on", from: "on" });
    const nothing = { pending: [], redo: [sys("o", "echo redo me")] };
    expect(stageOnce(nothing, on, never)).toBe(nothing);
  });

  it("a node is the same only with the same name, content and source, in the same place", () => {
    const leaf = (over: object) => ({ id: "l", name: "a", category: "command" as const, source: null, content: "echo a", enabled: true, order: 0, parentId: "s2", children: [], ...over });
    const tree = [{ ...leaf({ id: "s1", content: null, parentId: null }), children: [{ ...leaf({ id: "s2", content: null, parentId: "s1" }), children: [leaf({})] }] }];
    const f = { name: "a", category: "command", content: "echo a", parentId: "s2", source: null };
    expect(sameNode(tree, f)).toBe("l"); // two sections deep
    expect(sameNode(tree, { ...f, name: "b" })).toBeNull();
    expect(sameNode(tree, { ...f, content: "echo b" })).toBeNull();
    expect(sameNode(tree, { ...f, source: "ollama" })).toBeNull();
  });
});
