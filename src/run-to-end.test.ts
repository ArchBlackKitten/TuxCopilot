// A level is remembered only when its run really ran and every step ended well (runQuick says "no
// error" the moment a run starts, and when you said no at "Are you sure?"). And a change made in a Security
// panel is marked as made here, so a level that moves after it isn't said to have slipped.
import { describe, expect, it, vi } from "vitest";

let snap: Record<string, unknown> = { status: "success", label: "", okSteps: [0], output: "", total: 0, dryRun: false };
const started: Array<{ steps: Array<{ command: string }>; label: string }> = [];
vi.mock("@/lib/host", () => ({
  errText: (e: unknown) => String(e),
  inv: async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "run_start") started.push(args as never);
    if (cmd === "run_snapshot") return snap;
    if (cmd === "snapshot_ready") return false;
    return cmd === "tree_get" ? [] : null;
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
const { changedHereLabel, slipWords } = await import("@/lib/level-chosen");
const { storageModeCommand } = await import("@/lib/storage-control");
const { presetCommand } = await import("@/lib/hardening");
const { QUICK_MAX } = await import("@/lib/api");

const say = (answer: boolean) => useArch.setState({ askSureEdit: async (_l: string, c: string[]) => (answer ? c : null) } as never);

describe("a run, to its end", () => {
  it("ok only when it ran and every step ended well", async () => {
    say(true);
    snap = { status: "success", label: "Network: Good security", okSteps: [0], output: "", total: 0, dryRun: false };
    expect(await useArch.getState().runToEnd("Network: Good security", "true", false)).toEqual({ end: "ok" });
    snap = { ...snap, status: "failed", okSteps: [] };
    expect((await useArch.getState().runToEnd("Network: Good security", "false", false)).end).toBe("failed");
    snap = { ...snap, status: "stopped", okSteps: [0] }; // stopped by you: never "ok", whatever was done
    expect((await useArch.getState().runToEnd("Network: Good security", "true", false)).end).toBe("failed");
    snap = { ...snap, status: "success", okSteps: [] }; // a step that never ran
    expect((await useArch.getState().runToEnd("Network: Good security", "true", false)).end).toBe("failed");
    snap = { ...snap, label: "something else", okSteps: [0] }; // another run's end
    expect((await useArch.getState().runToEnd("Network: Good security", "true", false)).end).toBe("failed");
  });

  it("you said no: nothing ran, and it says so — never \"ok\"", async () => {
    say(false);
    started.length = 0;
    expect(await useArch.getState().runToEnd("Devices: Hardened", "true", false)).toEqual({ end: "no" });
    expect(started).toEqual([]);
    expect((await useArch.getState().runToEnd("Devices: Hardened", "true", true)).end).toBe("dry-run");
  });

  it("Security's long commands fit in a quick run, with or without snapper", async () => {
    const st = { mount: "yes" as const, driverRule: false, loaded: [], systemRemovable: false };
    const long = [storageModeCommand("block", st), storageModeCommand("ask", st), presetCommand("recommended"), presetCommand("strict")];
    for (const c of long) expect(c.length).toBeGreaterThan(2000); // the old limit refused them on a computer without snapper
    for (const c of long) expect(c.length).toBeLessThan(QUICK_MAX / 2);
    say(true);
    started.length = 0;
    expect(await useArch.getState().runQuick("USB sticks and SD cards: Block", long[0], false)).toBeNull();
    expect(started[0].steps[0].command).toBe(long[0]);
  });
});

describe("a change made in a Security panel is marked as made here", () => {
  it("a panel's run marks its sub-section; a level's own run, a Dry Run, At a glance and other sections don't", async () => {
    say(true);
    const s = useArch.getState();
    useArch.setState({ view: "security", securityTab: "devices", securityTouched: [] });
    await s.runToEnd("Devices: Good security", "true", false); // the cards' own
    await s.runQuick("USB sticks: Allow", "true", true); // Dry Run
    expect(useArch.getState().securityTouched).toEqual([]);
    await s.runQuick("USB sticks: Allow", "true", false);
    expect(useArch.getState().securityTouched).toEqual(["devices"]);
    await s.runQuick("again", "true", false);
    expect(useArch.getState().securityTouched).toEqual(["devices"]);
    useArch.setState({ securityTab: "glance" });
    await s.runQuick("x", "true", false);
    useArch.setState({ view: "services", securityTab: "network" });
    await s.runQuick("x", "true", false);
    expect(useArch.getState().securityTouched).toEqual(["devices"]);
    s.untouch("devices");
    expect(useArch.getState().securityTouched).toEqual([]);
  });

  it("what is said then", () => {
    expect(changedHereLabel("devices", "good")).toBe("Security → Devices: you changed it here, so Fluff stops watching that it stays Good security");
    expect(slipWords({ level: "good", when: "" }, "arch")).toMatch(/^You chose Good security/); // not marked: a slip, said
  });

  it("the sub-sections: the mark stays until the level is seen to move, then Fluff stops watching (waits for Apply)", async () => {
    const { readFileSync } = await import("node:fs");
    const v = readFileSync("src/components/arch/level-sections.tsx", "utf8");
    expect(v).toContain("if (!touched || !saved || now === undefined || !chosen || now === chosen.level) return;");
    expect(v).toContain("if (c) stageChange({ ...c, label: changedHereLabel(area, chosen.level) });");
    expect(v).toContain("const words = touched ? null : slipWords(chosen ?? null, now);");
    expect(v).toMatch(/if \(dryRun\) return; \/\/ nothing changed for real\n\s+untouch\(area\);/);
  });
});
