// "Can you still type and click?": after a change that could
// take your hands away, type the word and click the circle in time, or Fluff goes back by itself.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const started: Array<{ steps: Array<{ label: string; command: string }> }> = [];
vi.mock("@/lib/host", () => ({
  errText: (e: unknown) => String(e),
  inv: async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "run_start") started.push(args as (typeof started)[number]);
    if (cmd === "run_snapshot") return { status: "success", total: 0, output: "", steps: [] };
    if (cmd === "snapshot_ready") return false;
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
const { pickWord, secondsLeft, typedRight } = await import("@/lib/hands-check");
const { undoBlock } = await import("@/lib/input-control");

const check = { title: "Can you still type and click?", what: "back to Ask", undoLabel: "Back to Ask", undo: "echo undo" };

describe("can you still type and click?", () => {
  let asked = 0;
  let unsub = () => {};
  beforeEach(() => {
    vi.useFakeTimers();
    started.length = 0;
    asked = 0;
    unsub = useArch.subscribe((st) => st.pendingConfirm && (asked++, queueMicrotask(() => st.pendingConfirm?.answer(true))));
    useArch.setState({ dryRun: false, handsCheck: null, savedConfirmCount: 2, pendingConfirm: null });
  });
  afterEach(() => {
    unsub();
    vi.useRealTimers();
  });

  it("not done in time: Fluff goes back by itself, without asking (you may have no hands to answer)", async () => {
    const p = useArch.getState().checkHands(check);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(useArch.getState().handsCheck?.undo).toBe("echo undo"); // shown, waiting
    expect(started).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await p).toBe(false);
    expect(started.map((s) => s.steps.map((x) => x.command))).toEqual([["echo undo"]]);
    expect(asked).toBe(0);
    expect(useArch.getState().handsCheck).toBeNull();
  });

  it("typed and clicked in time: nothing goes back, and a late clock changes nothing", async () => {
    const p = useArch.getState().checkHands(check);
    await vi.advanceTimersByTimeAsync(10_000);
    useArch.getState().handsCheck!.done(true);
    expect(await p).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(started).toEqual([]);
  });

  it("Go back now: at once", async () => {
    const p = useArch.getState().checkHands(check);
    useArch.getState().handsCheck!.done(false);
    expect(await p).toBe(false);
    expect(started).toHaveLength(1);
  });

  it("in Dry Run nothing changed, so there is nothing to check", async () => {
    useArch.setState({ dryRun: true });
    expect(await useArch.getState().checkHands(check)).toBe(true);
    expect(useArch.getState().handsCheck).toBeNull();
  });

  it("the word: one of Fluff's, typed as shown; the seconds count down to 0", () => {
    expect(pickWord(() => 0)).toBe("fluff");
    expect(pickWord(() => 0.9999)).toBe("mango");
    expect(typedRight(" Fluff ", "fluff")).toBe(true);
    expect(typedRight("fluf", "fluff")).toBe(false);
    expect(typedRight("", "fluff")).toBe(false);
    expect(secondsLeft(30_000, 0)).toBe(30);
    expect(secondsLeft(30_000, 29_001)).toBe(1);
    expect(secondsLeft(30_000, 40_000)).toBe(0);
  });

  it("after Block, the way back is to what it was before (Allow stays Allow, Block over Block goes to Ask)", () => {
    const s = { noPrompt: false, allowedApps: [], uinputOpen: false, uinputGivers: [], ourRule: true, ydotoolOn: false, busRule: "all" as const, doorShut: true, xtestWrapper: true, xtestForeign: false, xtestOffNow: false, krdpOn: false, affected: [] };
    expect(undoBlock("allow", s)).toContain("--key XwaylandEisNoPrompt true");
    expect(undoBlock("ask", s)).toContain("--key XwaylandEisNoPrompt false");
    expect(undoBlock("block", s)).toBe(undoBlock("ask", s));
    expect(undoBlock("ask", s)).toContain("sudo rm -f /etc/udev/rules.d/72-tuxcopilot-uinput.rules"); // the tablet's door open again
  });
});
