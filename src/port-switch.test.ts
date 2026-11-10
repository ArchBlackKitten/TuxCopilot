// The port switch, run for real against a fake systemctl — starting from a printer service whose
// cups.service, cups.socket and cups.path were disabled by hand, still running.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// "Dead" is off for good (portDeadCommand); Off is "stopped for now, back at the next restart" —
// the three states On, Off, Dead.
import { criticalUnit, keepOnCommand, notAtBoot, portCommand, portDeadCommand as portOffCommand, portOnCommand, portState, type UnitFamily } from "@/lib/ports";

const cups = (enabled: string, active = "active"): UnitFamily => ({
  units: [
    { name: "cups.path", user: false, enabled, active },
    { name: "cups.socket", user: false, enabled, active },
    { name: "cups.service", user: false, enabled, active },
  ],
  package: "cups",
  offRecord: null,
});

function machine() {
  const root = mkdtempSync(join(tmpdir(), "am-port-"));
  const home = join(root, "home");
  const bin = join(root, "bin");
  mkdirSync(home);
  mkdirSync(bin);
  const log = join(root, "calls.log");
  writeFileSync(join(bin, "sudo"), `#!/bin/bash\nexec "$@"\n`);
  writeFileSync(join(bin, "systemctl"), `#!/bin/bash\necho "systemctl $*" >> ${log}\n`);
  chmodSync(join(bin, "sudo"), 0o755);
  chmodSync(join(bin, "systemctl"), 0o755);
  const run = (cmd: string) => execFileSync("bash", ["-c", cmd], { encoding: "utf8", env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` } });
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8") : "");
  const clear = () => writeFileSync(log, "");
  return { home, run, calls, clear };
}

describe("switching a port's service", () => {
  it("disabled by hand but running: it says so, and keeping it on enables all three", () => {
    expect(portState(cups("disabled"))).toBe("on");
    expect(notAtBoot(cups("disabled"))).toBe(true);
    expect(keepOnCommand(cups("disabled"))).toBe(
      "sudo systemctl enable --now cups.path && sudo systemctl enable --now cups.socket && sudo systemctl enable --now cups.service",
    );
  });

  it("off takes the service with what starts it, and on puts back exactly that", () => {
    const m = machine();
    m.run(portOffCommand(cups("enabled"), 631));
    expect(m.calls().trim().split("\n")).toEqual([
      "systemctl disable --now cups.path",
      "systemctl disable --now cups.socket",
      "systemctl disable --now cups.service",
    ]);
    const rec = readFileSync(join(m.home, ".local/state/tuxcopilot/off/port-cups.service"), "utf8");
    expect(rec).toBe("port 631\nenabled cups.path\nenabled cups.socket\nenabled cups.service\n");

    m.clear();
    m.run(portOnCommand("cups.service", { ...cups("disabled", "inactive"), offRecord: rec }));
    expect(m.calls().trim().split("\n")).toEqual([
      "systemctl enable --now cups.path",
      "systemctl enable --now cups.socket",
      "systemctl enable --now cups.service",
    ]);
    expect(existsSync(join(m.home, ".local/state/tuxcopilot/off/port-cups.service"))).toBe(false);
  });

  it("running but not at boot: off stops it and on only starts it again (not enabled behind your back)", () => {
    const m = machine();
    m.run(portOffCommand(cups("disabled"), 631));
    expect(m.calls()).toContain("systemctl stop cups.service");
    m.clear();
    m.run(portOnCommand("cups.service", null));
    expect(m.calls().trim().split("\n")).toEqual(["systemctl start cups.path", "systemctl start cups.socket", "systemctl start cups.service"]);
  });

  it("three states, read from the machine: On running, Off stopped but back at restart, Dead disabled", () => {
    expect(portState(cups("enabled", "active"))).toBe("on");
    expect(portState(cups("enabled", "inactive"))).toBe("off");
    expect(portState(cups("disabled", "inactive"))).toBe("dead");
  });

  it("each move runs the right thing, for real", () => {
    const m = machine();
    // On → Off: stopped now (what starts it first), nothing disabled, no record
    m.run(portCommand("cups.service", cups("enabled", "active"), 631, "off"));
    expect(m.calls().trim()).toMatch(/^systemctl stop cups\.path cups\.socket cups\.service$/m);
    expect(m.calls()).not.toContain("disable");
    expect(existsSync(join(m.home, ".local/state/tuxcopilot/off/port-cups.service"))).toBe(false);
    // Off → On: started
    m.clear();
    m.run(portCommand("cups.service", cups("enabled", "inactive"), 631, "on"));
    expect(m.calls().trim()).toBe("systemctl start cups.path cups.socket cups.service");
    // On → Dead → Off: disabled and written down, then enabled again WITHOUT starting
    m.clear();
    m.run(portCommand("cups.service", cups("enabled", "active"), 631, "dead"));
    const rec = readFileSync(join(m.home, ".local/state/tuxcopilot/off/port-cups.service"), "utf8");
    m.clear();
    m.run(portCommand("cups.service", { ...cups("disabled", "inactive"), offRecord: rec }, 631, "off"));
    expect(m.calls().trim().split("\n")).toEqual(["systemctl enable cups.path", "systemctl enable cups.socket", "systemctl enable cups.service"]);
    expect(existsSync(join(m.home, ".local/state/tuxcopilot/off/port-cups.service"))).toBe(false);
  });

  it("what the system needs is locked", () => {
    expect(criticalUnit("systemd-resolved.service")).toMatch(/name lookups/);
    expect(criticalUnit("NetworkManager.service")).toMatch(/network/);
    expect(criticalUnit("cups.service")).toBeNull();
    expect(() => portOffCommand({ units: [{ name: "systemd-resolved.service", user: false, enabled: "enabled", active: "active" }], package: null, offRecord: null }, 53)).toThrow();
  });
});
