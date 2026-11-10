// The review (8.1): Apply's system changes leave your list only when their step ended well; a
// failed step, or one a stopped run never reached, stays pending so Apply can try it again.
import { beforeEach, describe, expect, it, vi } from "vitest";

let snapshot: Record<string, unknown> = { status: "idle", total: 0, output: "", steps: [] };
let snaps = 0;
vi.mock("@/lib/host", () => ({
  errText: (e: unknown) => String(e),
  inv: async (cmd: string) => {
    if (cmd === "tree_get") return [];
    if (cmd === "run_snapshot") {
      snaps++;
      return snaps < 3 ? { ...snapshot, status: "running" } : snapshot; // running a little, then ended
    }
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
const { notDone } = await import("@/lib/api");

describe("Apply keeps what didn't finish", () => {
  let unsub = () => {};
  beforeEach(() => {
    unsub();
    // every "Are you sure?" answered yes (the count comes back from the database as the default)
    unsub = useArch.subscribe((st) => st.pendingConfirm && queueMicrotask(() => st.pendingConfirm?.answer(true)));
    snaps = 0;
    useArch.setState({ history: EMPTY_HISTORY, savedConfirmCount: 0, dryRun: false, pendingConfirm: null });
  });

  it("which steps didn't end well: failed, or never reached", () => {
    expect(notDone({ okSteps: [0, 2] }, 4)).toEqual([1, 3]);
    expect(notDone({ okSteps: [] }, 2)).toEqual([0, 1]);
    expect(notDone({}, 1)).toEqual([0]);
  });

  it("a failed step and a never-run step stay pending, named; the one that worked leaves", async () => {
    snapshot = { status: "stopped", total: 0, output: "", steps: [], okSteps: [0], failedSteps: [1] };
    const st = useArch.getState();
    st.stageSystem("Mark vlc", "sudo pacman -D --asexplicit vlc");
    st.stageSystem("Mark mpv", "sudo pacman -D --asexplicit mpv");
    st.stageSystem("Mark obs", "sudo pacman -D --asexplicit obs");
    const r = await useArch.getState().apply();
    expect(useArch.getState().history.pending.map((c) => c.label)).toEqual(["Mark mpv", "Mark obs"]);
    expect(r.applied).toBe(1);
    expect(r.error).toMatch(/2 of 3 system changes didn't finish.*Mark mpv; Mark obs/);
    expect(snaps).toBeGreaterThanOrEqual(3); // it waited for the run's end
  });

  it("all ended well: the list is empty and nothing is said wrong", async () => {
    snapshot = { status: "success", total: 0, output: "", steps: [], okSteps: [0, 1], failedSteps: [] };
    useArch.getState().stageSystem("Mark vlc", "sudo pacman -D --asexplicit vlc");
    useArch.getState().stageSystem("Mark mpv", "sudo pacman -D --asexplicit mpv");
    const r = await useArch.getState().apply();
    expect(useArch.getState().history.pending).toEqual([]);
    expect([r.applied, r.error]).toEqual([2, null]);
  });
});
