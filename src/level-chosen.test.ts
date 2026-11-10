// A level that slips: the level chosen in each Security sub-section
// is remembered through Apply, the weekly checkup gets its fingerprints, and a sub-section whose
// level moved says so and puts it back with one button.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const calls: Array<[string, Record<string, unknown> | undefined]> = [];
let saved: string | null = null;
vi.mock("@/lib/host", () => ({
  errText: (e: unknown) => String(e),
  inv: async (cmd: string, args?: Record<string, unknown>) => {
    calls.push([cmd, args]);
    if (cmd === "setting_get" && args?.key === "security.chosen") return saved;
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
const { chosenChange, chosenFor, holding, slipWords, withChosen, AREA_NAMES, WATCHED } = await import("@/lib/level-chosen");

const good = { level: "good" as const, when: "2026-11-07T10:00:00Z" };

describe("the level you chose, and the one now", () => {
  it("choosing: watched from Good security up; As it comes stops the watching", () => {
    expect(chosenChange("devices", "good", null)).toEqual({ kind: "security.chosen", label: "Security → Devices: Fluff watches that it stays Good security", area: "devices", level: "good" });
    expect(chosenChange("devices", "good", good)).toBeNull(); // already watched
    expect(chosenChange("devices", "arch", good)?.label).toBe("Security → Devices: Fluff stops watching its level");
    expect(chosenChange("devices", "arch", null)).toBeNull(); // nothing watched: nothing to stop
    expect(withChosen({ devices: good }, "network", "hardened", "t")).toEqual({ devices: good, network: { level: "hardened", when: "t" } });
    expect(withChosen({ devices: good }, "devices", "arch", "t")).toEqual({});
    expect(WATCHED).toEqual(["good", "secured", "hardened"]);
  });

  it("one waiting in your changes counts before the saved one", () => {
    const pending = [{ kind: "security.chosen" as const, label: "", area: "devices" as const, level: "secured" as const }];
    expect(chosenFor("devices", { devices: good }, pending)).toEqual({ level: "secured", when: "" });
    expect(chosenFor("devices", { devices: good }, [{ ...pending[0], level: "arch" }])).toBeNull();
    expect(chosenFor("network", { devices: good }, pending)).toBeNull();
    expect(chosenFor("devices", { devices: good }, [])).toBe(good);
  });

  it("says when the level moved — never while Fluff is still looking", () => {
    expect(slipWords(good, "good")).toBeNull();
    expect(slipWords(good, undefined)).toBeNull();
    expect(slipWords(null, "arch")).toBeNull();
    expect(slipWords(good, "arch")).toMatch(/^You chose Good security on .*2026, and now it is As it comes\. Something changed it: an update, another program, or a change by hand\./);
    expect(slipWords({ level: "hardened", when: "" }, null)).toMatch(/^You chose Hardened, and now it is a mix of your own\./);
  });

  it("the weekly checkup's fingerprints are taken again only where the level holds", () => {
    expect(holding({ devices: good, network: { level: "secured", when: "" }, system: good }, { devices: "good", network: "good", system: null })).toEqual({ devices: "good" });
  });

  it("the names are the ones the weekly checkup says (marks.rs)", () => {
    const rs = readFileSync("src-tauri/src/marks.rs", "utf8");
    for (const [a, n] of Object.entries(AREA_NAMES)) expect(rs).toContain(`("${a}", "${n}")`);
  });
});

describe("remembered through Apply, like every edit", () => {
  it("staged first; Apply saves the levels, then gives the weekly checkup their fingerprints", async () => {
    calls.length = 0;
    saved = JSON.stringify({ system: good });
    useArch.setState({ history: EMPTY_HISTORY, dryRun: false });
    const stage = useArch.getState().stageChange;
    stage(chosenChange("devices", "secured", null)!);
    stage(chosenChange("devices", "hardened", null)!); // the same sub-section again: the last counts
    stage(chosenChange("network", "good", null)!);
    stage(chosenChange("system", "arch", good)!);
    expect(useArch.getState().history.pending.map((c) => c.label)).toEqual([
      "Security → Devices: Fluff watches that it stays Hardened",
      "Security → Network: Fluff watches that it stays Good security",
      "Security → System: Fluff stops watching its level",
    ]);
    expect(calls.filter(([c]) => c === "setting_set" || c === "security_marks_save")).toEqual([]);
    await useArch.getState().apply();
    const sets = calls.filter(([c, a]) => c === "setting_set" && a?.key === "security.chosen").map(([, a]) => JSON.parse(String(a!.value)));
    const last = sets.at(-1);
    expect(Object.keys(last).sort()).toEqual(["devices", "network"]);
    expect([last.devices.level, last.network.level]).toEqual(["hardened", "good"]);
    const marks = calls.filter(([c]) => c === "security_marks_save");
    expect(marks).toEqual([["security_marks_save", { levels: { devices: "hardened", network: "good", system: "arch" } }]]);
    expect(calls.findIndex(([c]) => c === "security_marks_save")).toBeGreaterThan(calls.findLastIndex(([c, a]) => c === "setting_set" && a?.key === "security.chosen"));
    expect(useArch.getState().history.pending).toEqual([]);
  });

  it("every sub-section shows the slip and remembers only a choice that ended well", () => {
    const v = readFileSync("src/components/arch/level-sections.tsx", "utf8");
    // the level now is given to useChosen (it also needs it for "you changed it here")
    expect(v.match(/slip=\{slip\}/g)).toHaveLength(4);
    for (const [a, f] of [["devices", "devicesLevel"], ["system", "systemLevel"]]) expect(v).toContain(`useChosen("${a}", n ? ${f}(n) : undefined)`);
    for (const f of ["networkCommand, networkLevel", "accountsCommand, accountsLevel"]) expect(v).toContain(f);
    expect(v).toContain("const r = await runToEnd(label, command, dryRun);"); // to its end, never only started
    expect(v).toContain('if (r === "done" || r === "nothing") remember(l);');
    expect(v).toContain("if (!(await run(`${name}: ${levelLabel(l)}`, c))) remember(l);");
    expect(v).toContain('stage: stageChange })) === "done") remember(l);');
    expect(v).toMatch(/if \(dryRun\) return; \/\/ nothing changed for real/);
    const cards = readFileSync("src/components/arch/level-cards.tsx", "utf8");
    expect(cards).toContain("onClick={() => onChoose(slip.back)}"); // putting it back is choosing it again: only what differs runs
  });
});
