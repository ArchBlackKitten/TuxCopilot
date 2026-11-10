// Security → System as levels (Good security, Secured, Hardened, As it comes first). The fingerprints' record waits for Apply, like every record.
import { describe, expect, it } from "vitest";
import { applySystem, PARTS, systemCards, systemCommand, systemLevel, type SystemNow } from "@/lib/level-system";
import { presetCommand, SETTINGS } from "@/lib/hardening";
import { weeklyOffCommand, weeklyOnCommand, type WeeklyState } from "@/lib/weekly";

const usual = Object.fromEntries(SETTINGS.map((s) => [s.key, "9"]));
const rec = Object.fromEntries(SETTINGS.map((s) => [s.key, s.recommended]));
const strict = Object.fromEntries(SETTINGS.map((s) => [s.key, s.strict]));
const EXE = "/usr/bin/tuxcopilot";
const wk = (on: boolean, o: Partial<WeeklyState> = {}): WeeklyState => ({ on, files: on, exe: EXE, last: null, ...o });
const recorded = { when: "2026-11-05T10:00:00Z", files: {} };
const at = (values: Record<string, string>, fileThere: boolean, weekly: WeeklyState, r: typeof recorded | null): SystemNow => ({ kernel: { values, fileThere }, weekly, recorded: r, recordWaiting: false });

const arch = at(usual, false, wk(false), null);
const good = at(rec, true, wk(false), recorded);
const secured = at(rec, true, wk(true), recorded);
const hardened = at(strict, true, wk(true), recorded);

describe("System: As it comes · Good security · Secured · Hardened", () => {
  it("says the level it is at", () => {
    expect([arch, good, secured, hardened].map(systemLevel)).toEqual(["arch", "good", "secured", "hardened"]);
    expect(systemLevel({ ...good, recorded: null })).toBeNull(); // not recorded (or waiting for Apply): not yet Good
    expect(systemLevel({ ...arch, recorded })).toBe("arch"); // As it comes doesn't look at Fluff's record
    expect(systemLevel(at(rec, true, wk(false), null))).toBeNull();
    expect(PARTS.arch.fingerprints).toBeUndefined();
  });

  it("runs only what differs", () => {
    expect(systemCommand("good", arch)).toBe(presetCommand("recommended"));
    expect(systemCommand("secured", good)).toBe(weeklyOnCommand(EXE));
    expect(systemCommand("hardened", secured)).toBe(presetCommand("strict"));
    expect(systemCommand("arch", hardened)).toBe([presetCommand("usual"), weeklyOffCommand()].join(" && "));
    expect(systemCommand("good", good)).toBe("");
    // the timer's files left behind with the timer off: taken away too
    expect(systemCommand("good", { ...good, weekly: wk(false, { files: true }) })).toBe(weeklyOffCommand());
    expect(() => systemCommand("secured", { ...good, weekly: wk(false, { exe: null }) })).toThrow(/so the weekly checkup can't be switched on/);
  });

  it("the cards say what they set; without a TuxCopilot a timer can start, Secured and Hardened can't be chosen", () => {
    const c = systemCards(arch);
    expect(c.map((x) => x.id)).toEqual(["arch", "good", "secured", "hardened"]);
    expect(c[1].sets[0]).toBe(`the kernel: Recommended (${SETTINGS.length} settings change)`);
    expect(c[1].sets[2]).toMatch(/saved when you Apply/);
    expect(systemCards(good)[1].sets[2]).toMatch(/already recorded/);
    expect(c[3].caution).toBe(SETTINGS.filter((s) => s.strict !== s.recommended).map((s) => s.cost).join(" "));
    const noExe = systemCards({ ...arch, weekly: wk(false, { exe: null }) });
    expect(noExe.map((x) => !!x.unavailable)).toEqual([false, false, true, true]);
  });

  it("choosing a level: its commands, then the record put in your changes — once", async () => {
    const flow = async (to: "arch" | "good" | "secured" | "hardened", n: SystemNow, err: string | null = null) => {
      const ran: string[] = [];
      const staged: Array<{ kind: string; label: string }> = [];
      const r = await applySystem(to, n, {
        run: async (l, c) => (ran.push(`${l}: ${c}`), err),
        fingerprints: async () => [{ path: "/etc/x", sha256: "ab" }, { path: "/etc/y", sha256: "cd" }],
        stage: (c) => staged.push(c),
      });
      return { r, ran, staged };
    };
    const g = await flow("good", arch);
    expect(g.ran).toEqual([`System: Good security: ${presetCommand("recommended")}`]);
    expect(g.staged).toEqual([expect.objectContaining({ kind: "files.recorded", label: "Fluff's fingerprints: 2 files recorded" })]);
    expect((await flow("good", { ...arch, recordWaiting: true })).staged).toEqual([]); // already waiting
    expect((await flow("secured", good)).staged).toEqual([]); // already recorded
    expect((await flow("arch", { ...hardened, recorded: null })).staged).toEqual([]); // As it comes records nothing
    const failed = await flow("good", arch, "no");
    expect(failed.r).toBe("failed");
    expect(failed.staged).toEqual([]);
    expect((await flow("good", { ...arch, kernel: { values: rec, fileThere: true } })).ran).toEqual([]); // nothing to run: only the record
  });
});
