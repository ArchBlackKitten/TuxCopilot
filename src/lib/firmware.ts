// Firmware updates, through fwupd, in plain words: what each part is,
// what installing it means, and what it can't change. Installing runs fwupd in a terminal window,
// where you answer it (runner.rs may_ask).

import { inv } from "./host";

export interface FirmwareUpdate {
  deviceId: string;
  name: string;
  plugin: string;
  current: string;
  version: string;
  summary: string;
  urgency: string;
}
export interface Firmware {
  updates: FirmwareUpdate[];
  listDate: number | null;
  refreshTimer: boolean;
  secureBoot: boolean | null;
  fwupdEfi: boolean;
  available: boolean;
}
export const firmwareState = () => inv<Firmware>("firmware_state"); // firmware.rs

export type Part = "bios" | "keys" | "disk" | "tpm" | "other";
export const partOf = (u: Pick<FirmwareUpdate, "plugin">): Part =>
  u.plugin === "uefi_capsule" ? "bios" : /^uefi_(dbx|kek|db|pk)$/.test(u.plugin) ? "keys" : u.plugin === "nvme" ? "disk" : u.plugin === "tpm" ? "tpm" : "other";

/** What installing it means, before you do. */
export function partWords(u: FirmwareUpdate, f: Pick<Firmware, "secureBoot" | "fwupdEfi">): string {
  switch (partOf(u)) {
    case "bios":
      return `The computer's own firmware (BIOS). Plug in the charger first: the computer restarts and updates it before Linux starts — a few minutes, maybe a black screen. Don't turn it off while it does.${f.fwupdEfi ? "" : " fwupd may ask for fwupd-efi first."}`;
    case "keys":
      return f.secureBoot === false
        ? "Secure Boot's keys (Microsoft's 2011 ones expire in 2026; dbx is the list of bootloaders known to be unsafe). Secure Boot is off on this computer, so they change nothing when it starts today; they are ready if you switch it on."
        : "Secure Boot's keys (Microsoft's 2011 ones expire in 2026; dbx is the list of bootloaders known to be unsafe). fwupd checks first that your own bootloader isn't on that list.";
    case "disk":
      return "Your SSD's own firmware. Keep a copy of what matters before: a disk update rarely fails, but when it does the disk can be lost.";
    case "tpm":
      return "The TPM chip's firmware. Updating it can clear the chip: TuxCopilot's lock tied to it (and a disk unlocked by it) would then need your seed words or your disk password.";
    default:
      return "The firmware of a part of this computer.";
  }
}

export const URGENCY_WORDS: Record<string, string> = { critical: "critical", high: "important", medium: "recommended", low: "optional" };

/** How old fwupd's list of updates is, in days (null: never fetched). */
export const listAge = (f: Pick<Firmware, "listDate">, now = Date.now()): number | null => (f.listDate ? Math.floor((now / 1000 - f.listDate) / 86400) : null);

export const REFRESH = "fwupdmgr refresh --force";
export const REFRESH_DAILY = "sudo systemctl enable --now fwupd-refresh.timer";

/** Install one part's update: fwupd asks you before flashing, and about restarting. */
export function installCommand(u: Pick<FirmwareUpdate, "deviceId">): string {
  if (!/^[0-9a-f]{12,64}$/.test(u.deviceId)) throw new Error("not a device fwupd listed");
  return `fwupdmgr update ${u.deviceId}`;
}
