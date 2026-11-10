// Security → Devices, as levels (levels.ts): your keyboard and mouse, USB sticks and SD cards, USBGuard.
//                 keyboard & mouse   USB sticks & SD cards   USBGuard
//   As it comes   KDE's own          open, no password       off
//   Good security Ask                Ask                     off
//   Secured       Ask                Ask                     on
//   Hardened      Block              Block                   on
// Whatever takes your keyboard or mouse away (Block, USBGuard switched on) is followed by "Can you
// still type and click?" (hands-check.ts) — once for the whole level; not passed in time, and Fluff
// puts back what it changed. USBGuard starts at every boot only after you passed.

import type { InputControl } from "./input-control";
import { inputMode, inputModeCommand, inputArchCommand } from "./input-control";
import type { StorageControl } from "./storage-control";
import { storageMode, storageModeCommand } from "./storage-control";
import type { UsbGuard } from "./usbguard";
import { USBGUARD_AT_BOOT, USBGUARD_OFF, usbguardOnCommand } from "./usbguard";
import { blockCosts } from "./input-control";
import { levelLabel, levelOf, type Level, type LevelCard } from "./levels";

export interface DevicesNow {
  input: InputControl;
  storage: StorageControl;
  usbguard: UsbGuard;
}

type Parts = { input: "kde" | "ask" | "block"; storage: "allow" | "ask" | "block"; usbguard: "off" | "on" };

/** Keyboard and mouse: KDE's own (nothing of Fluff's, nobody always allowed), Ask finished, or Block. */
export function inputPart(s: InputControl): Parts["input"] | null {
  const m = inputMode(s);
  if (m === "block") return "block";
  if (m === "allow" || s.allowedApps.length || s.xtestWrapper || s.ourRule) return null;
  return s.busRule === "kwin" ? "ask" : s.busRule === "" ? "kde" : null;
}
export const usbguardPart = (u: UsbGuard): Parts["usbguard"] | null => (u.active && u.enabled ? "on" : !u.active && !u.enabled ? "off" : null);

export function devicesParts(n: DevicesNow): Record<Level, Parts> {
  const hardStorage = n.storage.systemRemovable ? "ask" : "block"; // Block would stop a system that starts from USB or SD
  return {
    arch: { input: "kde", storage: "allow", usbguard: "off" },
    good: { input: "ask", storage: "ask", usbguard: "off" },
    secured: { input: "ask", storage: "ask", usbguard: "on" },
    hardened: { input: "block", storage: hardStorage, usbguard: "on" },
  };
}

export const devicesLevel = (n: DevicesNow): Level | null =>
  levelOf({ input: inputPart(n.input), storage: storageMode(n.storage), usbguard: usbguardPart(n.usbguard) }, devicesParts(n));

export function devicesCards(n: DevicesNow): LevelCard[] {
  const costs = blockCosts(n.input);
  return [
    {
      id: "arch",
      what: "As Arch and KDE come.",
      sets: [
        "keyboard and mouse: KDE's own — its window asks, but KWin's door that has no window is open",
        "USB sticks and SD cards: open with no password",
        "USBGuard: off",
      ],
      caution: "A program of yours can open a USB stick behind your back, and KWin's door hands out your keyboard and mouse without a window.",
    },
    {
      id: "good",
      what: "No program takes your keyboard and mouse, or opens a USB stick, without asking you. Nothing stops working.",
      sets: ["keyboard and mouse: Ask — a window asks each time, the door without a window shut", "USB sticks and SD cards: Ask — opening one needs your password", "USBGuard: off"],
      caution: null,
    },
    {
      id: "secured",
      what: "Good security, and a USB device plugged in later is blocked until you allow it — against USB sticks that pretend to be a keyboard (BadUSB).",
      sets: [
        "keyboard and mouse: Ask",
        "USB sticks and SD cards: Ask",
        "USBGuard: on — what is plugged in now stays allowed; anything new waits for you in Devices",
      ],
      caution: "A new keyboard, mouse or stick does nothing until you allow it here. Fluff then checks you can still type and click, or switches USBGuard off by itself.",
    },
    {
      id: "hardened",
      what: "Nothing types or clicks for you, USB sticks and SD cards don't work at all, and new USB devices wait for you.",
      sets: [
        "keyboard and mouse: Block — deny all, no window asks",
        n.storage.systemRemovable ? "USB sticks and SD cards: Ask (your system starts from one, so Block would stop it starting)" : "USB sticks and SD cards: Block — the drivers refused",
        "USBGuard: on",
      ],
      caution: [n.storage.systemRemovable ? "" : "USB sticks and SD cards don't work at all.", ...costs.map((c) => `${c}.`), "Fluff checks you can still type and click, or puts it all back by itself."]
        .filter(Boolean)
        .join(" "),
    },
  ];
}

/** The command that sets a level from how it is now: only the parts that differ. Starting USBGuard
 *  here doesn't make it start at every boot yet (that waits for the hands check). */
export function devicesCommand(to: Level, n: DevicesNow): string {
  const want = devicesParts(n)[to];
  const steps: string[] = [];
  if (storageMode(n.storage) !== want.storage) steps.push(storageModeCommand(want.storage, n.storage));
  if (inputPart(n.input) !== want.input) steps.push(want.input === "kde" ? inputArchCommand(n.input) : inputModeCommand(want.input, n.input));
  const u = usbguardPart(n.usbguard);
  if (want.usbguard === "on" && !n.usbguard.active) steps.push(usbguardOnCommand(n.usbguard));
  if (want.usbguard === "off" && u !== "off") steps.push(USBGUARD_OFF);
  if (!steps.length && want.usbguard === "on" && !n.usbguard.enabled) return USBGUARD_AT_BOOT; // running, but not yet at every boot
  return steps.join(" && ");
}

/** What takes your hands away now, and the way back if you can't prove you still have them. */
export function devicesUndo(n: DevicesNow, after: DevicesNow): string | null {
  const back: string[] = [];
  if (inputPart(after.input) === "block" && inputPart(n.input) !== "block") back.push(inputModeCommand(inputMode(n.input) === "allow" ? "allow" : "ask", after.input));
  if (after.usbguard.active && !n.usbguard.active) back.push(USBGUARD_OFF);
  return back.length ? back.join(" && ") : null;
}

/** Choosing a level: run it, prove your hands if it took them, then USBGuard at every boot. */
export async function applyDevices(
  to: Level,
  n: DevicesNow,
  d: {
    run: (label: string, command: string) => Promise<string | null>;
    runEnd: () => Promise<unknown>;
    state: () => Promise<DevicesNow | null>;
    checkHands: (c: { title: string; what: string; undoLabel: string; undo: string }) => Promise<boolean>;
    dryRun: boolean;
  },
): Promise<"done" | "undone" | "dry-run" | "failed" | "nothing"> {
  const command = devicesCommand(to, n);
  if (!command) return "nothing";
  const label = `Devices: ${levelLabel(to)}`;
  if (await d.run(label, command)) return "failed";
  if (d.dryRun) return "dry-run";
  await d.runEnd();
  const after = await d.state();
  if (!after) return "done";
  const undo = devicesUndo(n, after);
  if (undo) {
    const passed = await d.checkHands({
      title: "Can you still type and click?",
      what: "what took them away is put back (keyboard and mouse control, USBGuard)",
      undoLabel: `${label}: put back`,
      undo,
    });
    if (!passed) return "undone";
  }
  if (devicesParts(n)[to].usbguard === "on" && after.usbguard.active && !after.usbguard.enabled) await d.run("USBGuard: at every start", USBGUARD_AT_BOOT);
  return "done";
}
