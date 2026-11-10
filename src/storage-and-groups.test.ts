// USB sticks and SD cards: Allow / Ask / Block; and the groups that hand out root, out and back in
// The commands are run here for real against a fake machine; the polkit
// rule is run in a sandbox with a pretend polkit, the way polkit itself calls it.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { DRIVER_RULE, DRIVER_RULE_TEXT, OWN_SEAT, STORAGE_MODES, POLKIT_DIRS, POLKIT_RULE, PROC_MODULES, polkitRuleText, SAVED, STORAGE_DRIVERS, storageMode, storageModeCommand, storageNotes, type StorageControl } from "@/lib/storage-control";
import { GROUP_WORDS, groupCommand, groupState, neededWhy, needsPassword, sortGroups, wordsFor, type Group } from "@/lib/groups";
import { tuxPath } from "@/lib/tux-own";

const base: StorageControl = { mount: "yes", driverRule: false, loaded: [], systemRemovable: false };

/** polkit calls the rule's function for each question; this is that, with a pretend polkit. */
function polkitSays(rule: string[], action: string): string | undefined {
  const rules: Array<(a: { id: string }, s: object) => unknown> = [];
  runInNewContext(rule.join("\n"), { polkit: { addRule: (f: (typeof rules)[number]) => rules.push(f), Result: { YES: "yes", NO: "no", AUTH_ADMIN: "auth_admin" } } });
  expect(rules).toHaveLength(1);
  return rules[0]({ id: action }, {}) as string | undefined;
}

