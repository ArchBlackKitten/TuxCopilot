// The screen lock.
import { describe, expect, it } from "vitest";
import { lockFindings, type ScreenLock } from "@/lib/screenlock";

// a sample computer
const here: ScreenLock = { autolock: true, timeoutMin: 5, lockOnResume: true, graceS: 0, laptop: true, lid: [["AC", 32], ["Battery", 32], ["LowBattery", 32]], autologin: null };
const warns = (s: ScreenLock) => lockFindings(s).filter((f) => f.level === "warn");

describe("the screen lock", () => {
  it("this computer: all as it should be", () => {
    expect(warns(here)).toEqual([]);
    expect(lockFindings(here).map((f) => f.text)).toEqual([
      "It locks by itself after 5 minutes without use.",
      "It locks when it wakes from sleep.",
      "Once locked, it needs your password at once.",
      "Closing the lid locks the screen.",
      "The login screen asks for your password: it never logs in by itself.",
    ]);
  });

  it("never by itself, too late, unlocked after sleep, a long grace: each said, each with its fix", () => {
    expect(warns({ ...here, autolock: false })[0].fix?.command).toMatch(/--key Autolock true && .*--key Timeout 5/);
    expect(warns({ ...here, timeoutMin: 60 })[0].text).toMatch(/only after 60 minutes/);
    expect(warns({ ...here, lockOnResume: false }).map((f) => f.fix?.label)).toContain("Lock after sleep");
    expect(warns({ ...here, graceS: 30 })[0].fix?.command).toMatch(/--key LockGrace 0/);
  });

  it("the lid: only turning the screen off, or nothing, leaves it unlocked; sleep is fine only when it locks after sleep", () => {
    const w = warns({ ...here, lid: [["AC", 64], ["Battery", 1], ["LowBattery", 0]] });
    expect(w[0].text).toMatch(/only turns the screen off \(plugged in\), does nothing \(on low battery\)/);
    expect(w[0].fix?.command).toMatch(/--group AC --group SuspendAndShutdown --key LidAction 32 && kwriteconfig6 .*--group LowBattery /);
    expect(warns({ ...here, lid: [["Battery", 1]] })).toEqual([]); // sleeps, and locks after sleep
    expect(warns({ ...here, lid: [["Battery", 1]], lockOnResume: false }).some((f) => /lid/.test(f.text))).toBe(true);
    expect(lockFindings({ ...here, laptop: false }).some((f) => /lid/.test(f.text))).toBe(false); // no lid
  });

  it("logging in by itself: said, with what protects it (the disk's own password)", () => {
    expect(warns({ ...here, autologin: "/etc/greetd/config.toml" })[0].text).toMatch(/logs in by itself \(\/etc\/greetd\/config\.toml\).*LUKS/);
  });
});
