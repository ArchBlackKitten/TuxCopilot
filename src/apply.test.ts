// Apply, against a fake backend: data first, system after; Dry Run keeps system changes
// pending; a failure stops everything after it and nothing on the system runs.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let failOn: string | null = null;
const settings = new Map<string, string>(); // the fake database remembers settings

vi.mock("@/lib/host", () => ({
  errText: (e: unknown) => String(e),
  inv: async (cmd: string, args: Record<string, unknown> = {}) => {
    const what = cmd === "run_start" ? `run_start(${(args.steps as Array<{ command: string }>).map((s) => s.command).join(" | ")}, dry=${args.dryRun})` : cmd;
    if (failOn && cmd === failOn) throw `${cmd} refused`;
    calls.push(what);
    switch (cmd) {
      case "tree_get":
        return [];
      case "node_create":
        return { ...(args.input as object), children: [] };
      case "setting_get":
        return settings.get(args.key as string) ?? null;
      case "setting_set":
        settings.set(args.key as string, args.value as string);
        return null;
      case "run_snapshot":
        // the run ended, its one step well (Apply waits for that before clearing)
        return { status: "success", total: 0, output: "", steps: [], okSteps: [0], failedSteps: [] };
      default:
        return null;
    }
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

function stageSome() {
  const st = useArch.getState();
  st.nodeCreate({ name: "S", category: "command", source: null, content: null, parentId: null });
  st.stageSystem("Mark obs", "sudo pacman -D --asexplicit obs");
  st.setConfirmCount(3);
}

describe("apply", () => {
  beforeEach(() => {
    calls.length = 0;
    failOn = null;
    settings.clear();
    useArch.setState({ history: EMPTY_HISTORY, savedConfirmCount: 0, dryRun: false, pendingConfirm: null });
  });

  it("saves the data first, then runs the system changes once, and clears what was applied", async () => {
    stageSome();
    // the staged count (3) is saved first, so the system change is then asked about 3 times
    const asked: number[] = [];
    const unsub = useArch.subscribe((s) => {
      const p = s.pendingConfirm;
      if (p && !asked.includes(p.round)) {
        asked.push(p.round);
        queueMicrotask(() => p.answer(true));
      }
    });
    const r = await useArch.getState().apply();
    unsub();
    expect(asked).toEqual([1, 2, 3]);
    expect(r).toMatchObject({ applied: 3, error: null, systemLeft: 0 });
    const order = calls.filter((c) => ["node_create", "setting_set"].includes(c) || c.startsWith("run_start"));
    expect(order).toEqual(["node_create", "setting_set", "run_start(sudo pacman -D --asexplicit obs, dry=false)"]);
    expect(useArch.getState().history.pending).toEqual([]);
  });

  it("in Dry Run, system changes are only previewed and stay pending", async () => {
    useArch.setState({ dryRun: true });
    stageSome();
    const r = await useArch.getState().apply();
    expect(r.systemLeft).toBe(1);
    expect(calls).toContain("run_start(sudo pacman -D --asexplicit obs, dry=true)");
    expect(useArch.getState().history.pending.map((c) => c.kind)).toEqual(["system"]);
  });

  it("a failed save stops everything after it — and nothing on the system runs", async () => {
    failOn = "node_create";
    stageSome();
    const r = await useArch.getState().apply();
    expect(r.error).toMatch(/refused/);
    expect(calls.some((c) => c.startsWith("run_start"))).toBe(false);
    expect(calls).not.toContain("setting_set");
    expect(useArch.getState().history.pending.map((c) => c.kind)).toEqual(["node.create", "system", "setting"]);
  });

  it("a cancelled \"Are you sure?\" keeps the system change pending", async () => {
    useArch.setState({ savedConfirmCount: 1 });
    stageSome();
    const unsub = useArch.subscribe((s) => s.pendingConfirm && queueMicrotask(() => s.pendingConfirm?.answer(false)));
    const r = await useArch.getState().apply();
    unsub();
    expect(r.systemLeft).toBe(1);
    expect(calls.some((c) => c.startsWith("run_start"))).toBe(false);
    expect(useArch.getState().history.pending.map((c) => c.kind)).toEqual(["system"]);
  });
});