function machine(
  polkitAnswers: number[],
  o: { loaded?: string[]; busy?: string[]; deaf?: boolean; builtIn?: string[]; firstRule?: string; actionSays?: Record<string, number>; old?: string; teeFails?: string; noBackDir?: boolean; mvBackFails?: boolean } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "tux-usb-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const log = join(root, "calls.log");
  writeFileSync(join(root, "answers"), polkitAnswers.join("\n") + "\n");
  for (const [name, body] of [
    ["sudo", `echo "sudo $*" >> ${log}; exec "$@"`],
    // modprobe: its config is the driver rule; a driver in use (a stick is in) won't leave
    ["modprobe", `echo "modprobe $*" >> ${log}; case "$1" in --showconfig) ${o.deaf ? "true" : `${o.firstRule ? `echo '${o.firstRule}'; ` : ""}cat ${join(root, "tuxcopilot-storage.conf")} 2>/dev/null`};; -r) case " ${(o.busy ?? []).join(" ")} " in *" $2 "*) echo "modprobe: FATAL: Module $2 is in use." >&2; exit 1;; esac; grep -v "^$2 " ${join(root, "modules")} > ${join(root, "modules.t")}; mv ${join(root, "modules.t")} ${join(root, "modules")};; esac`],
    ["sleep", "true"],
    // polkit answers in turn (it reads its rules again by itself, a moment later)
    ["pkcheck", `echo "pkcheck $*" >> ${log}; [ -e "${root}/says-$2" ] && exit "$(cat "${root}/says-$2")"; a=$(head -1 ${root}/answers); [ "$(wc -l < ${root}/answers)" -gt 1 ] && sed -i 1d ${root}/answers; exit $a`],
    ["modinfo", `case " ${(o.builtIn ?? []).join(" ")} " in *" $3 "*) echo "(builtin)";; *) echo "/lib/modules/x/$3.ko.zst";; esac`],
    // writing a file that fails half way (a full disk)
    ["mv", `case "$*" in *saved.*) ${o.mvBackFails ? `echo "mv: cannot move: Read-only file system" >&2; exit 1` : "true"};; esac; exec /usr/bin/mv "$@"`],
    ["tee", `case "$1" in ${o.teeFails ?? "-"}) printf '# Tux' > "$1"; echo "tee: $1: No space left on device" >&2; exit 1;; esac; exec /usr/bin/tee "$@"`],
  ]) {
    writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const file = { polkit: join(root, "00-tuxcopilot-storage.rules"), driver: join(root, "tuxcopilot-storage.conf") };
  // a file there must be TuxCopilot's own (its first line) to be written over
  writeFileSync(file.polkit, o.old ?? "// TuxCopilot: old");
  for (const [a, c] of Object.entries(o.actionSays ?? {})) writeFileSync(join(root, `says-${a}`), String(c));
  const rules = { etc: join(root, "rules.etc"), usr: join(root, "rules.usr") };
  mkdirSync(rules.etc);
  mkdirSync(rules.usr);
  writeFileSync(join(rules.usr, "50-default.rules"), "polkit.addAdminRule(function () { return ['unix-group:wheel']; });\n");
  writeFileSync(join(root, "modules"), (o.loaded ?? []).map((d) => `${d} 90112 0 - Live 0x0\n`).join(""));
  const run = (cmd: string) => {
    try {
      const here = cmd
        .replaceAll(POLKIT_RULE, file.polkit)
        .replaceAll(DRIVER_RULE, file.driver)
        .replaceAll(PROC_MODULES, join(root, "modules"))
        .replaceAll(POLKIT_DIRS.join(" "), `${rules.etc} ${rules.usr}`)
        .replaceAll(SAVED, o.noBackDir ? join(root, "nowhere", "x.XXXXXX") : join(root, "saved.XXXXXX"));
      return execFileSync("bash", ["-c", here], { encoding: "utf8", stdio: "pipe", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    } catch (e) {
      throw new Error(`stderr: ${String((e as { stderr?: string }).stderr)}`);
    }
  };
  const left = () => readdirSync(root).filter((f) => f.startsWith("saved.") || f.endsWith(".new"));
  return { root, file, rules, run, left, calls: () => readFileSync(log, "utf8") };
}

describe("USB sticks and SD cards: Allow, Ask, Block", () => {
  it("the switch shows polkit's own answer", () => {
    expect(storageMode(base)).toBe("allow");
    expect(storageMode({ ...base, mount: "ask" })).toBe("ask");
    expect(storageMode({ ...base, mount: "no", driverRule: true })).toBe("block");
    expect(storageMode({ ...base, mount: "no" })).toBeNull(); // refused by someone else's rule: not Fluff's Block
    expect(storageMode({ ...base, mount: "yes", driverRule: true })).toBeNull(); // half way
    expect(storageMode({ ...base, mount: "" })).toBeNull();
  });

  it("the rule, as polkit runs it: Ask asks for a password, Block refuses — opening and unlocking a removable drive only", () => {
    for (const a of ["filesystem-mount", "filesystem-mount-other-seat", "encrypted-unlock", "encrypted-unlock-other-seat"]) {
      expect(polkitSays(polkitRuleText("ask"), `org.freedesktop.udisks2.${a}`)).toBe("auth_admin");
      expect(polkitSays(polkitRuleText("block"), `org.freedesktop.udisks2.${a}`)).toBe("no");
    }
    // the system's own disks, and everything else, are left to the usual rules
    for (const a of ["org.freedesktop.udisks2.filesystem-mount-system", "org.freedesktop.udisks2.encrypted-unlock-system", "org.freedesktop.login1.power-off", "org.freedesktop.udisks2.loop-setup"])
      expect(polkitSays(polkitRuleText("block"), a)).toBeUndefined();
    for (const l of [...polkitRuleText("ask"), ...polkitRuleText("block"), ...DRIVER_RULE_TEXT]) expect(l).not.toContain("'"); // written inside '…'
  });

  it("Ask: the rule written, and it waits until polkit asks for a password", () => {
    const m = machine([0, 0, 2]);
    m.run(storageModeCommand("ask", base));
    expect(readFileSync(m.file.polkit, "utf8")).toBe(polkitRuleText("ask").join("\n") + "\n");
    expect(m.calls().match(/^pkcheck --action-id org\.freedesktop\.udisks2\.filesystem-mount --process \d+$/gm)).toHaveLength(3);
    expect(existsSync(m.file.driver)).toBe(false);
  });

  it("Block: opening refused and the three drivers refused; drivers not in use leave now", () => {
    const m = machine([1]);
    m.run(storageModeCommand("block", { ...base, mount: "ask" }));
    expect(readFileSync(m.file.polkit, "utf8")).toBe(polkitRuleText("block").join("\n") + "\n");
    expect(readFileSync(m.file.driver, "utf8")).toBe(DRIVER_RULE_TEXT.join("\n") + "\n");
    expect(DRIVER_RULE_TEXT.slice(1)).toEqual(["install usb_storage /bin/false", "install uas /bin/false", "install mmc_block /bin/false"]);
    expect(m.calls()).not.toContain("modprobe -r"); // nothing loaded: nothing to take away
    expect(m.calls()).toContain("sudo modprobe --showconfig"); // the refusal, as modprobe itself reads it
    // loaded: they go, uas before usb_storage (which it needs); one in use is said, and the command still ends well
    const busy = machine([1], { loaded: ["usb_storage", "uas", "mmc_block"], busy: ["usb_storage"] });
    const out = busy.run(storageModeCommand("block", { ...base, mount: "ask" }));
    expect(busy.calls().match(/^sudo modprobe -r \S+$/gm)).toEqual(["sudo modprobe -r mmc_block", "sudo modprobe -r uas", "sudo modprobe -r usb_storage"]);
    expect(out).toContain("Fluff: usb_storage is in use now (a USB stick, disk or SD card is in): it keeps working until you take it out, and not again after.");
    for (const f of [m.file.polkit, m.file.driver]) expect(m.calls()).toContain(`sudo tee ${f}`);
  });

  it("a driver rule modprobe doesn't read: Block says so and fails", () => {
    // the message names the drivers modprobe doesn't refuse
    expect(() => machine([1], { deaf: true }).run(storageModeCommand("block", { ...base, mount: "ask" }))).toThrow(/^stderr: Fluff: modprobe doesn't refuse usb_storage uas mmc_block \(it couldn't read its rules, or another rule for it comes first\)\.$/m);
  });

  it("polkit that never answers as asked: the command says so and fails", () => {
    const m = machine([0]);
    // it says what polkit said, and for which action
    expect(() => m.run(storageModeCommand("ask", base))).toThrow(/^stderr: Fluff: polkit says yes for org\.freedesktop\.udisks2\.filesystem-mount, not ask for a password\.$/m);
  });

  it("Allow, and Ask from Block: TuxCopilot's files go, the drivers come back", () => {
    const blocked = { ...base, mount: "no" as const, driverRule: true };
    const a = machine([0]);
    writeFileSync(a.file.driver, "# TuxCopilot: x"); // TuxCopilot's own
    a.run(storageModeCommand("allow", blocked));
    expect([a.file.polkit, a.file.driver].filter(existsSync)).toEqual([]);
    expect(a.calls()).toContain(`sudo rm -f ${a.file.polkit}`);
    const k = machine([2]);
    writeFileSync(k.file.driver, "# TuxCopilot: x");
    k.run(storageModeCommand("ask", blocked));
    expect(existsSync(k.file.driver)).toBe(false);
    expect(readFileSync(k.file.polkit, "utf8")).toContain("AUTH_ADMIN");
  });

  it("a system that starts from USB or SD is never blocked", () => {
    expect(() => storageModeCommand("block", { ...base, systemRemovable: true })).toThrow(/would stop it from starting/);
    expect(storageNotes({ ...base, systemRemovable: true })).toContain("Your system starts from a USB disk or an SD card, so Block isn't offered.");
    expect(storageNotes({ ...base, mount: "no", driverRule: true, loaded: ["usb_storage"] })[0]).toMatch(/keeps working until you take it out/);
    expect(storageNotes(base)).toEqual([]);
  });

  it("the screen, the reader and the tags name the same files and drivers", () => {
    const rs = readFileSync("src-tauri/src/devices.rs", "utf8");
    expect(rs).toContain(`pub const DRIVER_RULE: &str = "${DRIVER_RULE}";`);
    expect(rs).toContain(`pub const STORAGE_DRIVERS: &[&str] = &[${STORAGE_DRIVERS.map((d) => `"${d}"`).join(", ")}];`);
    expect(tuxPath(POLKIT_RULE)).toMatch(/USB sticks and SD cards/);
    expect(tuxPath(DRIVER_RULE)).toMatch(/drivers/);
  });
});

// Existing files backed up; a rollback removes only the files this created, and says clearly if the
// cleanup fails; the resulting policy and module behaviour verified directly; what it covers, said
// exactly.
describe("USB sticks and SD cards: nothing written over, everything checked, put back when it fails", () => {
  const ask = { ...base, mount: "ask" as const };
  const OLD = "// TuxCopilot: old";
  const asWas = (m: ReturnType<typeof machine>) => {
    expect(readFileSync(m.file.polkit, "utf8")).toBe(OLD);
    expect(existsSync(m.file.driver)).toBe(false); // made by this command: removed
    expect(m.left()).toEqual([]); // no copies, no half-written files
  };

  it("a file there that isn't TuxCopilot's is never written over or removed", () => {
    const theirs = "polkit.addRule(function () {});";
    for (const to of ["allow", "ask", "block"] as const) {
      const m = machine([1], { old: theirs });
      expect(() => m.run(storageModeCommand(to, ask))).toThrow(/^stderr: Fluff: \S+00-tuxcopilot-storage\.rules is there and isn't TuxCopilot's: Fluff won't write over it or remove it\.\n$/);
      expect(readFileSync(m.file.polkit, "utf8")).toBe(theirs);
      expect(m.calls()).not.toMatch(/sudo (tee|rm -f \S+rules )/);
      expect(m.left()).toEqual([]);
    }
  });

  it("every action is asked: one that answers otherwise fails it, and everything is put back", () => {
    const m = machine([1], { actionSays: { "org.freedesktop.udisks2.encrypted-unlock-other-seat": 2 } });
    expect(() => m.run(storageModeCommand("block", ask))).toThrow(
      /^stderr: Fluff: polkit says ask for a password for org\.freedesktop\.udisks2\.encrypted-unlock-other-seat, not no\.\nFluff: nothing changed — put back as it was\.\n$/,
    );
    asWas(m);
    const asked = (cmd: string) => {
      const k = machine([cmd.includes("AUTH_ADMIN") ? 2 : cmd.includes("polkit.Result.NO") ? 1 : 0]);
      k.run(cmd);
      return [...new Set(k.calls().match(/(?<=--action-id )\S+/g))];
    };
    const all = ["filesystem-mount", "encrypted-unlock", "filesystem-mount-other-seat", "encrypted-unlock-other-seat"].map((a) => `org.freedesktop.udisks2.${a}`);
    expect(asked(storageModeCommand("block", ask))).toEqual(all);
    expect(asked(storageModeCommand("ask", base))).toEqual(all);
    expect(asked(storageModeCommand("allow", ask))).toEqual(OWN_SEAT); // the other seats ask a password as Arch comes
  });

  it("a file that fails to write half way: the first put back, the new one removed", () => {
    const m = machine([1], { teeFails: `*tuxcopilot-storage.conf.new` });
    expect(() => m.run(storageModeCommand("block", ask))).toThrow(/^stderr: tee: \S+ No space left on device\nFluff: nothing changed — put back as it was\.\n$/);
    asWas(m);
  });

  it("modprobe takes the first rule for a driver: another one first fails it", () => {
    const m = machine([1], { firstRule: "install usb_storage /sbin/modprobe --ignore-install usb_storage" });
    expect(() => m.run(storageModeCommand("block", ask))).toThrow(/^stderr: Fluff: modprobe doesn't refuse usb_storage \(it couldn't read its rules, or another rule for it comes first\)\.\n/);
    asWas(m);
  });

  it("a driver built into the kernel: Block refused before anything is written", () => {
    const m = machine([1], { builtIn: ["mmc_block"] });
    expect(() => m.run(storageModeCommand("block", ask))).toThrow(/^stderr: Fluff: mmc_block is built into this kernel, so no rule can refuse it: Block can't be done here\. Ask still works\.\n$/);
    expect(m.calls()).not.toContain("tee");
    expect(m.left()).toEqual([]);
  });

  it("a put back that fails is said, and the copy kept", () => {
    const m = machine([1], { actionSays: { "org.freedesktop.udisks2.encrypted-unlock": 0 }, mvBackFails: true });
    expect(() => m.run(storageModeCommand("block", ask))).toThrow(/Fluff: couldn't put \S+00-tuxcopilot-storage\.rules back as it was\.\n$/);
    expect(m.left()).toEqual([expect.stringMatching(/^saved\./)]); // the old file's copy is still there
  });

  it("no place for the copies: nothing is changed", () => {
    const m = machine([1], { noBackDir: true });
    expect(() => m.run(storageModeCommand("block", ask))).toThrow(/^stderr: mktemp: /);
    expect(readFileSync(m.file.polkit, "utf8")).toBe(OLD);
    expect(m.calls()).not.toContain("tee");
  });

  it("done: no copies left; other polkit rules about drives are named; Allow from Block put back too", () => {
    const m = machine([1]);
    writeFileSync(join(m.rules.etc, "10-admin-disks.rules"), 'polkit.addRule(function (a) { if (a.id.indexOf("org.freedesktop.udisks2.") == 0) return polkit.Result.YES; });\n');
    const out = m.run(storageModeCommand("block", ask));
    expect(out).toBe(`Fluff: other polkit rules also speak about drives: ${join(m.rules.etc, "10-admin-disks.rules")}. For USB sticks and SD cards polkit answers as TuxCopilot's rule says — checked just now.\n`);
    expect(m.left()).toEqual([]);
    expect(machine([0]).run(storageModeCommand("allow", ask))).toBe(""); // nothing to name when Arch's own answers
    // Allow that polkit doesn't follow: both of TuxCopilot's files come back as they were
    const b = machine([1]);
    writeFileSync(b.file.driver, DRIVER_RULE_TEXT.join("\n") + "\n");
    expect(() => b.run(storageModeCommand("allow", { ...base, mount: "no", driverRule: true }))).toThrow(/put back as it was/);
    expect(readFileSync(b.file.polkit, "utf8")).toBe(OLD);
    expect(readFileSync(b.file.driver, "utf8")).toBe(DRIVER_RULE_TEXT.join("\n") + "\n");
    expect(b.left()).toEqual([]);
  });

  it("the words say what it covers, and what it doesn't", () => {
    const block = STORAGE_MODES.find((x) => x.id === "block")!.what;
    expect(block).toMatch(/Not stopped: a phone's or camera's files, and disks plugged in by Thunderbolt or eSATA\./);
    expect(STORAGE_MODES.find((x) => x.id === "ask")!.what).toMatch(/Your computer's own disks are left as they are\./);
    expect(storageNotes({ ...base, mount: "mixed" })).toEqual(["polkit answers differently for opening a drive and for unlocking an encrypted one: choose again to set both."]);
    expect(storageMode({ ...base, mount: "mixed" })).toBeNull();
    const rs = readFileSync("src-tauri/src/devices.rs", "utf8");
    for (const a of OWN_SEAT) expect(rs).toContain(`"${a}"`); // the reader asks the same two
  });
});

// Groups: any group, wheel too — switchable, guarded so you are never left without a way back.
describe("your groups: out of any, into any", () => {
  const G = (name: string, over: Partial<Group> = {}): Group => ({ name, gid: 1, listed: true, thisLogin: true, primary: false, others: 0, ...over });

  function groupMachine(groups: string, opts: { wheelOthers?: string; rootpw?: string } = {}) {
    const root = mkdtempSync(join(tmpdir(), "tux-group-"));
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(root, "groups"), groups + "\n");
    for (const [name, body] of [
      ["sudo", `echo "sudo $*" >> ${root}/calls.log; [ "$1" = -k ] && exit 0; exec "$@"`],
      ["gpasswd", `[ "$1" = -d ] && sed -i "s/ $3\\b//" ${root}/groups; [ "$1" = -a ] && sed -i "s/\\$/ $3/" ${root}/groups; true`],
      ["id", `cat ${root}/groups`],
      ["getent", `echo "wheel:x:998:${opts.wheelOthers ? `${opts.wheelOthers},` : ""}penguin"`],
      ["passwd", `echo "root ${opts.rootpw ?? "L"} 2026-01-01 -1 -1 -1 -1"`],
    ]) {
      writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    }
    const run = (cmd: string) => {
      try {
        return execFileSync("bash", ["-c", cmd], { encoding: "utf8", stdio: "pipe", env: { ...process.env, USER: "penguin", PATH: `${bin}:${process.env.PATH}` } });
      } catch (e) {
        throw new Error(`stderr: ${String((e as { stderr?: string }).stderr)}`);
      }
    };
    return { run, groups: () => readFileSync(join(root, "groups"), "utf8"), calls: () => (existsSync(join(root, "calls.log")) ? readFileSync(join(root, "calls.log"), "utf8") : "") };
  }

  it("out of docker: gpasswd -d for you, checked, and it says when it counts", () => {
    const m = groupMachine("penguin wheel docker");
    expect(m.run(groupCommand(G("docker"), false))).toContain("It counts from your next login");
    expect(m.groups()).toBe("penguin wheel\n");
    expect(m.calls()).toBe("sudo gpasswd -d penguin docker\n");
  });

  it("into any group: gpasswd -a, checked", () => {
    const m = groupMachine("penguin wheel");
    m.run(groupCommand(G("uucp", { listed: false }), true));
    expect(m.groups()).toBe("penguin wheel uucp\n");
  });

  it("only the whole name counts", () => {
    const m = groupMachine("penguin wheel docker dockerx");
    m.run(groupCommand(G("docker"), false));
    expect(m.groups()).toBe("penguin wheel dockerx\n");
  });

  it("if the change didn't take, the command fails", () => {
    const m = groupMachine("penguin wheel");
    expect(() => m.run(groupCommand(G("libvirt", { listed: false }), true).replace("sudo gpasswd", "true"))).toThrow();
  });

  // the screen offers no switch for wheel when you are its only one; the command keeps
  // its own check as root, for any caller that doesn't say who else is in it
  it("out of wheel, asked without saying who else is in it: the command's own check refuses when you are its only one and root has no password", () => {
    for (const rootpw of ["L", "NP"]) {
      const m = groupMachine("penguin wheel", { rootpw });
      expect(() => m.run(groupCommand({ name: "wheel", primary: false }, false))).toThrow(/^stderr: Fluff: you are the only one who can use sudo, and root has no password/);
      expect(m.groups()).toBe("penguin wheel\n");
      expect(m.calls()).not.toContain("gpasswd");
    }
  });

  it("out of wheel with a way back — root's password, or someone else in wheel — and it says sudo stops at once", () => {
    const a = groupMachine("penguin wheel", { rootpw: "P" });
    expect(a.run(groupCommand({ name: "wheel", primary: false }, false))).toContain("sudo reads it at once");
    expect(a.groups()).toBe("penguin\n");
    const b = groupMachine("penguin wheel", { wheelOthers: "alice" });
    b.run(groupCommand(G("wheel", { others: 1 }), false));
    expect(b.groups()).toBe("penguin\n");
    expect(groupCommand(G("docker"), false)).not.toContain("passwd -S"); // only wheel asks
  });

  it("never out of your own group; only group names", () => {
    expect(() => groupCommand(G("penguin", { primary: true }), false)).toThrow(/your own group/);
    expect(() => groupCommand(G("docker; rm -rf ~"), false)).toThrow(/not a group name/);
    expect(() => groupCommand(G("$(reboot)"), true)).toThrow();
  });

  it("what each gives, the riskiest of yours first", () => {
    expect(wordsFor("docker").risk).toBe("root");
    expect(wordsFor("wheel").risk).toBe("admin");
    expect(wordsFor("input").risk).toBe("private");
    expect(wordsFor("something-new").gives).toMatch(/depends on the programs/);
    const { mine, others } = sortGroups([G("audio"), G("wheel"), G("docker"), G("zz", { listed: false, thisLogin: false }), G("aa", { listed: false, thisLogin: false })]);
    expect(mine.map((g) => g.name)).toEqual(["docker", "wheel", "audio"]);
    expect(others.map((g) => g.name)).toEqual(["aa", "zz"]);
  });

  it("how it stands, including the login that hasn't caught up", () => {
    const g = G("docker");
    expect(groupState(g)).toBe("you are in it");
    expect(groupState({ ...g, listed: false })).toBe("you are out of it from your next login (this login still has it)");
    expect(groupState({ ...g, thisLogin: false })).toBe("you are in it from your next login");
    expect(groupState({ ...g, listed: false, thisLogin: false })).toBe("you are not in it");
    expect(groupState({ ...g, primary: true })).toBe("your own group");
  });

  it("no switch for a group you can't leave: your own, and wheel when you are its only administrator", () => {
    expect(neededWhy(G("penguin", { primary: true }))).toMatch(/^your own group/);
    expect(neededWhy(G("wheel"))).toMatch(/^you are the only administrator/);
    expect(neededWhy(G("wheel", { others: 1 }))).toBeNull();
    expect(neededWhy(G("wheel", { listed: false }))).toBeNull(); // not in it: joining is fine
    expect(neededWhy(G("docker"))).toBeNull();
    expect(() => groupCommand(G("wheel"), false)).toThrow(/^Fluff can't take you out: you are the only administrator/);
    expect(() => groupCommand(G("wheel"), true)).not.toThrow(); // joining needs no way back
  });

  it("changing wheel always asks an administrator's password, even one typed a moment ago", () => {
    expect(needsPassword("wheel")).toBe(true);
    expect(needsPassword("docker")).toBe(false);
    for (const add of [true, false]) expect(groupCommand(G("wheel", { others: 1, listed: !add }), add)).toMatch(/^sudo -k && /);
    expect(groupCommand(G("docker"), false)).not.toContain("sudo -k");
    const m = groupMachine("penguin wheel", { wheelOthers: "alice" });
    m.run(groupCommand(G("wheel", { others: 1 }), false));
    expect(m.calls().split("\n")[0]).toBe("sudo -k"); // first, before anything as root
  });

  it("before leaving any group, Fluff can say what happens without it", () => {
    for (const [name, w] of Object.entries(GROUP_WORDS)) {
      expect(w.without, name).toMatch(/\S/);
      expect(w.without, name).toMatch(/[.)]$/);
    }
    expect(wordsFor("something-new").without).toMatch(/if you aren't sure what it is for, keep it/);
    expect(wordsFor("kvm").without).toMatch(/virtual machines/);
  });
});

