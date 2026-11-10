// USBGuard: new USB devices blocked until
// you allow them; switching on can't lock you out. The commands run here for real against a fake
// machine: a fake usbguard, fake USB ports in a fake /sys, a fake /etc/usbguard.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACCESS_DIR, allowCommand, switchOn, deviceSays, RULES, USB_DEVICES, USBGUARD_AT_BOOT, USBGUARD_OFF, usbguardOnCommand, type UsbGuard } from "@/lib/usbguard";
import { tuxPath } from "@/lib/tux-own";

const notInstalled: UsbGuard = { installed: false, active: false, enabled: false, blocked: null };

function machine(opts: { blocked?: string; rules?: string; stuck?: boolean; sticky?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "tux-usbguard-"));
  const bin = join(root, "bin");
  const etc = join(root, "etc/usbguard");
  const sys = join(root, "sys");
  for (const d of [bin, join(etc, "IPCAccessControl.d"), join(sys, "usb1"), join(sys, "usb2"), join(sys, "1-2"), join(sys, "1-3")]) mkdirSync(d, { recursive: true });
  writeFileSync(join(etc, "rules.conf"), opts.rules ?? "");
  // USBGuard left the ports closed and one device blocked
  for (const c of ["usb1", "usb2"]) writeFileSync(join(sys, c, "authorized_default"), "0\n");
  writeFileSync(join(sys, "1-2", "authorized"), "1\n");
  writeFileSync(join(sys, "1-3", "authorized"), "0\n");
  // USBGuard running, and at every boot (it is being switched off)
  writeFileSync(join(root, "active"), "");
  writeFileSync(join(root, "enabled"), "");
  const log = join(root, "calls.log");
  for (const [name, body] of [
    ["sudo", `echo "sudo $*" >> ${log}; exec "$@"`],
    // a port the kernel won't open (the sweep: the loop counted only the last one)
    ["tee", `case "$1" in *${opts.sticky ?? "__no-sticky-port__"}) echo "tee: $1: Permission denied" >&2; cat >/dev/null; exit 1;; esac; exec /usr/bin/tee "$@"`],
    ["pacman", `echo "pacman $*" >> ${log}`],
    // systemd: started, enabled, stopped — remembered
    ["systemctl", `echo "systemctl $*" >> ${log}; u="\${@: -1}"; case " $* " in *" is-active "*) [ -e ${root}/active ];; *" is-enabled "*) [ -e ${root}/enabled ];; *" disable "*) rm -f ${root}/enabled; [ -n "${opts.stuck ? "1" : ""}" ] || rm -f ${root}/active;; *" enable "*) touch ${root}/enabled;; *" start "*) touch ${root}/active;; esac`],
    ["sleep", "true"],
    ["usbguard", `case "$1" in generate-policy) echo "generate-policy $*" >> ${log}; echo 'allow id 1d6b:0002 name "xHCI Host Controller"'; echo 'allow id 046d:c31c name "USB Keyboard"';; list-devices) printf '%s' "${opts.blocked ?? ""}";; *) echo "usbguard $*" >> ${log};; esac`],
  ]) {
    writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const local = (c: string) => c.replaceAll(RULES, join(etc, "rules.conf")).replaceAll(ACCESS_DIR, join(etc, "IPCAccessControl.d")).replaceAll(USB_DEVICES, sys);
  const run = (cmd: string) => {
    try {
      return execFileSync("bash", ["-c", local(cmd)], { encoding: "utf8", stdio: "pipe", env: { ...process.env, USER: "penguin", PATH: `${bin}:${process.env.PATH}` } });
    } catch (e) {
      throw new Error(`stderr: ${String((e as { stderr?: string }).stderr)}`);
    }
  };
  return { run, etc, sys, read: (p: string) => readFileSync(join(root, p), "utf8"), calls: () => (existsSync(log) ? readFileSync(log, "utf8") : "") };
}

