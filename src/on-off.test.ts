// The on / off switch, run for real against a fake machine: Off writes down exactly what it
// switched off; On puts back exactly that and nothing else, and the login entries come back.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appCommand, appState, canBeDead, offCommand, onCommand, type AppDetails } from "@/lib/app-details";

function machine() {
  const root = mkdtempSync(join(tmpdir(), "am-onoff-"));
  const home = join(root, "home");
  const bin = join(root, "bin");
  mkdirSync(join(home, ".config/autostart"), { recursive: true });
  mkdirSync(bin);
  writeFileSync(join(home, ".config/autostart/myapp.desktop"), "[Desktop Entry]\nExec=myapp\n");
  const log = join(root, "calls.log");
  for (const [name, body] of [
    ["sudo", 'echo "sudo $*" >> LOG; shift 0; exec "$@"'],
    ["systemctl", 'echo "systemctl $*" >> LOG'],
    ["pkill", 'echo "pkill $*" >> LOG; exit 1'], // nothing matched: must not stop the command
    ["setsid", 'echo "setsid $*" >> LOG'],
  ]) {
    writeFileSync(join(bin, name), `#!/bin/bash\n${body.replace("LOG", log)}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const run = (cmd: string) =>
    execFileSync("bash", ["-c", cmd], { encoding: "utf8", env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` } });
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8") : "");
  return { home, run, calls };
}

const app = (over: Partial<AppDetails> = {}): AppDetails => ({
  kind: "pacman", name: "myapp", foreign: false, fileCount: 1, pacnew: [], offRecord: null,
  info: { name: "myapp", version: "1", description: "", url: null, licenses: "", size: "", installDate: "", explicit: true, from: null, depends: [], optional: [], requiredBy: [], configs: [] },
  programs: ["myapp", "myapp-helper-with-a-long-name"],
  menu: ["/usr/share/applications/myapp.desktop"],
  autostart: ["/etc/xdg/autostart/myapp-tray.desktop"],
  home: [],
  units: [
    { name: "myapp.service", user: false, enabled: "enabled", active: "active" },
    { name: "myapp-sync.service", user: true, enabled: "enabled", active: "active" },
    { name: "myapp-once.service", user: false, enabled: "static", active: "active" },
    { name: "myapp-idle.service", user: false, enabled: "disabled", active: "inactive" },
  ],
  processes: [{ pid: 4242, name: "myapp", uid: 1000, parent: 1, mine: true }],
  ...over,
});

describe("the on / off switch", () => {
  it("off: services stopped and kept from starting, login entries out, copies ended — all written down", () => {
    const m = machine();
    const d = app({ home: [{ path: "", place: "autostart", backups: [] }] });
    d.home[0].path = join(m.home, ".config/autostart/myapp.desktop");
    m.run(offCommand(d));
    const c = m.calls();
    expect(c).toContain("sudo systemctl disable --now myapp.service");
    expect(c).toContain("systemctl --user disable --now myapp-sync.service");
    expect(c).toContain("sudo systemctl stop myapp-once.service"); // static: stopped, not disabled
    expect(c).not.toContain("myapp-idle.service"); // was off already: left alone
    expect(c).toContain("pkill -x myapp");
    expect(c).not.toContain("myapp-helper-with-a-long-name"); // would never match pkill -x
    expect(existsSync(join(m.home, ".config/autostart/myapp.desktop"))).toBe(false);
    expect(readFileSync(join(m.home, ".config/autostart/myapp-tray.desktop"), "utf8")).toContain("Hidden=true");
    const rec = readFileSync(join(m.home, ".local/state/tuxcopilot/off/myapp"), "utf8");
    expect(rec.trim().split("\n").map((l) => l.split(" ")[0])).toEqual(["system", "user", "system-started", "autostart", "hidden"]);

    // on: exactly those back, then the app opens
    writeFileSync(join(m.home, "..", "calls.log"), "");
    m.run(onCommand("myapp", "/usr/share/applications/myapp.desktop"));
    const on = m.calls();
    expect(on).toContain("sudo systemctl enable --now myapp.service");
    expect(on).toContain("systemctl --user enable --now myapp-sync.service");
    expect(on).toContain("sudo systemctl start myapp-once.service");
    expect(on).not.toContain("myapp-idle.service");
    expect(on).toContain("setsid -f gio launch /usr/share/applications/myapp.desktop");
    expect(readFileSync(join(m.home, ".config/autostart/myapp.desktop"), "utf8")).toContain("Exec=myapp");
    expect(existsSync(join(m.home, ".config/autostart/myapp-tray.desktop"))).toBe(false);
    expect(existsSync(join(m.home, ".local/state/tuxcopilot/off/myapp"))).toBe(false);
  });

  it("someone else's copies are ended with sudo; odd names never reach the shell", () => {
    const d = app({ processes: [{ pid: 9, name: "myapp", uid: 0, parent: 1, mine: false }] });
    expect(offCommand(d)).toContain('sudo pkill -x "$p"');
    expect(() => offCommand(app({ name: "x;rm" }))).toThrow();
    expect(() => onCommand("-Rns", null)).toThrow();
  });
});


describe("On / Off / Dead on an app page", () => {
  it("read from the machine: running is On, stopped is Off, written-down is Dead", () => {
    expect(appState(app())).toBe("on");
    expect(appState(app({ processes: [], units: app().units.map((u) => ({ ...u, active: "inactive" })) }))).toBe("off");
    expect(appState(app({ offRecord: "system myapp.service\n" }))).toBe("dead");
    // nothing starts it by itself: Dead means nothing, Off is all it takes
    expect(canBeDead(app({ units: [], autostart: [], home: [] }))).toBe(false);
  });

  it("On → Off stops it for now and disables nothing; Dead → Off enables again without starting", () => {
    const m = machine();
    const d = app();
    m.run(appCommand(d, "off"));
    const off = m.calls();
    expect(off).toContain("sudo systemctl stop myapp.service");
    expect(off).toContain("systemctl --user stop myapp-sync.service");
    expect(off).not.toContain("disable");
    expect(existsSync(join(m.home, ".local/state/tuxcopilot/off/myapp"))).toBe(false);

    // Dead, then back to Off: what was enabled is enabled again, nothing started or opened
    m.run(appCommand(d, "dead"));
    const rec = readFileSync(join(m.home, ".local/state/tuxcopilot/off/myapp"), "utf8");
    writeFileSync(join(m.home, "..", "calls.log"), "");
    m.run(appCommand({ ...d, processes: [], offRecord: rec }, "off"));
    const revive = m.calls();
    expect(revive).toContain("sudo systemctl enable myapp.service");
    expect(revive).toContain("systemctl --user enable myapp-sync.service");
    expect(revive).not.toContain("--now");
    expect(revive).not.toContain("gio launch");
    expect(existsSync(join(m.home, ".local/state/tuxcopilot/off/myapp"))).toBe(false);
  });
});
