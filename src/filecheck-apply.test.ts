// Fluff's own fingerprints are recorded through Apply, like every edit (host.guard: no view writes
// directly): "Record them" puts a change in your list; Apply writes it to the sealed database.
import { describe, expect, it, vi } from "vitest";

const calls: Array<[string, Record<string, unknown> | undefined]> = [];
vi.mock("@/lib/host", () => ({
  errText: (e: unknown) => String(e),
  inv: async (cmd: string, args?: Record<string, unknown>) => {
    calls.push([cmd, args]);
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
const { EMPTY_HISTORY } = await import("@/lib/changes");
const { record } = await import("@/lib/filecheck");

describe("recording Fluff's fingerprints waits for Apply", () => {
  it("staged first, written only by Apply, into the sealed database's setting", async () => {
    useArch.setState({ history: EMPTY_HISTORY, dryRun: false });
    const r = record([{ path: "/etc/x", sha256: "a".repeat(64) }], "2026-11-05T12:00:00Z");
    useArch.getState().stageChange({ kind: "files.recorded", label: "Fluff's fingerprints: 1 files recorded", value: r });
    expect(calls.filter(([c]) => c === "setting_set")).toEqual([]);
    expect(useArch.getState().history.pending.map((c) => c.kind)).toEqual(["files.recorded"]);
    await useArch.getState().apply();
    const set = calls.filter(([c, a]) => c === "setting_set" && a?.key === "files.recorded");
    expect(set).toHaveLength(1);
    expect(JSON.parse(String(set[0][1]!.value))).toEqual(r);
    expect(useArch.getState().history.pending).toEqual([]);
  });

  it("a second record before Apply replaces the first (the last one counts)", () => {
    useArch.setState({ history: EMPTY_HISTORY });
    for (const n of [1, 2]) useArch.getState().stageChange({ kind: "files.recorded", label: `r${n}`, value: record([], `t${n}`) });
    expect(useArch.getState().history.pending.map((c) => c.label)).toEqual(["r2"]);
  });
});
