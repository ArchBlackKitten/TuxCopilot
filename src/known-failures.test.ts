// Fluff knows common failures: a failed service is said in plain words, with what to do. For
// example drkonqi-coredump-pickup.service, stopped at its 30-minute limit — harmless, so its mark can
// be cleared with a button.
import { describe, expect, it } from "vitest";
import { findings, type Checkup } from "@/lib/checkup";
import { clearMarkCommand, failureSaid, KNOWN, knownFailure, RESULT_WORDS } from "@/lib/known-failures";
import { fluffSays, type Service } from "@/lib/services";

const svc = (name: string, over: Partial<Service> = {}): Service => ({ name, description: "", user: false, state: "failed", enabled: "enabled", since: null, result: "exit-code", ...over });
const calm: Checkup = { waiting: [], lockLeft: false, pacmanRunning: false, boot: null, errors: [], disk: null };
const drkonqi = svc("drkonqi-coredump-pickup.service", { user: true, result: "timeout" });

describe("Fluff knows common failures", () => {
  it("KDE's crash reporter ran out of time — harmless, its own finding, the mark cleared without a password", () => {
    const f = findings(calm, [drkonqi]);
    const mine = f.find((x) => x.id === "service:drkonqi-coredump-pickup.service")!;
    expect(mine.level).toBe("info");
    expect(mine.title).toBe("KDE's crash reporter failed — harmless (drkonqi-coredump-pickup.service)");
    expect(mine.detail).toMatch(/ran out of its 30 minutes/);
    expect(mine.fix).toEqual({ label: "Clear the mark", command: "systemctl --user reset-failed drkonqi-coredump-pickup.service" });
    expect(mine.look).toEqual({ label: "Which programs crashed", command: "coredumpctl list" });
    expect(f.find((x) => x.id === "services")).toMatchObject({ level: "ok", title: "No other service failed" });
    expect(f.some((x) => x.level === "bad")).toBe(false); // Fluff isn't worried about it
  });

  it("a known failure that matters stays bad, said in words, with its look", () => {
    const f = findings(calm, [svc("systemd-modules-load.service")]);
    const s = f.find((x) => x.id === "services")!;
    expect(s.level).toBe("bad");
    expect(s.title).toBe("A service failed: Loading kernel modules (systemd-modules-load.service)");
    expect(s.detail).toMatch(/kernel was updated and the computer wasn't restarted yet/);
    expect(s.look?.command).toBe("journalctl -b -u systemd-modules-load.service");
    expect(s.fix).toBeUndefined(); // clearing the mark would hide it
  });

  it("an unknown one gets systemd's own reason in words", () => {
    expect(failureSaid(svc("my-thing.service", { result: "start-limit-hit" }))).toBe("my-thing.service failed: it failed several times in a row, so systemd stopped trying.");
    expect(failureSaid(svc("my-thing.service", { result: "oom-kill" }))).toMatch(/ran out of memory/);
    expect(failureSaid(svc("my-thing.service", { result: "" }))).toBe("my-thing.service failed.");
    expect(failureSaid(svc("my-thing.service", { result: undefined }))).toBe("my-thing.service failed.");
    const two = findings(calm, [svc("a.service", { result: "timeout" }), svc("b.service", { result: "core-dump" })]).find((x) => x.id === "services")!;
    expect(two.title).toBe("2 services failed");
    expect(two.detail).toContain("a.service — a.service failed: it ran longer than systemd allows it");
    expect(two.detail).toContain("b.service — b.service failed: it crashed");
  });

  it("harmless and not, together: each harmless one on its own, the rest in the bad one", () => {
    const f = findings(calm, [drkonqi, svc("tor.service"), svc("man-db.service")]);
    expect(f.filter((x) => x.id.startsWith("service:")).map((x) => x.id)).toEqual(["service:drkonqi-coredump-pickup.service", "service:man-db.service"]);
    expect(f.find((x) => x.id === "services")).toMatchObject({ level: "bad", title: "A service failed: Tor (tor.service)" });
    expect(f[0].id).toBe("services"); // worst first
  });

  it("Services says it the same way", () => {
    expect(fluffSays(drkonqi)).toMatch(/^DrKonqi, KDE's crash reporter.*Harmless: Fluff's checkup \(Troubleshoot\) clears the mark\.$/);
    expect(fluffSays(svc("x.service", { result: "watchdog" }))).toBe("x.service failed: it stopped answering, so systemd stopped it. Look at its log first: it says more. Then On tries again, if you need it — or Off, if you don't.");
    expect(fluffSays(svc("tor.service"))).toMatch(/^Tor, which hides.*Look at its log first/);
  });

  it("clearing the mark: yours without a password, the system's with sudo, and only a service name", () => {
    expect(clearMarkCommand(svc("man-db.service"))).toBe("sudo systemctl reset-failed man-db.service");
    expect(clearMarkCommand(svc("foo@bar.service", { user: true }))).toBe("systemctl --user reset-failed foo@bar.service");
    expect(() => clearMarkCommand(svc("x.service; rm -rf ~"))).toThrow(/not a service name/);
    expect(() => clearMarkCommand(svc("x.timer"))).toThrow();
    expect(() => clearMarkCommand(svc("x; rm -rf ~ x.service"))).toThrow(/not a service name/); // ends well, starts badly
  });

  it("each known one has its words, matches whole names only, and every reason is a sentence part", () => {
    expect(knownFailure(svc("tor.service"))?.label).toBe("Tor");
    expect(knownFailure(svc("mytor.service"))).toBeNull();
    expect(knownFailure(svc("xdg-desktop-portal-kde.service"))).toBeNull(); // KDE's own portal failing is not harmless
    expect(knownFailure(svc("xdg-desktop-portal-hyprland.service"))?.harmless).toBe(true);
    for (const k of KNOWN) {
      expect(k.what).toMatch(/\.$/);
      expect(k.why).toMatch(/\.$/);
      expect(k.unit.source.startsWith("^")).toBe(true);
    }
    for (const w of Object.values(RESULT_WORDS)) expect(w).toMatch(/^[a-z].*[^.]$/);
  });
});
