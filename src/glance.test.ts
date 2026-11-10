// Security at a glance: each protection said against Fluff's recommendation, with where to change it.
import { describe, expect, it } from "vitest";
import { anchorOf, glance, toLook, type GlanceInput } from "@/lib/glance";
import type { InputControl } from "@/lib/input-control";
import type { Firmware } from "@/lib/firmware";
import type { ScreenLock } from "@/lib/screenlock";
import type { FirewallState } from "@/lib/firewall";
import { SETTINGS } from "@/lib/hardening";

const input: InputControl = {
  noPrompt: false, allowedApps: [], uinputOpen: true, uinputGivers: [], ourRule: false, ydotoolOn: false, busRule: "kwin",
  doorShut: true, xtestWrapper: false, xtestForeign: false, xtestOffNow: false, krdpOn: false, affected: [],
};
const fw = (on: boolean): FirewallState => ({
  firewalldInstalled: true, firewalldOn: on, ufwInstalled: false, ufwOn: false, defaultZone: "public", zones: [], servicePorts: [], networks: [], presetZones: [],
});
const firmware: Firmware = {
  updates: [{ deviceId: "a", name: "System Firmware", plugin: "uefi_capsule", current: "1.40.0", version: "1.52.0", summary: "", urgency: "high" }],
  listDate: Date.UTC(2026, 7, 27) / 1000, refreshTimer: false, secureBoot: false, fwupdEfi: true, available: true,
};
const screen: ScreenLock = { autolock: true, timeoutMin: 5, lockOnResume: true, graceS: 0, laptop: true, lid: [["AC", 1]], autologin: null };
const usual = Object.fromEntries(SETTINGS.map((s) => [s.key, "9"])); // none at the recommended value
const recommended = Object.fromEntries(SETTINGS.map((s) => [s.key, s.recommended]));

/** A sample laptop. */
const here: GlanceInput = {
  firewall: fw(true),
  packages: [],
  firmware,
  input,
  storage: { mount: "yes", driverRule: false, loaded: [], systemRemovable: false },
  usbguard: { installed: false, active: false, enabled: false, blocked: null },
  groups: [
    { name: "wheel", gid: 998, listed: true, thisLogin: true, primary: false, others: 0 },
    { name: "docker", gid: 960, listed: true, thisLogin: true, primary: false, others: 0 },
  ],
  screen,
  logins: { failures: [], since: "2026-10-31 09:00:00+0100" },
  files: "none",
  kernel: { values: usual, fileThere: false },
};
const byId = (i: GlanceInput, now = Date.UTC(2026, 10, 5)) => Object.fromEntries(glance(i, now).map((r) => [r.id, r]));

