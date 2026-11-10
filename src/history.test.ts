// One history: each run that changed the system carries its own
// snapshot pair, found by the label both share and the time the pair was taken; nothing is left out.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { joinHistory, type RunRow } from "@/lib/history";
import { snapshotLabel, snapshotSteps } from "@/lib/snapshot";

// this computer's clock, as `date +%Y-%m-%dT%H:%M:%S` writes it (the test runs in any time zone)
const local = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const T = Date.UTC(2026, 10, 7, 9, 0, 0);
const run = (id: string, label: string, start: number, end: number, o: Partial<RunRow> = {}): RunRow => ({
  id, label, status: "success", dryRun: false, createdAt: new Date(start).toISOString(), updatedAt: new Date(end).toISOString(), ...o,
});
const snap = (pre: number, label: string, at: number) => ({ pre, post: pre + 1, when: local(at), label });

describe("one history: each change with its snapshot pair", () => {
  it("a run gets the pair with its label, taken while it ran", () => {
    const e = joinHistory([run("a", "Firewall: Home", T, T + 8_000)], [snap(41, "Firewall: Home", T + 7_000)], []);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ kind: "run", pair: { pre: 41, post: 42, unfinished: false, base: "Firewall: Home" } });
  });

  it("the same label twice: each run its own pair, by time", () => {
    const e = joinHistory(
      [run("new", "Devices: Good security", T + 60_000, T + 70_000), run("old", "Devices: Good security", T, T + 9_000)],
      [snap(50, "Devices: Good security", T + 8_000), snap(52, "Devices: Good security", T + 69_000)],
      [],
    );
    expect(e.map((x) => (x.kind === "run" ? [x.run.id, x.pair?.pre] : x.kind))).toEqual([["new", 52], ["old", 50]]);
  });

  it("written to the second: a pair that reads a moment before its run's start is still its own", () => {
    const e = joinHistory([run("a", "Kernel: Strict", T + 700, T + 900)], [snap(80, "Kernel: Strict", T + 800)], []); // when: T, to the second
    expect(e[0]).toMatchObject({ kind: "run", pair: { pre: 80 } });
    // the run before, of the same label, ended before it: not its pair
    const two = joinHistory([run("a", "Kernel: Strict", T + 700, T + 900), run("b", "Kernel: Strict", T - 400, T - 100)], [snap(80, "Kernel: Strict", T + 800)], []);
    expect(two.map((x) => (x.kind === "run" ? [x.run.id, x.pair?.pre ?? null] : x.kind))).toEqual([["a", 80], ["b", null]]);
  });

  it("two runs of one label close together, one pair: it goes to the run that holds its time, once", () => {
    const e = joinHistory([run("second", "DNS: Quad9", T + 2_000, T + 3_000), run("first", "DNS: Quad9", T, T + 1_500)], [snap(90, "DNS: Quad9", T + 1_000)], []);
    expect(e.map((x) => (x.kind === "run" ? [x.run.id, x.pair?.pre ?? null] : x.kind))).toEqual([["second", null], ["first", 90]]);
    // two pairs, both near both runs: each run its own
    const two = joinHistory([run("second", "DNS: Quad9", T + 2_000, T + 3_000), run("first", "DNS: Quad9", T, T + 1_500)], [snap(92, "DNS: Quad9", T + 2_000), snap(90, "DNS: Quad9", T + 1_000)], []);
    expect(two.map((x) => (x.kind === "run" ? [x.run.id, x.pair?.pre ?? null] : x.kind))).toEqual([["second", 92], ["first", 90]]);
  });

  it("two pairs one run could hold: one joined, the other listed — never lost", () => {
    const e = joinHistory([run("a", "Tor: on", T, T + 5_000)], [snap(95, "Tor: on", T + 3_000), snap(93, "Tor: on", T + 2_000)], []);
    expect(e.flatMap((x) => (x.kind === "run" ? [x.pair?.pre] : x.kind === "pair" ? [x.pair.pre] : [])).sort()).toEqual([93, 95]);
  });

  it("a pair taken after its run's last word (an interrupted run) is listed on its own", () => {
    expect(joinHistory([run("a", "Tor: on", T, T + 1_000)], [snap(97, "Tor: on", T + 2_000)], []).map((x) => x.kind).sort()).toEqual(["pair", "run"]);
  });

  it("not finished is said; a dry run never has one; another label or time isn't joined", () => {
    const [u] = joinHistory([run("a", "Network: Hardened", T, T + 5_000, { status: "failed" })], [snap(60, "Network: Hardened (not finished)", T + 4_000)], []);
    expect(u).toMatchObject({ kind: "run", pair: { unfinished: true, base: "Network: Hardened" } });
    const dry = joinHistory([run("d", "Network: Hardened", T, T + 5_000, { dryRun: true })], [snap(60, "Network: Hardened", T + 4_000)], []);
    expect(dry.map((x) => x.kind).sort()).toEqual(["pair", "run"]);
    expect(dry.find((x) => x.kind === "run")).toMatchObject({ pair: null });
    expect(joinHistory([run("a", "Network: Good security", T, T + 5_000)], [snap(60, "Network: Hardened", T + 4_000)], []).map((x) => x.kind).sort()).toEqual(["pair", "run"]);
    expect(joinHistory([run("a", "Network: Hardened", T, T + 5_000)], [snap(60, "Network: Hardened", T + 600_000)], []).map((x) => x.kind).sort()).toEqual(["pair", "run"]);
  });

  it("a pair whose run is older than the last 50 is still listed; everything newest first", () => {
    const e = joinHistory(
      [run("a", "Tor: on", T + 100_000, T + 101_000)],
      [snap(10, "Kernel: Strict", T - 86_400_000)],
      [{ app: "gimp", source: "pacman", noticedAt: new Date(T + 50_000).toISOString() }],
    );
    expect(e.map((x) => x.kind)).toEqual(["run", "removed", "pair"]);
    expect(e[2]).toMatchObject({ kind: "pair", at: new Date(T - 86_400_000).toISOString() });
  });

  it("a long label and quotes: matched as the snapshot itself carries it", () => {
    const label = "Apply: 3 system changes — Fluff's merge of /etc/pacman.conf and two more things";
    expect(snapshotSteps(label).after).toContain(`'TuxCopilot: ${snapshotLabel(label)}'`);
    const e = joinHistory([run("a", label, T, T + 5_000)], [snap(70, snapshotLabel(label), T + 4_000)], []);
    expect(e[0]).toMatchObject({ kind: "run", pair: { pre: 70 } });
  });

  it("History shows the pair under its run, with What it changed and Undo", () => {
    const v = readFileSync("src/components/arch/history-view.tsx", "utf8");
    expect(v).toContain("joinHistory(runs, snaps, removed)");
    expect(v).toContain("<PairLine pair={e.pair} after={() => void load()} />");
    expect(v).toContain("<PairLine pair={e.pair} after={() => void load()} alone />");
    const b = readFileSync("src/components/arch/fluff-snapshots-panel.tsx", "utf8");
    expect(b).toMatch(/if \(await run\(`What it changed: \$\{pair\.label\}`, whatChangedCommand\(pair\)\)\) return;\s+await run\(`Undo: \$\{pair\.label\}`, undoCommand\(pair\)\);/); // the files first, always
  });
});
