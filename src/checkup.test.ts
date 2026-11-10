// Fluff's checkup: how long the boot took and which part, errors by program, what each waiting
// settings file is, the commands that settle one (run for real against a stand-in sudo that
// works in a folder of the test's own), and the findings, worst first.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootSaid, errorGroups, findings, keepMineCommand, mood, said, useNewCommand, waitingAdvice, type Checkup, type Waiting } from "@/lib/checkup";
import type { Service } from "@/lib/services";

const w = (file: string, kind: "pacnew" | "pacsave" = "pacnew"): Waiting => ({ path: `${file}.${kind}`, file, kind, owner: "pkg", fileExists: true });
const base: Checkup = { waiting: [], lockLeft: false, pacmanRunning: false, boot: null, errors: [], disk: [200e9, 500e9] };
const svc = (name: string, state: Service["state"]) => ({ name, state, description: "", user: false, enabled: "enabled", since: null }) as unknown as Service;

describe("Fluff's checkup", () => {
  it("says how long the boot took, and which part took longest", () => {
    const b = bootSaid("Startup finished in 5.565s (firmware) + 5.601s (loader) + 773ms (kernel) + 40.565s (initrd) + 9.713s (userspace) = 1min 2.219s");
    expect(b?.total).toBeCloseTo(62.219, 2);
    expect(b?.longest?.part).toBe("initrd");
    expect(b?.longest?.words).toMatch(/disk-encryption password/);
    expect(said(62.219)).toBe("1 min 2 s");
    expect(said(4.21)).toBe("4.2 s");
    expect(bootSaid("Startup finished in 2.1s (kernel) + 3s (userspace) = 5.1s")?.longest?.part).toBe("userspace");
    expect(bootSaid(null)).toBeNull();
    expect(bootSaid("Bootup is not yet finished")).toBeNull();
  });

  it("groups the errors by the program that logged them", () => {
    const g = errorGroups([
      "2026-10-28T07:08:44+00:00 host cosmic-greeter[1115]: Failed to create watcher",
      "2026-10-28T07:08:48+00:00 host dbus-broker-launch[2005]: Ignoring duplicate name 'a'",
      "2026-10-28T07:08:48+00:00 host dbus-broker-launch[2005]: Ignoring duplicate name 'b'",
      "2026-10-28T07:09:00+00:00 host kernel: ACPI Error: AE_NOT_FOUND",
      "-- No entries --",
    ]);
    expect(g.map((x) => [x.program, x.count])).toEqual([["dbus-broker-launch", 2], ["cosmic-greeter", 1], ["kernel", 1]]);
    expect(g[0].last).toBe("Ignoring duplicate name 'b'");
  });

  it("each waiting file says what it is, in plain words", () => {
    expect(waitingAdvice(w("/etc/pacman.conf"))).toMatch(/not replacing this one blindly/);
    expect(waitingAdvice(w("/etc/pacman.d/mirrorlist"))).toMatch(/every server switched off/);
    expect(waitingAdvice(w("/etc/pacman.d/cachyos-mirrorlist"))).toMatch(/distribution's own repositories/);
    expect(waitingAdvice(w("/etc/shadow"))).toMatch(/Keep yours: the waiting one would lose your user/);
    // bluetooth/main.conf is a file Fluff knows; the unknown one is another
    expect(waitingAdvice(w("/etc/some-tool/settings.conf"))).toMatch(/If you never changed yours, use the new one/);
    expect(waitingAdvice(w("/etc/some-tool/settings.conf"))).toMatch(/pacman didn't overwrite it/);
    expect(waitingAdvice({ ...w("/etc/x.conf", "pacsave"), fileExists: false })).toMatch(/kept when the package was removed/);
  });

  it("refuses a path it doesn't know, rather than quoting it", () => {
    expect(() => keepMineCommand({ ...w("/etc/a"), path: "/etc/a'; rm -rf ~ '.pacnew", file: "/etc/a'; rm -rf ~ '" })).toThrow();
    expect(() => keepMineCommand({ ...w("/etc/a"), path: "/home/me/a.pacnew", file: "/home/me/a" })).toThrow();
    expect(() => keepMineCommand({ ...w("/etc/a"), path: "/etc/b.pacnew" })).toThrow();
    expect(() => useNewCommand(w("/etc/a", "pacsave"))).toThrow(/only a \.pacnew/);
  });

  it("Use the new one and Keep mine, run for real (a stand-in sudo in a folder of the test's own)", () => {
    const dir = mkdtempSync(join(tmpdir(), "tux-checkup-"));
    const bin = join(dir, "bin");
    mkdirSync(bin);
    mkdirSync(join(dir, "etc", "my dir"), { recursive: true });
    // the stand-in sudo runs the command with /etc/… moved into the test's folder
    writeFileSync(join(bin, "sudo"), `#!/bin/bash\nargs=(); for a in "$@"; do case "$a" in /etc/*) args+=("${dir}$a");; *) args+=("$a");; esac; done; "\${args[@]}"\n`);
    chmodSync(join(bin, "sudo"), 0o755);
    const etc = (p: string) => join(dir, p);
    writeFileSync(etc("etc/my dir/app.conf"), "mine\n");
    writeFileSync(etc("etc/my dir/app.conf.pacnew"), "new\n");
    writeFileSync(etc("etc/other.conf"), "mine\n");
    writeFileSync(etc("etc/other.conf.pacnew"), "new\n");
    const sh = (c: string) => execFileSync("bash", ["-c", c], { env: { PATH: `${bin}:/usr/bin` }, encoding: "utf8" });

    const out = sh(useNewCommand(w("/etc/my dir/app.conf"), "20261028-120000"));
    expect(readFileSync(etc("etc/my dir/app.conf"), "utf8")).toBe("new\n");
    expect(readFileSync(etc("etc/my dir/app.conf.before-fluff-20261028-120000"), "utf8")).toBe("mine\n");
    expect(existsSync(etc("etc/my dir/app.conf.pacnew"))).toBe(false);
    expect(out).toContain("Fluff kept your old one as /etc/my dir/app.conf.before-fluff-20261028-120000");

    sh(keepMineCommand(w("/etc/other.conf")));
    expect(readFileSync(etc("etc/other.conf"), "utf8")).toBe("mine\n");
    expect(readdirSync(etc("etc"))).toEqual(["my dir", "other.conf"]);
    rmSync(dir, { recursive: true });
  });

  it("findings come worst first, and Fluff's mood follows the worst", () => {
    const calm = findings(base, []);
    expect(calm.every((f) => f.level === "ok" || f.level === "info")).toBe(true);
    expect(mood(calm)).toBe("calm");

    const f = findings(
      { ...base, lockLeft: true, waiting: [w("/etc/pacman.conf"), w("/etc/x", "pacsave")], disk: [4e9, 60e9], errors: ["2026-10-28T07:08:44+00:00 host kernel: oops"], boot: "Startup finished in 2s (kernel) + 3s (userspace) = 5s" },
      [svc("cups.service", "failed"), svc("sshd.service", "running")],
    );
    expect(f.map((x) => x.id)).toEqual(["services", "lock", "disk", "waiting", "errors", "boot"]);
    expect(f[0].title).toBe("A service failed: cups.service");
    expect(f.find((x) => x.id === "lock")?.fix?.command).toBe("sudo rm -- '/var/lib/pacman/db.lck'");
    expect(f.find((x) => x.id === "disk")?.level).toBe("warn");
    expect(f.find((x) => x.id === "waiting")?.detail).toMatch(/^1 new version \(\.pacnew\) and 1 old copy \(\.pacsave\)/);
    expect(mood(f)).toBe("worried");
    expect(findings({ ...base, pacmanRunning: true }, null).find((x) => x.id === "lock")?.level).toBe("info");
  });
});