describe("Security at a glance", () => {
  // the firmware is in Security → System (and in Updates too)
  it("every row opens a sub-section of Security — the firmware's is System", () => {
    const rows = glance(here);
    expect(rows.map((r) => r.id)).toEqual(["firewall", "packages", "firmware", "input", "storage", "usbguard", "groups", "screenlock", "logins", "files", "kernel"]);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.place]))).toEqual({
      firewall: "network", packages: "system", firmware: "system", input: "devices", storage: "devices", usbguard: "devices",
      groups: "accounts", screenlock: "accounts", logins: "accounts", files: "system", kernel: "system",
    });
    expect(anchorOf("kernel")).toBe("sec-kernel"); // security-view's Spot ids, and firmware-panel's sec-firmware
  });

  it("says the laptop as it is: what Fluff would change, and what is fine", () => {
    const r = byId(here);
    expect(r.firewall.level).toBe("good");
    expect(r.packages.level).toBe("good");
    expect(r.firmware).toMatchObject({ level: "look" });
    expect(r.firmware.now).toMatch(/1 firmware update waiting, 1 important\. fwupd's list is 70 days old/);
    expect(r.input.level).toBe("good"); // Ask, finished
    expect(r.storage).toMatchObject({ level: "look", fluff: "Ask." });
    expect(r.usbguard.level).toBe("yours"); // never "look": Fluff doesn't push it
    expect(r.groups.level).toBe("look");
    expect(r.groups.now).toMatch(/^In docker:/); // wheel is an administrator, not root without a password
    expect(r.screenlock.level).toBe("good");
    expect(r.logins.level).toBe("good");
    expect(r.logins.now).toMatch(/as far back as the journal reaches/);
    expect(r.files).toMatchObject({ level: "look", now: "No fingerprints recorded yet." });
    expect(r.kernel.level).toBe("look");
    expect(r.kernel.fluff).toMatch(new RegExp(`changes ${SETTINGS.length} settings`));
    expect(toLook(glance(here))).toBe(5);
  });

  it("goes good where Fluff's recommendation is followed", () => {
    const r = byId({
      ...here,
      firmware: { ...firmware, updates: [], refreshTimer: true },
      storage: { mount: "ask", driverRule: false, loaded: [], systemRemovable: false },
      groups: [{ name: "wheel", gid: 998, listed: true, thisLogin: true, primary: false, others: 0 }],
      files: { when: "2026-11-05T10:00:00Z", files: {} },
      kernel: { values: recommended, fileThere: true },
    });
    expect([r.firmware.level, r.storage.level, r.groups.level, r.kernel.level]).toEqual(["good", "good", "good", "good"]);
    expect(r.files.level).toBe("yours"); // recorded, but only Check can say nothing changed
    expect(r.kernel.now).toBe("Recommended.");
  });

  it("says what needs changing", () => {
    const r = byId({
      ...here,
      firewall: fw(false),
      input: { ...input, noPrompt: true },
      screen: { ...screen, autolock: false },
      logins: { failures: [{ when: "2026-11-04 10:00:00+0100", place: "ssh", user: "root", from: "203.0.113.9" }], since: null },
    });
    expect(r.firewall).toMatchObject({ level: "look", fluff: "Switch the firewall on (Network)." });
    expect(r.input).toMatchObject({ level: "look", fluff: "Ask." });
    expect(r.screenlock).toMatchObject({ level: "look", fluff: "Lock after 5 minutes" });
    expect(r.logins.level).toBe("look");
    // Ask without KWin's door shut is not yet Ask
    expect(byId({ ...here, input: { ...input, busRule: "" } }).input).toMatchObject({ level: "look", fluff: "Press Ask again." });
  });

  it("only says 'look' when there is something to do", () => {
    const pkg = (fixedIn: string | null) => ({ package: "openssl", installed: "3.5.0-1", explicit: false, worst: "Medium" as const, fixedIn, findings: [], advice: "" });
    // on Arch's list, but no fix yet: nothing to do but keep updating
    expect(byId({ ...here, packages: [pkg(null)] }).packages.level).toBe("good");
    expect(byId({ ...here, packages: [pkg("3.5.1-1")] }).packages).toMatchObject({ level: "look", fluff: "Update: the fix is waiting." });
    // a wrong password or two at this computer: probably you — said, not alarmed
    const once = { when: "2026-11-04 10:00:00+0100", place: "sudo", user: "me", from: "" };
    expect(byId({ ...here, logins: { failures: [once], since: null } }).logins.level).toBe("yours");
    expect(byId({ ...here, logins: { failures: Array(5).fill(once), since: null } }).logins.level).toBe("look");
  });

  it("never guesses: still looking, or couldn't read", () => {
    const empty = glance({});
    expect(empty.every((r) => r.level === "unknown" && r.now === "Fluff is looking…")).toBe(true);
    expect(toLook(empty)).toBe(0);
    const failed = glance(Object.fromEntries(Object.keys(here).map((k) => [k, null])) as GlanceInput);
    expect(failed.every((r) => r.level === "unknown" && r.now === "Fluff couldn't read it.")).toBe(true);
    expect(byId({ ...here, firmware: { ...firmware, available: false } }).firmware.level).toBe("yours");
  });
});

describe("the template in every sub-section: cards", () => {
  it("each sub-section opens with its level cards, and At a glance shows each one's level", async () => {
    const { readFileSync } = await import("node:fs");
    const v = readFileSync("src/components/arch/security-view.tsx", "utf8");
    for (const [tab, cards] of [["network", "NetworkLevels"], ["devices", "DevicesLevels"], ["accounts", "AccountsLevels"], ["system", "SystemLevels"]]) {
      const body = v.split(`<TabsContent value="${tab}"`)[1].split("</TabsContent>")[0];
      expect(body.trim().split("\n")[1].trim(), tab).toBe(`<${cards} />`); // first, above the panels
    }
    expect(v.split('<TabsContent value="glance"')[1].split("</TabsContent>")[0]).toContain("<Glance />");
    expect(v).toMatch(/function Glance\(\)[^]*?<LevelsAtAGlance \/>/);
    // the firmware: in System as well as Updates
    expect(v.split('<TabsContent value="system"')[1].split("</TabsContent>")[0]).toContain("<FirmwarePanel />");
    expect(readFileSync("src/components/arch/updates-view.tsx", "utf8")).toContain("<FirmwarePanel />");
  });
});
