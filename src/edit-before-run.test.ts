// Commands editable before they run: what you leave in "Are you sure?" is what runs — for a
// quick run, Apply, Play and Ollama — never with a step added, dropped or left empty; a later
// round shows your edit, not Fluff's; Fluff's version is kept to go back to; and the terminal
// comes forward for the run.
import { beforeEach, describe, expect, it, vi } from "vitest";

const runs: string[] = [];
vi.mock("@/lib/host", () => ({
  errText: (e: unknown) => String(e),
  inv: async (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "run_start") runs.push((args.steps as Array<{ command: string }>).map((s) => s.command).join(" | "));
    if (cmd === "tree_get") return [];
    if (cmd === "run_snapshot") return { status: "idle", total: 0, output: "", steps: [] };
    return null;
  },
  execRaw: async () => null,
  execOut: async () => null,
  readText: async () => null,
  readDir: async () => [],
  httpGet: async () => null,
  openExternal: async () => {},
  saveTextFile: async () => null,
}));

const { useArch } = await import("@/components/arch/store");
const { EMPTY_HISTORY } = await import("@/lib/changes");

/** Answers each round: yes with `edits[round-1]` (undefined: as shown), recording what each round showed. */
function editWith(edits: Array<string[] | undefined>) {
  const shown: Array<{ commands: string[]; suggested: string[] }> = [];
  const unsub = useArch.subscribe((s) => {
    const p = s.pendingConfirm;
    if (p && shown.length < p.round) {
      shown.push({ commands: p.commands, suggested: p.suggested });
      queueMicrotask(() => p.answer(true, edits[p.round - 1]));
    }
  });
  return { shown, done: unsub };
}

describe("edit before it runs", () => {
  beforeEach(() => {
    runs.length = 0;
    useArch.setState({ history: EMPTY_HISTORY, savedConfirmCount: 2, dryRun: false, pendingConfirm: null, terminalOpen: false });
  });

  it("what you leave in the prompt is what runs; the next round shows your edit", async () => {
    const e = editWith([["sudo pacman -Sy --needed firefox-esr"], undefined]);
    expect(await useArch.getState().runQuick("Install firefox", "sudo pacman -Sy --needed firefox", false)).toBeNull();
    e.done();
    expect(runs).toEqual(["sudo pacman -Sy --needed firefox-esr"]);
    expect(e.shown[1]).toEqual({ commands: ["sudo pacman -Sy --needed firefox-esr"], suggested: ["sudo pacman -Sy --needed firefox"] });
    expect(useArch.getState().terminalOpen).toBe(true);
  });

  it("an edit that adds, drops or empties a step is not taken: what was shown runs", async () => {
    for (const bad of [["a", "b"], [], ["  "]]) {
      const e = editWith([bad, undefined]);
      expect(await useArch.getState().askSureEdit("x", ["sudo pacman -Syu"])).toEqual(["sudo pacman -Syu"]);
      e.done();
    }
    const e = editWith([["  sudo pacman -Syu --noconfirm  "], undefined]);
    expect(await useArch.getState().askSureEdit("x", ["sudo pacman -Syu"])).toEqual(["sudo pacman -Syu --noconfirm"]);
    e.done();
    const no = useArch.subscribe((s) => s.pendingConfirm && queueMicrotask(() => s.pendingConfirm?.answer(false, ["changed"])));
    expect(await useArch.getState().askSureEdit("x", ["y"])).toBeNull();
    no();
  });

  it("Apply runs each system change as you edited it", async () => {
    useArch.setState({ savedConfirmCount: 0 });
    const st = useArch.getState();
    st.stageSystem("Mark obs", "sudo pacman -D --asexplicit obs");
    st.stageSystem("Mark vlc", "sudo pacman -D --asexplicit vlc");
    useArch.setState({ savedConfirmCount: 1 });
    const e = editWith([[`sudo pacman -D --asexplicit obs-studio`, `sudo pacman -D --asexplicit vlc`]]);
    await useArch.getState().apply();
    e.done();
    expect(runs).toEqual(["sudo pacman -D --asexplicit obs-studio | sudo pacman -D --asexplicit vlc"]);
  });

  it("Ollama: Fluff's command goes its own way; an edited one runs as you wrote it", async () => {
    useArch.setState({ savedConfirmCount: 2 }); // the model dialog already asked once
    let e = editWith([undefined]);
    await useArch.getState().ollamaAction("install", "llama3.2:3b", false);
    e.done();
    e = editWith([["ollama pull llama3.2:1b"]]);
    await useArch.getState().ollamaAction("install", "llama3.2:3b", false);
    e.done();
    expect(runs).toEqual(["ollama pull llama3.2:3b", "ollama pull llama3.2:1b"]);
  });

  it("Play runs what it composed, as you edited it", async () => {
    const node = (id: string, content: string) => ({ id, name: id, category: "command" as const, source: null, content, enabled: true, order: 0, parentId: null, children: [] });
    useArch.setState({ tree: [node("a", "echo one"), node("b", "echo two")], savedConfirmCount: 1 });
    const e = editWith([["echo one", "echo TWO"]]);
    expect(await useArch.getState().startPlay("all")).toBeNull();
    e.done();
    expect(e.shown[0].suggested).toEqual(["echo one", "echo two"]);
    expect(runs).toEqual(["echo one | echo TWO"]);
  });

  it("a dry run asks nothing and runs Fluff's command as it is", async () => {
    const e = editWith([["changed"]]);
    await useArch.getState().runQuick("x", "echo hi", true);
    e.done();
    expect(e.shown).toEqual([]);
    expect(runs).toEqual(["echo hi"]);
  });
});
