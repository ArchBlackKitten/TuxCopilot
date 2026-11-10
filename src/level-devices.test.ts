// Security → Devices as levels: Tor's template (Good security, Secured, Hardened), and you can
// always go back to Arch's own settings.
import { describe, expect, it } from "vitest";
import { applyDevices, devicesCards, devicesCommand, devicesLevel, devicesUndo, inputPart, type DevicesNow } from "@/lib/level-devices";
import { inputArchCommand, inputModeCommand, type InputControl } from "@/lib/input-control";
import { storageModeCommand, type StorageControl } from "@/lib/storage-control";
import { USBGUARD_AT_BOOT, USBGUARD_OFF, usbguardOnCommand, type UsbGuard } from "@/lib/usbguard";
import { LEVELS, levelOf, RECOMMENDED, type Level } from "@/lib/levels";

const kde: InputControl = {
  noPrompt: false, allowedApps: [], uinputOpen: true, uinputGivers: [], ourRule: false, ydotoolOn: false,
  busRule: "", doorShut: false, xtestWrapper: false, xtestForeign: false, xtestOffNow: false, krdpOn: false, affected: [],
};
const ask: InputControl = { ...kde, busRule: "kwin", doorShut: true };
const block: InputControl = { ...kde, ourRule: true, uinputOpen: false, busRule: "all", doorShut: true, xtestWrapper: true, xtestOffNow: true };
const st = (mount: StorageControl["mount"], driverRule = false, systemRemovable = false): StorageControl => ({ mount, driverRule, loaded: [], systemRemovable });
const off: UsbGuard = { installed: true, active: false, enabled: false, blocked: null };
const on: UsbGuard = { installed: true, active: true, enabled: true, blocked: [] };

const arch: DevicesNow = { input: kde, storage: st("yes"), usbguard: { ...off, installed: false } };
const good: DevicesNow = { input: ask, storage: st("ask"), usbguard: off };
const secured: DevicesNow = { ...good, usbguard: on };
const hardened: DevicesNow = { input: block, storage: st("no", true), usbguard: on };

describe("the template (levels.ts)", () => {
  it("four levels, As it comes first — the way back — and Fluff recommends Good security", () => {
    expect(LEVELS.map((l) => l.label)).toEqual(["As it comes", "Good security", "Secured", "Hardened"]);
    expect(RECOMMENDED).toBe("good");
  });
  it("a level counts only when every part matches; a part not read never matches", () => {
    const parts: Record<Level, Partial<{ a: number; b: number }>> = { arch: { a: 1 }, good: { a: 2, b: 1 }, secured: { a: 2, b: 2 }, hardened: { a: 3 } };
    expect(levelOf({ a: 2, b: 2 }, parts)).toBe("secured");
    expect(levelOf({ a: 2, b: 3 }, parts)).toBeNull();
    expect(levelOf({ a: null, b: 1 }, parts)).toBeNull();
    expect(levelOf({ a: 3, b: 9 }, parts)).toBe("hardened"); // a part a level doesn't set is not looked at
  });
});

