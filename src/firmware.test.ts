// Firmware updates, through fwupd.
import { describe, expect, it } from "vitest";
import { installCommand, listAge, partOf, partWords, REFRESH, REFRESH_DAILY, type FirmwareUpdate } from "@/lib/firmware";

const u = (plugin: string, over: Partial<FirmwareUpdate> = {}): FirmwareUpdate => ({ deviceId: "0123456789abcd", name: "x", plugin, current: "1", version: "2", summary: "", urgency: "high", ...over });
const here = { secureBoot: false, fwupdEfi: true };

describe("firmware, in plain words", () => {
  it("four sample parts: the BIOS and Secure Boot's keys", () => {
    expect(["uefi_capsule", "uefi_kek", "uefi_db", "uefi_dbx"].map((p) => partOf(u(p)))).toEqual(["bios", "keys", "keys", "keys"]);
    expect(partWords(u("uefi_capsule"), here)).toMatch(/^The computer's own firmware \(BIOS\)\. Plug in the charger first.*Don't turn it off while it does\.$/);
    expect(partWords(u("uefi_dbx"), here)).toMatch(/Secure Boot is off on this computer, so they change nothing when it starts today/);
    expect(partWords(u("uefi_dbx"), { ...here, secureBoot: true })).toMatch(/fwupd checks first that your own bootloader isn't on that list/);
  });

  it("what Fluff warns about: the SSD, and a TPM update clearing TuxCopilot's tie", () => {
    expect(partWords(u("nvme"), here)).toMatch(/Keep a copy of what matters before/);
    expect(partWords(u("tpm"), here)).toMatch(/can clear the chip: TuxCopilot's lock tied to it/);
    expect(partWords(u("uefi_capsule"), { ...here, fwupdEfi: false })).toMatch(/fwupd may ask for fwupd-efi first/);
  });

  it("how old the list is; the commands", () => {
    expect(listAge({ listDate: 1787787663 }, 1787787663000 + 70 * 86400000)).toBe(70);
    expect(listAge({ listDate: null })).toBeNull();
    expect(installCommand(u("uefi_capsule"))).toBe("fwupdmgr update 0123456789abcd");
    expect(() => installCommand(u("x", { deviceId: "x; reboot" }))).toThrow();
    expect(REFRESH).toBe("fwupdmgr refresh --force");
    expect(REFRESH_DAILY).toBe("sudo systemctl enable --now fwupd-refresh.timer");
  });
});
