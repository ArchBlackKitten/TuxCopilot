// Security → Accounts & login's commands, run for real against a fake KDE, systemd and group
// database: no gap left, no error masked. A failure says only what went to stderr.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lidSleepCommand, lockSetCommand, type ScreenLock } from "@/lib/screenlock";
import { groupCommand } from "@/lib/groups";
import { JOURNAL_KEEP, keepJournalCommand } from "@/lib/logins";
import { JOURNAL_ARCH } from "@/lib/level-accounts";

const kde: ScreenLock = { autolock: true, timeoutMin: 5, lockOnResume: true, graceS: 5, laptop: true, lid: [["AC", 1]], autologin: null };

function machine(o: { kdeIgnores?: boolean; noAnswer?: boolean; groups?: string; idFails?: boolean; gpasswdIgnored?: boolean; journald?: "down" | "override" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "tux-acct-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const conf = join(root, "kde.conf");
  writeFileSync(conf, "");
  writeFileSync(join(root, "groups"), `${o.groups ?? "penguin wheel docker"}\n`);
  const keep = join(root, "tuxcopilot-keep.conf");
  const tool = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  // KDE's settings: --file F --group G [--group H] --key K V
  tool("kwriteconfig6", `v="\${@: -1}"; k=$(printf '%s|' "\${@:1:$#-1}"); ${o.kdeIgnores ? "exit 0" : `grep -vF -e "$k=" ${conf} > ${conf}.t; mv ${conf}.t ${conf}; echo "$k=$v" >> ${conf}`}`);
  tool("kreadconfig6", `k=$(printf '%s|' "$@"); grep -F -e "$k=" ${conf} | tail -n1 | sed "s|^.*=||"`);
  tool("qdbus6", o.noAnswer ? `echo "Cannot find '.configure' in object /ScreenSaver" >&2; exit 1` : "exit 0");
  tool("sudo", `exec "$@"`);
  tool("id", o.idFails ? `echo "id: cannot read the group database" >&2; exit 1` : `cat ${root}/groups`);
  tool("gpasswd", o.gpasswdIgnored ? "exit 0" : `g="\${@: -1}"; if [ "$1" = -d ]; then tr ' ' '\\n' < ${root}/groups | grep -vx "$g" | xargs > ${root}/g.t; else { cat ${root}/groups; echo "$g"; } | xargs > ${root}/g.t; fi; mv ${root}/g.t ${root}/groups`);
  tool("systemctl", `case "$1" in is-active) ${o.journald === "down" ? "exit 3" : "exit 0"};; *) exit 0;; esac`);
  tool("systemd-analyze", `echo "# /usr/lib/systemd/journald.conf.d/00-journal-size.conf"; echo "SystemMaxUse=50M"; [ -e ${keep} ] && cat ${keep}; ${o.journald === "override" ? `echo "# /etc/systemd/journald.conf.d/zz-other.conf"; echo "SystemMaxUse=100M"` : "true"}`);
  tool("mkdir", "exit 0");
  return {
    run: (cmd: string) => {
      try {
        return execFileSync("bash", ["-c", cmd.replaceAll(JOURNAL_KEEP, keep)], { encoding: "utf8", stdio: "pipe", env: { ...process.env, USER: "penguin", PATH: `${bin}:${process.env.PATH}` } });
      } catch (e) {
        throw new Error(`stderr: ${(e as { stderr?: string }).stderr ?? ""}`);
      }
    },
    groups: () => readFileSync(join(root, "groups"), "utf8").trim(),
    keep,
  };
}

describe("the screen lock and the lid: written, then read back from KDE's own files", () => {
  it("the lock's settings land, and a locker that doesn't answer is said, not hidden", () => {
    expect(machine().run(lockSetCommand({ timeout: 2, grace: 0 }, kde))).toBe("");
    expect(machine({ noAnswer: true }).run(lockSetCommand({ timeout: 2, grace: 0 }, kde))).toBe("Fluff: the screen locker didn't answer — the new settings count from your next login.\n");
  });

  it("settings that didn't land: the command fails, and says which", () => {
    expect(() => machine({ kdeIgnores: true }).run(lockSetCommand({ timeout: 2, grace: 0 }, kde))).toThrow(/^stderr: Fluff: Timeout says "", not 2\.\n$/); // the first that didn't land stops it
    expect(() => machine({ kdeIgnores: true }).run(lidSleepCommand(["Battery"]))).toThrow(/^stderr: Fluff: LidAction says "", not 1\.\n$/);
  });

  it("the lid: read back per profile", () => {
    expect(machine().run(lidSleepCommand(["AC", "Battery"]))).toBe("");
    expect(machine({ noAnswer: true }).run(lidSleepCommand(["AC"]))).toBe("Fluff: the power manager didn't answer — the lid counts from your next login.\n");
  });
});

describe("leaving and joining a group: the group database's own answer", () => {
  it("out of docker: done, and checked", () => {
    const m = machine();
    expect(m.run(groupCommand({ name: "docker", primary: false }, false))).toContain("Fluff: done.");
    expect(m.groups()).toBe("penguin wheel");
  });

  it("an id that can't answer is a failure — never read as \"left\"", () => {
    expect(() => machine({ idFails: true }).run(groupCommand({ name: "docker", primary: false }, false))).toThrow(/^stderr: id: cannot read the group database\n$/);
  });

  it("a change that didn't take is said", () => {
    expect(() => machine({ gpasswdIgnored: true }).run(groupCommand({ name: "docker", primary: false }, false))).toThrow(/^stderr: Fluff: you are still in docker\.\n$/);
    expect(() => machine({ gpasswdIgnored: true, groups: "penguin" }).run(groupCommand({ name: "docker", primary: false }, true))).toThrow(/^stderr: Fluff: you are not in docker\.\n$/);
  });
});

describe("the journal: a month kept, or as it comes — journald's own config checked", () => {
  it("a month: TuxCopilot's size is the one that counts", () => {
    const m = machine();
    m.run(keepJournalCommand());
    expect(readFileSync(m.keep, "utf8")).toContain("SystemMaxUse=500M");
  });

  it("a file after it that wins, or a journald that didn't come back, is said and fails", () => {
    expect(() => machine({ journald: "override" }).run(keepJournalCommand())).toThrow(/^stderr: Fluff: the journal's size is SystemMaxUse=100M, not TuxCopilot's\.\n$/);
    expect(() => machine({ journald: "down" }).run(keepJournalCommand())).toThrow(/^stderr: Fluff: the journal \(systemd-journald\) isn't running\.\n$/);
  });

  it("as it comes: TuxCopilot's file gone, and its size no longer counts", () => {
    const m = machine();
    m.run(keepJournalCommand());
    m.run(JOURNAL_ARCH);
    expect(() => readFileSync(m.keep)).toThrow();
  });
});
