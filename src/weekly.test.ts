// Fluff's weekly checkup, only with your permission.
// Off until you say yes; yes is a command shown first, writing two files of yours and switching a
// timer on, no password. Run here for real against a fake systemctl, in a fake home.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KNOWN } from "@/lib/known-failures";
import { tuxPath, tuxUnit } from "@/lib/tux-own";
import { UNIT, unitFiles, weeklyOffCommand, weeklyOnCommand } from "@/lib/weekly";

function machine(o: { stuck?: boolean; wontStart?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), "tux-weekly-"));
  const bin = join(home, "bin");
  mkdirSync(bin);
  const log = join(home, "calls.log");
  // systemd --user: a unit exists while its file does; enabled and running remembered
  const st = join(home, "state");
  writeFileSync(
    join(bin, "systemctl"),
    `#!/bin/bash\necho "systemctl $*" >> ${log}\nu="\${@: -1}"\ncase " $* " in\n  *" cat "*) [ -e "$HOME/.config/systemd/user/$u" ];;\n  *" is-enabled "*|*" is-active "*) [ -e ${st}-$u ];;\n  *" enable "*) ${o.wontStart ? "true" : `touch ${st}-$u`};;\n  *" disable "*) ${o.stuck ? "true" : `rm -f ${st}-$u`};;\nesac\n`,
  );
  chmodSync(join(bin, "systemctl"), 0o755);
  const run = (cmd: string) => {
    try {
      return execFileSync("bash", ["-c", cmd], { encoding: "utf8", stdio: "pipe", env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` } });
    } catch (e) {
      throw new Error(`stderr: ${(e as { stderr?: string }).stderr ?? ""}`);
    }
  };
  const unit = (n: string) => join(home, ".config/systemd/user", n);
  return { home, run, unit, calls: () => (existsSync(log) ? readFileSync(log, "utf8") : "") };
}

describe("Fluff's weekly checkup", () => {
  it("yes: the service runs this TuxCopilot's weekly mode; the timer, weekly and at the next login if missed; switched on", () => {
    const m = machine();
    m.run(weeklyOnCommand("/usr/bin/tuxcopilot"));
    expect(readFileSync(m.unit(`${UNIT}.service`), "utf8")).toBe(unitFiles("/usr/bin/tuxcopilot").service.join("\n") + "\n");
    expect(readFileSync(m.unit(`${UNIT}.service`), "utf8")).toContain("ExecStart=/usr/bin/tuxcopilot --weekly-checkup\n");
    const timer = readFileSync(m.unit(`${UNIT}.timer`), "utf8");
    expect(timer).toContain("OnCalendar=weekly\nPersistent=true\n");
    expect(timer).toContain("[Install]\nWantedBy=timers.target\n");
    expect(m.calls()).toMatch(new RegExp(`^systemctl --user daemon-reload\\nsystemctl --user enable --now ${UNIT}\\.timer\\nsystemctl --user is-enabled -q ${UNIT}\\.timer\\nsystemctl --user is-active -q ${UNIT}\\.timer\\n$`)); // and checked on
  });

  it("off: the timer off and its files gone; nothing else of yours touched", () => {
    const m = machine();
    m.run(weeklyOnCommand("/usr/bin/tuxcopilot"));
    writeFileSync(m.unit("mine.service"), "[Service]\n");
    m.run(weeklyOffCommand());
    expect(existsSync(m.unit(`${UNIT}.service`))).toBe(false);
    expect(existsSync(m.unit(`${UNIT}.timer`))).toBe(false);
    expect(existsSync(m.unit("mine.service"))).toBe(true);
    expect(m.calls()).toContain(`systemctl --user disable --now ${UNIT}.timer\n`);
  });

  it("off, when it was never on: no error — and nothing switched off that isn't there", () => {
    const m = machine();
    expect(() => m.run(weeklyOffCommand())).not.toThrow();
    expect(m.calls()).not.toContain("disable");
  });

  it("nothing hidden: a timer that didn't start, or won't stop, is said and fails", () => {
    expect(() => machine({ wontStart: true }).run(weeklyOnCommand("/usr/bin/tuxcopilot"))).toThrow(/^stderr: Fluff: the weekly checkup's timer isn't on\.\n$/);
    const m = machine({ stuck: true });
    m.run(weeklyOnCommand("/usr/bin/tuxcopilot"));
    expect(() => m.run(weeklyOffCommand())).toThrow(/^stderr: Fluff: the weekly checkup's timer is still on\.\n$/);
    expect(weeklyOffCommand()).not.toMatch(/; true; \}|\|\| true\b/);
  });

  it("no password, ever: nothing as root", () => {
    expect(weeklyOnCommand("/usr/bin/tuxcopilot")).not.toMatch(/\bsudo\b/);
    expect(weeklyOffCommand()).not.toMatch(/\bsudo\b/);
  });

  it("a TuxCopilot path that can't be written into a timer is refused", () => {
    expect(() => weeklyOnCommand("/opt/my apps/tuxcopilot")).toThrow(/can't name this TuxCopilot/);
    expect(() => weeklyOnCommand("relative/tuxcopilot")).toThrow();
    expect(() => weeklyOnCommand("/usr/bin/x'; rm -rf ~; '")).toThrow();
    for (const l of [...unitFiles("/usr/bin/tuxcopilot").service, ...unitFiles("/usr/bin/tuxcopilot").timer]) expect(l).not.toContain("'");
  });

  it("its files and its units carry TuxCopilot's tag", () => {
    expect(tuxPath(`~/.config/systemd/user/${UNIT}.timer`)).toMatch(/weekly checkup/);
    expect(tuxPath(`/home/someone/.config/systemd/user/${UNIT}.service`)).toMatch(/weekly checkup/);
    expect(tuxUnit(`${UNIT}.timer`)).toBe("TuxCopilot put this here");
  });

  it("the notification skips the same harmless failures the checkup knows (weekly.rs HARMLESS = known-failures.ts)", () => {
    const rs = readFileSync("src-tauri/src/weekly.rs", "utf8");
    const listed = [...rs.slice(rs.indexOf("pub const HARMLESS"), rs.indexOf("];", rs.indexOf("pub const HARMLESS"))).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const harmless = KNOWN.filter((k) => k.harmless);
    for (const n of listed) expect(harmless.some((k) => k.unit.test(n)), n).toBe(true);
    for (const k of harmless) expect(listed.some((n) => k.unit.test(n)), k.label).toBe(true);
    expect(rs).toContain(`pub const UNIT: &str = "${UNIT}";`);
  });
});