describe("Devices: As it comes · Good security · Secured · Hardened", () => {
  it("says the level this computer is at", () => {
    expect([arch, good, secured, hardened].map(devicesLevel)).toEqual(["arch", "good", "secured", "hardened"]);
    expect(devicesLevel({ ...good, storage: st("yes") })).toBeNull(); // a mix: chosen in the panels
    expect(devicesLevel({ ...secured, usbguard: { ...on, enabled: false } })).toBeNull(); // on until the next restart only
    expect(devicesLevel({ ...good, input: { ...ask, allowedApps: ["xdotool"] } })).toBeNull(); // someone always allowed
    expect(inputPart({ ...kde, noPrompt: true })).toBeNull(); // Allow is nobody's level
    // a system that starts from USB or SD: Hardened keeps them on Ask
    expect(devicesLevel({ ...hardened, storage: st("ask", false, true) })).toBe("hardened");
  });

  it("each card says everything it sets; Hardened says what stops working", () => {
    const cards = devicesCards({ ...arch, input: { ...kde, uinputGivers: ["opentabletdriver"] } });
    expect(cards.map((c) => c.id)).toEqual(["arch", "good", "secured", "hardened"]);
    for (const c of cards) expect(c.sets).toHaveLength(3);
    expect(cards[0].sets.join(" ")).toMatch(/USBGuard: off/);
    expect(cards[1].caution).toBeNull();
    expect(cards[3].caution).toMatch(/don't work at all.*OpenTabletDriver \(your drawing tablet\) stops working\..*puts it all back by itself/);
    const removable = devicesCards({ ...arch, storage: st("yes", false, true) })[3];
    expect(removable.sets[1]).toMatch(/^USB sticks and SD cards: Ask \(your system starts from one/);
    expect(removable.caution).not.toMatch(/don't work at all/);
  });

  it("runs only what differs, from how it is now", () => {
    expect(devicesCommand("good", arch)).toBe([storageModeCommand("ask", arch.storage), inputModeCommand("ask", kde)].join(" && "));
    expect(devicesCommand("secured", good)).toBe(usbguardOnCommand(off));
    expect(devicesCommand("hardened", secured)).toBe([storageModeCommand("block", good.storage), inputModeCommand("block", ask)].join(" && "));
    expect(devicesCommand("arch", hardened)).toBe([storageModeCommand("allow", hardened.storage), inputArchCommand(block), USBGUARD_OFF].join(" && "));
    expect(devicesCommand("good", good)).toBe("");
    expect(devicesCommand("secured", { ...secured, usbguard: { ...on, enabled: false } })).toBe(USBGUARD_AT_BOOT);
    // USBGuard not installed and Good asked for: nothing to switch off
    expect(devicesCommand("good", { ...good, usbguard: { ...off, installed: false } })).toBe("");
  });

  it("the way back puts back only what took your hands", () => {
    expect(devicesUndo(good, hardened)).toBe([inputModeCommand("ask", block), USBGUARD_OFF].join(" && "));
    expect(devicesUndo(secured, hardened)).toBe(inputModeCommand("ask", block)); // USBGuard was on before: stays
    expect(devicesUndo(arch, good)).toBeNull(); // Ask takes nothing away
  });

  it("choosing a level: one hands check for all of it; USBGuard at every boot only after it", async () => {
    const flow = async (from: DevicesNow, to: "good" | "secured" | "hardened" | "arch", after: DevicesNow, opts: { passed?: boolean; err?: string; dryRun?: boolean } = {}) => {
      const ran: string[] = [];
      const hands: string[] = [];
      const r = await applyDevices(to, from, {
        run: async (l, c) => (ran.push(`${l}: ${c}`), opts.err ?? null),
        runEnd: async () => ({}),
        state: async () => after,
        checkHands: async (c) => (hands.push(c.undo), opts.passed ?? true),
        dryRun: opts.dryRun ?? false,
      });
      return { r, ran, hands };
    };
    const startedOnly = { ...hardened, usbguard: { ...on, enabled: false } };
    const ok = await flow(good, "hardened", startedOnly);
    expect(ok.r).toBe("done");
    expect(ok.hands).toEqual([[inputModeCommand("ask", block), USBGUARD_OFF].join(" && ")]);
    expect(ok.ran).toEqual([`Devices: Hardened: ${devicesCommand("hardened", good)}`, `USBGuard: at every start: ${USBGUARD_AT_BOOT}`]);
    const undone = await flow(good, "hardened", startedOnly, { passed: false });
    expect(undone.r).toBe("undone");
    expect(undone.ran).toHaveLength(1); // never at every boot
    expect((await flow(arch, "good", good)).hands).toEqual([]); // nothing taken away: no check
    expect((await flow(good, "hardened", startedOnly, { dryRun: true })).r).toBe("dry-run");
    expect((await flow(good, "hardened", startedOnly, { err: "no" })).r).toBe("failed");
    expect((await flow(good, "good", good)).r).toBe("nothing");
    // a level with USBGuard off never makes it start at every boot, even if it is still running after
    const stillOn = await flow({ ...good, usbguard: { ...on, enabled: false } }, "good", { ...good, usbguard: { ...on, enabled: false } });
    expect(stillOn.ran.some((r) => r.includes(USBGUARD_AT_BOOT))).toBe(false);
  });
});