describe("USBGuard: new USB devices blocked until you allow them", () => {
  it("on: installed (the whole system updated first), rules from what is plugged in now, list-only access, started — not yet at boot", () => {
    const m = machine();
    m.run(usbguardOnCommand(notInstalled));
    const rules = m.read("etc/usbguard/rules.conf");
    expect(rules.split("\n")[0]).toMatch(/^# TuxCopilot: the USB devices plugged in when USBGuard was switched on/);
    expect(rules).toContain('allow id 046d:c31c name "USB Keyboard"');
    expect(m.read("etc/usbguard/IPCAccessControl.d/penguin")).toBe("Devices=list,listen\n"); // never modify
    const calls = m.calls();
    expect(calls).toContain("pacman -Syu --needed usbguard");
    expect(calls).toContain("generate-policy generate-policy -P"); // no port ties: your keyboard may move ports
    expect(calls).toContain("systemctl start usbguard.service");
    expect(calls).not.toContain("enable"); // only after you pass "type and click"
    expect(calls.indexOf("generate-policy")).toBeLessThan(calls.indexOf("systemctl start")); // rules before it starts
  });

  it("on, already installed: no install", () => {
    const m = machine();
    m.run(usbguardOnCommand({ ...notInstalled, installed: true }));
    expect(m.calls()).not.toContain("pacman");
  });

  it("rules Fluff didn't write are left alone, and nothing starts", () => {
    const m = machine({ rules: "allow id 1234:5678\n" });
    expect(() => m.run(usbguardOnCommand({ ...notInstalled, installed: true }))).toThrow(/^stderr: Fluff: .*rules\.conf already has rules Fluff did not write/);
    expect(m.read("etc/usbguard/rules.conf")).toBe("allow id 1234:5678\n");
    expect(m.calls()).not.toContain("systemctl start");
  });

  it("Fluff's own rules are written again, and someone's own access file is kept", () => {
    const m = machine({ rules: "# TuxCopilot: old\nallow id 0:0\n" });
    writeFileSync(join(m.etc, "IPCAccessControl.d/penguin"), "Devices=ALL\n");
    m.run(usbguardOnCommand({ ...notInstalled, installed: true }));
    expect(m.read("etc/usbguard/rules.conf")).not.toContain("allow id 0:0");
    expect(m.read("etc/usbguard/IPCAccessControl.d/penguin")).toBe("Devices=ALL\n");
  });

  it("something plugged in now got blocked: the command says what, and fails (the type-and-click check still follows)", () => {
    const m = machine({ blocked: '7: block id 046d:c31c name "USB Keyboard"' });
    expect(() => m.run(usbguardOnCommand({ ...notInstalled, installed: true }))).toThrow(/^stderr: Fluff: USBGuard blocked something plugged in now: 7: block id 046d:c31c/);
  });

  it("off: stopped, not at boot, and every port and blocked device let in again", () => {
    const m = machine();
    expect(m.run(USBGUARD_OFF)).toContain("every USB device plugged in now is let in");
    expect(m.calls()).toContain("systemctl disable --now usbguard.service");
    for (const c of ["usb1", "usb2"]) expect(m.read(`sys/${c}/authorized_default`)).toBe("1\n");
    expect(m.read("sys/1-3/authorized")).toBe("1\n");
    expect(m.calls()).not.toContain(`tee ${m.sys}/1-2/authorized`); // already in: left alone
  });

  it("off, with nothing hidden: a USBGuard that keeps running, or a port that stays closed, is said and fails", () => {
    expect(() => machine({ stuck: true }).run(USBGUARD_OFF)).toThrow(/^stderr: Fluff: USBGuard is still running\.$/m);
    // a port that won't open: counted, even when it isn't the last one
    const m = machine({ sticky: "usb1/authorized_default" });
    expect(() => m.run(USBGUARD_OFF)).toThrow(/^stderr: tee: \S+\/usb1\/authorized_default: Permission denied\nFluff: still closed: \S+\/usb1\/authorized_default$/m);
    expect(m.read("sys/usb2/authorized_default")).toBe("1\n"); // the others still opened
  });

  it("at boot only after you passed; allow once or for good, by USBGuard's own number only", () => {
    expect(USBGUARD_AT_BOOT).toMatch(/^sudo systemctl enable usbguard\.service && \{ systemctl is-enabled -q usbguard\.service \|\| /); // and checked
    const m = machine();
    m.run(USBGUARD_AT_BOOT);
    expect(m.calls()).toContain("systemctl is-enabled -q usbguard.service");
    expect(allowCommand({ number: 12 }, false)).toBe("sudo usbguard allow-device 12");
    expect(allowCommand({ number: 12 }, true)).toBe("sudo usbguard allow-device -p 12");
    expect(() => allowCommand({ number: -1 }, true)).toThrow();
    expect(() => allowCommand({ number: 1.5 }, true)).toThrow();
  });

  it("what a blocked device says it is; a stick that also says keyboard is what BadUSB looks like", () => {
    expect(deviceSays({ interfaces: ["08:06:50"] })).toEqual({ kinds: ["a USB stick or disk"], warn: null });
    expect(deviceSays({ interfaces: ["03:01:01", "03:01:02"] }).warn).toMatch(/^It can type and click/);
    expect(deviceSays({ interfaces: ["08:06:50", "03:01:01"] }).warn).toMatch(/that is what a BadUSB looks like/);
    expect(deviceSays({ interfaces: ["DC:00:00"] }).kinds).toEqual(["kind dc"]);
  });

  it("no message breaks out of its quotes; the access file carries TuxCopilot's tag", () => {
    const on = usbguardOnCommand(notInstalled);
    const inner = on.slice(on.indexOf("sudo sh -c '") + 12, on.indexOf("' fluff-usbguard"));
    expect(inner).not.toContain("'");
    expect(tuxPath(`${ACCESS_DIR}/penguin`)).toMatch(/list blocked USB devices/);
  });

  it("switching on: started, then your hands proved, then at every boot — or off by itself — and never at boot without the proof", async () => {
    const flow = async (opts: { started: boolean; passed: boolean; dryRun?: boolean; err?: string }) => {
      const ran: string[] = [];
      const hands: string[] = [];
      const r = await switchOn(notInstalled, {
        run: async (l, c) => (ran.push(c), l === "USBGuard: on" ? (opts.err ?? null) : null),
        runEnd: async () => ({}),
        state: async () => ({ ...notInstalled, installed: true, active: opts.started }),
        checkHands: async (c) => (hands.push(c.undo), opts.passed),
        dryRun: opts.dryRun ?? false,
      });
      return { r, ran, hands };
    };
    const ok = await flow({ started: true, passed: true });
    expect(ok.r).toBe("at-boot");
    expect(ok.hands).toEqual([USBGUARD_OFF]);
    expect(ok.ran[1]).toBe(USBGUARD_AT_BOOT);
    const undone = await flow({ started: true, passed: false });
    expect(undone.r).toBe("undone");
    expect(undone.ran).not.toContain(USBGUARD_AT_BOOT);
    expect((await flow({ started: false, passed: true })).hands).toEqual([]);
    expect((await flow({ started: true, passed: true, dryRun: true })).r).toBe("dry-run");
    expect((await flow({ started: true, passed: true, err: "no" })).r).toBe("failed");
  });
});
