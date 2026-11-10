// USBGuard, for the danger the storage switch doesn't cover. A USB stick that pretends to be
// a keyboard ("BadUSB") can type commands faster than you can see. With USBGuard on, every USB
// device that wasn't plugged in when you switched it on is blocked until you allow it here.
//
// Switching on is built so it can't lock you out:
//   1. the rules are written from what is plugged in now (never over rules Fluff didn't write),
//      and USBGuard is started — but not yet at every boot: a restart would clear it;
//   2. "Can you still type and click?" (hands-check.ts): not passed in time, and Fluff switches it
//      off by itself and lets every USB device in again;
//   3. passed: then it starts at every boot.
// USBGuard leaves the USB ports closed when it stops, so Off opens them again itself.

import { inv } from "./host";

export interface UsbDevice {
  number: number;
  id: string;
  name: string;
  interfaces: string[];
  port: string;
}
export interface UsbGuard {
  installed: boolean;
  active: boolean;
  enabled: boolean;
  blocked: UsbDevice[] | null;
}
export const usbguardState = () => inv<UsbGuard>("usbguard_state"); // usbguard.rs

export const RULES = "/etc/usbguard/rules.conf";
export const ACCESS_DIR = "/etc/usbguard/IPCAccessControl.d";
export const USB_DEVICES = "/sys/bus/usb/devices";

// as root: the rules from what is plugged in now (-P: a device without a serial number isn't tied
// to its port, so moving your keyboard to another port is fine), and a "list only" access for you
const POLICY_SCRIPT = [
  "set -eu",
  `f=${RULES}`,
  'if [ -s "$f" ] && ! head -n1 "$f" | grep -q "^# TuxCopilot"; then echo "Fluff: $f already has rules Fluff did not write, so they are left alone." >&2; exit 1; fi',
  "umask 077",
  '{ echo "# TuxCopilot: the USB devices plugged in when USBGuard was switched on (Security). Others are blocked until you allow them."; usbguard generate-policy -P; } > "$f.new"',
  'mv -f -- "$f.new" "$f"',
  `a=${ACCESS_DIR}/$1`,
  '[ -e "$a" ] || printf "Devices=list,listen\\n" > "$a"',
].join("; ");

const CHECK = `sleep 1 && b=$(usbguard list-devices --blocked) && { [ -z "$b" ] || { echo "Fluff: USBGuard blocked something plugged in now: $b" >&2; false; }; }`;

/** Step 1: installed if needed (the whole system updated first), the rules, and started — not yet at boot. */
export function usbguardOnCommand(s: UsbGuard): string {
  return [...(s.installed ? [] : ["sudo pacman -Syu --needed usbguard"]), `sudo sh -c '${POLICY_SCRIPT}' fluff-usbguard "$USER"`, "sudo systemctl start usbguard.service", CHECK].join(" && ");
}

/** Step 3, after you passed "type and click": it starts at every boot too — checked. */
export const USBGUARD_AT_BOOT = `sudo systemctl enable usbguard.service && { systemctl is-enabled -q usbguard.service || { echo "Fluff: USBGuard isn't set to start at every boot." >&2; false; }; }`;

/** Off: stopped, not at boot, and every USB port and device let in again (USBGuard leaves them
 *  closed) — each one counted, not only the last, and all checked open after. */
export const USBGUARD_OFF = [
  "sudo systemctl disable --now usbguard.service",
  `{ ! systemctl is-active -q usbguard.service || { echo "Fluff: USBGuard is still running." >&2; false; }; }`,
  `{ bad=; for c in ${USB_DEVICES}/usb*/authorized_default ${USB_DEVICES}/*/authorized; do [ -e "$c" ] || continue; [ "$(cat "$c")" = 1 ] || { echo 1 | sudo tee "$c" >/dev/null; [ "$(cat "$c")" = 1 ] || bad="$bad $c"; }; done; [ -z "$bad" ] || { echo "Fluff: still closed:$bad" >&2; false; }; }`,
  'echo "Fluff: USBGuard is off, and every USB device plugged in now is let in."',
].join(" && ");

/** Let a blocked device in: once (until it is unplugged), or for good. */
export function allowCommand(d: Pick<UsbDevice, "number">, forGood: boolean): string {
  if (!Number.isInteger(d.number) || d.number < 0) throw new Error("not a device USBGuard listed");
  return `sudo usbguard allow-device ${forGood ? "-p " : ""}${d.number}`;
}

const KIND: Record<string, string> = {
  "01": "sound",
  "02": "network",
  "03": "a keyboard, mouse or game controller",
  "06": "a camera (pictures)",
  "07": "a printer",
  "08": "a USB stick or disk",
  "09": "a USB hub",
  "0a": "network",
  "0b": "a smart card reader",
  "0e": "a webcam",
  e0: "wireless (Bluetooth)",
  ff: "the maker's own kind",
};

/** What it says it is. A USB stick that also says "keyboard" is what BadUSB looks like. */
export function deviceSays(d: Pick<UsbDevice, "interfaces">): { kinds: string[]; warn: string | null } {
  const classes = [...new Set(d.interfaces.map((i) => i.split(":")[0].toLowerCase()))];
  const kinds = classes.map((c) => KIND[c] ?? `kind ${c}`);
  const typing = classes.includes("03");
  const warn = typing && classes.some((c) => c !== "03")
    ? "It says it is a keyboard or mouse AND something else: that is what a BadUSB looks like. Allow it only if you know why."
    : typing
      ? "It can type and click: allow it only if it is the keyboard or mouse you just plugged in."
      : null;
  return { kinds, warn };
}

/** The whole switch-on: start, prove your hands, then at every boot — or off by itself. */
export async function switchOn(
  g: UsbGuard,
  d: {
    run: (label: string, command: string) => Promise<string | null>;
    runEnd: () => Promise<unknown>;
    state: () => Promise<UsbGuard | null>;
    checkHands: (c: { title: string; what: string; undoLabel: string; undo: string }) => Promise<boolean>;
    dryRun: boolean;
  },
): Promise<"at-boot" | "undone" | "not-started" | "dry-run" | "failed"> {
  const err = await d.run("USBGuard: on", usbguardOnCommand(g));
  if (err) return "failed";
  if (d.dryRun) return "dry-run";
  await d.runEnd();
  const after = await d.state();
  // whatever the run said: if it is running now, prove you still have your keyboard and mouse
  if (!after?.active || g.active) return "not-started";
  const passed = await d.checkHands({ title: "Can you still type and click?", what: "USBGuard is switched off and every USB device is let in again", undoLabel: "USBGuard: off", undo: USBGUARD_OFF });
  if (!passed) return "undone";
  await d.run("USBGuard: at every start", USBGUARD_AT_BOOT);
  return "at-boot";
}
