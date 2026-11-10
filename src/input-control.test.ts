// Who may control your keyboard and mouse: Allow / Ask / Block. Block
// also closes /dev/uinput — where a program can make a fake keyboard with no window at all —
// and says first what stops working (a drawing tablet's driver).
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blockCosts, BUS_RULE, busRuleText, inputMode, inputModeCommand, locks, OUR_RULE, UINPUT, unfinished, XWAYLAND, type InputControl } from "@/lib/input-control";
import { tuxPath } from "@/lib/tux-own";

const base: InputControl = {
  noPrompt: false, allowedApps: [], uinputOpen: true, uinputGivers: ["opentabletdriver"], ourRule: false, ydotoolOn: false,
  busRule: "", doorShut: false, xtestWrapper: false, xtestForeign: false, xtestOffNow: false, krdpOn: false, affected: [],
};
// Block is every lock written (the deny-all), not the uinput rule alone
const blocked: InputControl = { ...base, ourRule: true, uinputOpen: false, busRule: "all", doorShut: true, xtestWrapper: true, xtestOffNow: true };

describe("who may control your keyboard and mouse", () => {
  it("the switch shows how it is", () => {
    expect(inputMode(base)).toBe("ask");
    expect(inputMode({ ...base, noPrompt: true, ourRule: true })).toBe("allow");
    expect(inputMode(blocked)).toBe("block");
    expect(inputMode({ ...blocked, allowedApps: ["xdotool"] })).toBe("ask"); // something always allowed: not blocked
  });

  it("Allow: no window for X11 programs; it opens the back door again if Block had closed it", () => {
    // and KWin's setting read back after
    expect(inputModeCommand("allow", base)).toMatch(/^kwriteconfig6 --file kwinrc --group Xwayland --key XwaylandEisNoPrompt true && qdbus6 org\.kde\.KWin \/KWin reconfigure && \{ r=\$\(kreadconfig6 --file kwinrc --group Xwayland --key XwaylandEisNoPrompt\); \[ "\$r" = true \] \|\| /);
    expect(inputModeCommand("allow", { ...base, ourRule: true })).toContain(`sudo rm -f ${OUR_RULE} && sudo udevadm control --reload`);
  });

  it("Ask: the window each time, the always-allowed list forgotten", () => {
    const c = inputModeCommand("ask", base);
    expect(c).toContain("--key XwaylandEisNoPrompt false");
    expect(c).toContain("--key XwaylandEisNoPromptApps --delete");
    expect(c).not.toContain(OUR_RULE);
    expect(inputModeCommand("ask", { ...base, ourRule: true })).toContain(`sudo rm -f ${OUR_RULE}`);
  });

  it("Block: Ask, plus /dev/uinput closed to your account now and from the next start, and ydotool's service off", () => {
    const c = inputModeCommand("block", base);
    expect(c).toContain("--key XwaylandEisNoPrompt false && kwriteconfig6 --file kwinrc --group Xwayland --key XwaylandEisNoPromptApps --delete");
    expect(c.indexOf("XwaylandEisNoPromptApps --delete")).toBeLessThan(c.indexOf(OUR_RULE));
    expect(c).toContain(`'KERNEL=="uinput", TAG-="uaccess", TAG-="udev-acl"' | sudo tee ${OUR_RULE}`);
    expect(c).toContain("sudo udevadm trigger --name-match=/dev/uinput");
    expect(c).toContain('sudo setfacl -x u:"$USER" /dev/uinput');
    expect(c).toContain("systemctl --user disable --now ydotool.service");
    expect(c).not.toMatch(/XwaylandEisNoPrompt true/);
  });

  it("before Block, it says what stops working; the rule file carries TuxCopilot's tag", () => {
    expect(blockCosts(base)).toEqual(["OpenTabletDriver (your drawing tablet) stops working"]);
    expect(blockCosts({ ...base, uinputGivers: ["brltty", "opentabletdriver"] })).toEqual(["brltty may stop working (it opens /dev/uinput)", "OpenTabletDriver (your drawing tablet) stops working"]);
    expect(blockCosts({ ...base, uinputGivers: [] })).toEqual([]);
    expect(tuxPath(OUR_RULE)).toMatch(/uinput closed/);
  });

  it("the screen and the reader name the same rule file", () => {
    expect(readFileSync("src-tauri/src/inputctl.rs", "utf8")).toContain(`pub const OUR_RULE: &str = "${OUR_RULE}";`);
  });
});

// A deny-all: KDE has none, and KWin's
// own D-Bus door handed a keyboard and mouse to a plain terminal command with no window. The
// deny-all is four locks; each command is run here for real against a fake machine.
function machine(opts: { doorObeys?: boolean; uinputStuck?: boolean; serviceStuck?: boolean; kdeIgnores?: boolean; chmodIgnored?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "tux-input-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const log = join(root, "calls.log");
  const file = { bus: join(root, "tuxcopilot-input.conf"), x: join(root, "Xwayland"), udev: join(root, "72-tuxcopilot-uinput.rules"), uinput: join(root, "uinput") };
  // /dev/uinput, open to you through an ACL (as logind gives it); setfacl -x takes it away
  writeFileSync(file.uinput, "");
  chmodSync(file.uinput, opts.uinputStuck ? 0o666 : 0o644);
  const kde = join(root, "kde.conf");
  writeFileSync(kde, "");
  for (const u of ["ydotool.service", "app-org.kde.krdpserver.service"]) {
    writeFileSync(join(root, `unit-${u}`), "");
    writeFileSync(join(root, `active-${u}`), "");
  }
  const door = opts.doorObeys === false ? "exit 0" : `grep -qs EIS/RemoteDesktop ${file.bus} && { echo "Call failed: Access denied" >&2; exit 1; }; exit 0`;
  for (const [name, body] of [
    ["sudo", `echo "sudo $*" >> ${log}; exec "$@"`],
    ["busctl", `echo "busctl $*" >> ${log}; [ "$2" = introspect ] && { ${door}; }; exit 0`],
    ...["qdbus6", "udevadm"].map((n) => [n, `echo "${n} $*" >> ${log}`]),
    // KDE's settings, written and read back
    ["kwriteconfig6", `echo "kwriteconfig6 $*" >> ${log}; k="$2/$4/$6"; grep -v "^$k=" ${kde} > ${kde}.t; mv ${kde}.t ${kde}; [ "$7" = --delete ] || [ -n "${opts.kdeIgnores ? "1" : ""}" ] || echo "$k=$7" >> ${kde}`],
    ["kreadconfig6", `k="$2/$4/$6"; sed -n "s|^$k=||p" ${kde}`],
    ["getfacl", `[ -w ${file.uinput} ] && echo "user:$USER:rw-"; exit 0`],
    ...(opts.chmodIgnored ? [["chmod", "exit 0"]] : []), // a filesystem that takes the file but not its mode
    ["setfacl", `echo "setfacl $*" >> ${log}; ${opts.uinputStuck ? "true" : `/usr/bin/chmod 444 ${file.uinput}`}`],
    // systemd --user: a unit is there, running, until switched off
    ["systemctl", `echo "systemctl $*" >> ${log}; u="\${@: -1}"; case " $* " in *" cat "*) [ -e ${root}/unit-$u ];; *" is-active "*) [ -e ${root}/active-$u ];; *" disable "*) ${opts.serviceStuck ? "true" : `rm -f ${root}/active-$u`};; esac`],
  ]) {
    writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const local = (cmd: string) => cmd.replaceAll(BUS_RULE, file.bus).replaceAll(XWAYLAND, file.x).replaceAll(OUR_RULE, file.udev).replaceAll(UINPUT, file.uinput);
  // a failure says only what the command printed (its error message would hold the command's own text)
  const run = (cmd: string) => {
    try {
      return execFileSync("bash", ["-c", local(cmd)], { encoding: "utf8", stdio: "pipe", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    } catch (e) {
      throw new Error(`stderr: ${String((e as { stderr?: string }).stderr)}`);
    }
  };
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8") : "");
  return { file, run, calls };
}

describe("Block is a deny-all: every door shut, the hidden ones too", () => {
  it("Block writes the bus rule (KWin's door and the portal's), the Xwayland without XTEST and the uinput rule, and checks the door", () => {
    const m = machine();
    m.run(inputModeCommand("block", { ...base, krdpOn: true }));
    expect(readFileSync(m.file.bus, "utf8")).toBe(busRuleText("all").join("\n") + "\n");
    expect(readFileSync(m.file.x, "utf8")).toBe(
      "#!/bin/sh\n# TuxCopilot: Xwayland without XTEST, so no X11 program can type or click for you (Security, Block). Delete this file to undo; it counts from your next login.\nexec /usr/bin/Xwayland \"$@\" -extension XTEST\n",
    );
    expect(statSync(m.file.x).mode & 0o777).toBe(0o755);
    expect(readFileSync(m.file.udev, "utf8")).toContain('KERNEL=="uinput", TAG-="uaccess"');
    expect(m.calls()).toContain("busctl --user call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus ReloadConfig");
    expect(m.calls()).toContain("busctl --user introspect org.kde.KWin /org/kde/KWin/EIS/RemoteDesktop");
    expect(m.calls()).toContain("systemctl --user disable --now app-org.kde.krdpserver.service");
    expect(m.calls().indexOf("ReloadConfig")).toBeLessThan(m.calls().indexOf("introspect"));
    for (const f of [m.file.bus, m.file.x, m.file.udev]) expect(m.calls()).toContain(`sudo tee ${f}`); // the system's files, with your password
    expect(m.calls()).toContain(`sudo chmod 755 ${m.file.x}`);
  });

  it("the bus rule refuses by path at KWin (nothing else of KWin's) and by interface at the portal (screen sharing untouched)", () => {
    const all = busRuleText("all").join("\n");
    expect(all).toMatch(/^<!DOCTYPE busconfig/);
    expect(all).toContain('<policy context="mandatory">'); // no later rule file can allow it back
    expect(all).toContain('<deny send_destination="org.kde.KWin" send_path="/org/kde/KWin/EIS/RemoteDesktop"/>');
    expect(all).toContain('<deny send_destination="org.kde.KWin" send_path="/org/kde/KWin/EIS/InputCapture"/>');
    expect(all).toContain('<deny send_destination="org.freedesktop.portal.Desktop" send_interface="org.freedesktop.portal.RemoteDesktop"/>');
    expect(all).toContain('<deny send_destination="org.freedesktop.portal.Desktop" send_interface="org.freedesktop.portal.InputCapture"/>');
    expect(all).not.toMatch(/ScreenCast|send_interface="org\.kde/);
    expect(all.match(/<deny /g)).toHaveLength(4);
    const kwin = busRuleText("kwin").join("\n");
    expect(kwin.match(/<deny /g)).toHaveLength(2);
    expect(kwin).not.toContain("portal");
    for (const t of [all, kwin]) {
      expect(t).not.toContain("'"); // each line is written inside '…'
      expect(t.replace(/<!--[^]*?-->/g, "")).not.toContain("--"); // XML: no "--" outside comments
    }
  });

  it("the door that still answers after the rule is said, and the command stops there", () => {
    const m = machine({ doorObeys: false });
    expect(() => m.run(inputModeCommand("block", base))).toThrow(/^stderr: Fluff: KWin's door still answers/);
    expect(existsSync(m.file.x)).toBe(false); // nothing after the failed check
  });

  it("someone else's /usr/local/bin/Xwayland is left alone, and the command says so", () => {
    const m = machine();
    writeFileSync(m.file.x, "#!/bin/sh\nexec /opt/my/Xwayland \"$@\"\n");
    expect(() => m.run(inputModeCommand("block", base))).toThrow(/^stderr: Fluff: .*Xwayland is not TuxCopilot's, so it is left alone/);
    expect(readFileSync(m.file.x, "utf8")).toBe("#!/bin/sh\nexec /opt/my/Xwayland \"$@\"\n");
  });

  it("Block again over Block writes the same files (TuxCopilot's own Xwayland is replaced, not refused)", () => {
    const m = machine();
    m.run(inputModeCommand("block", base));
    m.run(inputModeCommand("block", blocked));
    expect(readFileSync(m.file.bus, "utf8")).toBe(busRuleText("all").join("\n") + "\n");
  });

  it("Ask from Block: XTEST and /dev/uinput back, the portal asks again, but KWin's windowless door stays shut", () => {
    const m = machine();
    m.run(inputModeCommand("block", base));
    m.run(inputModeCommand("ask", blocked));
    expect(existsSync(m.file.x)).toBe(false);
    expect(existsSync(m.file.udev)).toBe(false);
    expect(readFileSync(m.file.bus, "utf8")).toBe(busRuleText("kwin").join("\n") + "\n");
  });

  it("Ask from nothing writes only KWin's door rule; Allow takes every lock away", () => {
    const m = machine();
    m.run(inputModeCommand("ask", base));
    expect(readFileSync(m.file.bus, "utf8")).toBe(busRuleText("kwin").join("\n") + "\n");
    expect(existsSync(m.file.x)).toBe(false);
    m.run(inputModeCommand("block", { ...base, busRule: "kwin", doorShut: true }));
    m.run(inputModeCommand("allow", blocked));
    expect([m.file.bus, m.file.x, m.file.udev].filter(existsSync)).toEqual([]);
    for (const f of [m.file.bus, m.file.x, m.file.udev]) expect(m.calls()).toContain(`sudo rm -f ${f}`);
    expect(m.calls()).toContain("--key XwaylandEisNoPrompt true");
  });

  it("Allow removes an Xwayland only if it is TuxCopilot's", () => {
    const m = machine();
    writeFileSync(m.file.x, "#!/bin/sh\nexec /opt/my/Xwayland \"$@\"\n");
    m.run(inputModeCommand("allow", { ...blocked, xtestWrapper: true }));
    expect(existsSync(m.file.x)).toBe(true);
  });

  it("Block counts only with every lock written", () => {
    expect(inputMode({ ...blocked, busRule: "kwin" })).toBe("ask");
    expect(inputMode({ ...blocked, xtestWrapper: false })).toBe("ask");
    expect(inputMode({ ...blocked, ourRule: false })).toBe("ask");
    expect(inputMode({ ...blocked, xtestOffNow: false, doorShut: false })).toBe("block"); // written, in effect from the next login
  });

  it("each lock says how it stands right now", () => {
    const st = (s: InputControl) => Object.fromEntries(locks(s).map((l) => [l.name, l.state]));
    expect(st(base)).toEqual({ "KWin's own door": "open", "Remote-control apps (the portal)": "asks", "X11 programs (XTEST)": "asks", "/dev/uinput": "open" });
    expect(st(blocked)).toEqual({ "KWin's own door": "shut", "Remote-control apps (the portal)": "shut", "X11 programs (XTEST)": "shut", "/dev/uinput": "shut" });
    expect(st({ ...blocked, doorShut: false, xtestOffNow: false })["KWin's own door"]).toBe("next-login");
    expect(st({ ...blocked, xtestOffNow: null })["X11 programs (XTEST)"]).toBe("next-login");
    expect(st({ ...base, noPrompt: true })["X11 programs (XTEST)"]).toBe("open");
  });

  it("before Block, it says what stops working, from what is installed", () => {
    expect(blockCosts({ ...base, affected: ["onboard", "rustdesk-bin", "krdp"], krdpOn: true, ydotoolOn: true })).toEqual([
      "OpenTabletDriver (your drawing tablet) stops working",
      "Onboard (the on-screen keyboard) can't type into X11 programs",
      "RustDesk: nobody can control this computer through it",
      "KDE's Remote Desktop server is switched off",
      "ydotool's service is switched off",
    ]);
  });

  it("the screen, the reader and the tags name the same files", () => {
    const rs = readFileSync("src-tauri/src/inputctl.rs", "utf8");
    expect(rs).toContain(`pub const BUS_RULE: &str = "${BUS_RULE}";`);
    expect(rs).toContain(`pub const XWAYLAND: &str = "${XWAYLAND}";`);
    expect(tuxPath(BUS_RULE)).toMatch(/keyboard and mouse/);
    expect(tuxPath(XWAYLAND)).toMatch(/without XTEST/);
  });

  it("Ask without KWin's door shut is unfinished, and can be pressed again", () => {
    expect(unfinished(base)).toBe(true); // how every computer starts
    expect(unfinished({ ...base, busRule: "kwin" })).toBe(false);
    expect(unfinished(blocked)).toBe(false);
    expect(unfinished({ ...base, noPrompt: true })).toBe(false); // Allow is what you chose
  });
});

describe("As it comes (Security → Devices: you can always go back to Arch's own settings)", () => {
  it("from Block, every lock of Fluff's goes, and KDE's window asks as it came", async () => {
    const { inputArchCommand } = await import("@/lib/input-control");
    const m = machine();
    m.run(inputModeCommand("block", base));
    m.run(inputArchCommand(blocked));
    expect([m.file.bus, m.file.x, m.file.udev].filter(existsSync)).toEqual([]);
    expect(m.calls()).toContain("--key XwaylandEisNoPrompt false");
    expect(m.calls()).toContain("--key XwaylandEisNoPromptApps --delete"); // nobody always allowed
    expect(m.calls()).not.toContain("XwaylandEisNoPrompt true");
    // from KDE's own, nothing to take away: only KDE's setting said again
    expect(inputArchCommand(base)).toMatch(/^kwriteconfig6 --file kwinrc --group Xwayland --key XwaylandEisNoPrompt false && kwriteconfig6 --file kwinrc --group Xwayland --key XwaylandEisNoPromptApps --delete && qdbus6 org\.kde\.KWin \/KWin reconfigure && \{ r=\$\(kreadconfig6 [^]*\[ "\$r" = false \][^]*XwaylandEisNoPromptApps\); \[ -z "\$r" \][^]*\}$/);
    expect(inputArchCommand(base)).not.toMatch(/sudo/); // nothing of Fluff's to take away: your own setting, no password
  });
});

describe("no error hidden", () => {
  it("Block closes today's /dev/uinput opening, and checks it is closed", () => {
    const m = machine();
    m.run(inputModeCommand("block", base));
    expect(m.calls()).toContain(`setfacl -x u:${process.env.USER}`);
    expect(() => machine({ uinputStuck: true }).run(inputModeCommand("block", base))).toThrow(/^stderr: Fluff: \S+uinput is still open to your account\.$/m);
  });

  it("ydotool's and KDE's Remote Desktop services: switched off only if there, and checked stopped", () => {
    expect(() => machine({ serviceStuck: true }).run(inputModeCommand("block", { ...base, krdpOn: true }))).toThrow(/^stderr: Fluff: ydotool's service is still running\.$/m);
    const m = machine();
    m.run(inputModeCommand("block", { ...base, krdpOn: true }));
    expect(m.calls()).toContain("systemctl --user disable --now ydotool.service");
    expect(m.calls()).toContain("systemctl --user disable --now app-org.kde.krdpserver.service");
  });

  it("KWin's setting that didn't take is caught: read back after it is written", () => {
    expect(() => machine({ kdeIgnores: true }).run(inputModeCommand("ask", base))).toThrow(/^stderr: Fluff: KWin's setting says "", not false\.$/m);
    expect(() => machine({ kdeIgnores: true }).run(inputModeCommand("allow", base))).toThrow(/^stderr: Fluff: KWin's setting says "", not true\.$/m);
  });

  it("an Xwayland written but not as it should be (not runnable) is said, and Block fails", () => {
    expect(() => machine({ chmodIgnored: true }).run(inputModeCommand("block", base))).toThrow(/^stderr: Fluff: \S+Xwayland wasn't written as it should be\.$/m);
  });

  it("no hidden true: no command of these hides an error", () => {
    for (const c of [inputModeCommand("block", { ...base, krdpOn: true, ydotoolOn: true }), inputModeCommand("ask", blocked), inputModeCommand("allow", blocked)]) {
      expect(c).not.toMatch(/; true; \}|\|\| true\b/);
    }
  });
});
