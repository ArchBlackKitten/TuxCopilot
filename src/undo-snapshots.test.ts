// "Undo this change". Fluff records each snapper pair it
// takes; undo checks as root that the pair is really TuxCopilot's before snapper undoes anything.
// Run here for real against a fake snapper.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotSteps, undoCommand, whatChangedCommand } from "@/lib/snapshot";

function machine(list: string, o: { status?: string; failing?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "tux-undo-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const log = join(root, "snapper.log");
  writeFileSync(join(root, "list.csv"), list);
  writeFileSync(join(bin, "sudo"), '#!/bin/bash\nexec "$@"\n');
  writeFileSync(
    join(bin, "snapper"),
    `#!/bin/bash\necho "$*" >> ${log}\ncase "$*" in *" list "*) cat ${root}/list.csv;; *" status "*) printf '%s' "${o.status ?? ""}";; *create*) n=$(( $(cat ${root}/n 2>/dev/null || echo 40) + 1 )); echo $n > ${root}/n; echo $n;; esac\n`,
  );
  // what reads the files again — each one logged; one may fail. Never the real ones (busctl too).
  for (const t of ["systemctl", "firewall-cmd", "sysctl", "udevadm", "busctl"]) {
    writeFileSync(join(bin, t), `#!/bin/bash\necho "${t} $*" >> ${log}\n[ "${o.failing ?? ""}" != "${t}" ] || { echo "${t}: failed (fake)" >&2; exit 1; }\nexit 0\n`);
  }
  for (const f of ["sudo", "snapper", "systemctl", "firewall-cmd", "sysctl", "udevadm", "busctl"]) chmodSync(join(bin, f), 0o755);
  const run = (cmd: string) => {
    try {
      return execFileSync("bash", ["-c", cmd], { encoding: "utf8", stdio: "pipe", env: { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH}` } });
    } catch (e) {
      throw new Error(`stderr: ${String((e as { stderr?: string }).stderr)}`);
    }
  };
  return { root, run, calls: () => (existsSync(log) ? readFileSync(log, "utf8") : "") };
}

// snapper 0.13: number,pre-number,post-number,description
const OURS = "41,,42,TuxCopilot: Firewall: public\n42,41,,TuxCopilot: Firewall: public\n43,,44,pacman -S x\n44,43,,pacman -S x\n";

describe("undo exactly one change Fluff made", () => {
  it("the after-step writes the pair into Fluff's record", () => {
    const m = machine("");
    const s = snapshotSteps("Firewall: public");
    m.run(s.before);
    m.run(s.after);
    const rec = readFileSync(join(m.root, ".local/state/tuxcopilot/snapshots.tsv"), "utf8").split("\t");
    expect(rec[0]).toBe("41");
    expect(rec[1]).toBe("42");
    expect(rec[2]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/);
    expect(rec[3]).toBe("TuxCopilot: Firewall: public\n");
  });

  it("a real TuxCopilot pair: undone, and what it changed shown", () => {
    const m = machine(OURS);
    m.run(undoCommand({ pre: 41, post: 42 }));
    expect(m.calls()).toContain("-c root undochange 41..42");
    m.run(whatChangedCommand({ pre: 41, post: 42 }));
    expect(m.calls()).toContain("-c root status 41..42");
  });

  it("a description in quotes (snapper quotes one with a comma) is still TuxCopilot's", () => {
    const m = machine('41,,42,"TuxCopilot: Apply: 2 changes, one more"\n42,41,,"TuxCopilot: Apply: 2 changes, one more"\n');
    m.run(undoCommand({ pre: 41, post: 42 }));
    expect(m.calls()).toContain("undochange 41..42");
  });

  it("a forged record — pacman's pair, a mismatched pair, or one cleaned up — undoes nothing", () => {
    for (const [pre, post] of [[43, 44], [41, 44], [50, 51]]) {
      const m = machine(OURS);
      expect(() => m.run(undoCommand({ pre, post })), `${pre}..${post}`).toThrow(/^stderr: Fluff: snapshots \d+ and \d+ are not a TuxCopilot pair/);
      expect(m.calls()).not.toContain("undochange");
    }
  });

  it("the after is TuxCopilot's but the before isn't: nothing", () => {
    const m = machine("41,,42,someone else\n42,41,,TuxCopilot: x\n");
    expect(() => m.run(undoCommand({ pre: 41, post: 42 }))).toThrow(/not a TuxCopilot pair/);
  });

  it("asks snapper only for columns snapper 0.13 has", () => {
    const cols = undoCommand({ pre: 41, post: 42 }).match(/--columns ([a-z,-]+)/)![1].split(",");
    const known = ["config", "subvolume", "number", "default", "active", "date", "user", "used-space", "cleanup", "description", "userdata", "pre-number", "post-number", "post-date", "read-only"];
    expect(cols.filter((c) => !known.includes(c))).toEqual([]);
  });

  it("only whole snapshot numbers, the after one later", () => {
    expect(() => undoCommand({ pre: 42, post: 41 })).toThrow();
    expect(() => undoCommand({ pre: 0, post: 1 })).toThrow();
    expect(() => undoCommand({ pre: 1.5, post: 3 })).toThrow();
    expect(undoCommand({ pre: 41, post: 42 })).toMatch(/' fluff-undo 41 42 && \{ busctl --user /); // then your session bus reads its rules again
    expect(undoCommand({ pre: 41, post: 42 }).split("' fluff-undo")[0].slice("sudo sh -c '".length)).not.toContain("'"); // the root part stays in its quotes
  });
});

describe("undo: the files back, then what reads them reads them again", () => {
  const changed = "c..... /etc/firewalld/zones/drop.xml\nc..... /etc/firewalld/firewalld.conf\n+..... /etc/sysctl.d/99-tuxcopilot-hardening.conf\n";

  it("only what had a file of its own changed is told: the firewall and the kernel here, not DNS", () => {
    const m = machine(OURS, { status: changed });
    m.run(undoCommand({ pre: 41, post: 42 }));
    const calls = m.calls();
    expect(calls).toContain("firewall-cmd --reload");
    expect(calls).toContain("sysctl --system");
    expect(calls).not.toContain("restart systemd-resolved");
    expect(calls).not.toContain("udevadm");
    expect(calls).toContain("busctl --user call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus ReloadConfig");
    expect(calls.indexOf("undochange")).toBeLessThan(calls.indexOf("firewall-cmd --reload")); // the files first
  });

  it("one that can't read them again is said, and the undo fails out loud — the files are back either way", () => {
    const m = machine(OURS, { status: changed, failing: "firewall-cmd" });
    expect(() => m.run(undoCommand({ pre: 41, post: 42 }))).toThrow(/^stderr: firewall-cmd: failed \(fake\)\nFluff: the files are back, but these did not read them again: the firewall — they count from the next restart\.\n$/);
    expect(m.calls()).toContain("undochange 41..42");
    expect(() => machine(OURS, { status: changed, failing: "busctl" }).run(undoCommand({ pre: 41, post: 42 }))).toThrow(/Fluff: your session bus didn't read its rules again/);
  });
});

describe("a change that failed: the pair is still kept, and says it didn't finish", () => {
  it("the record says \"(not finished)\", and the after step says so out loud", async () => {
    const { withSnapshot } = await import("@/lib/snapshot");
    const m = machine("");
    const [before, change, after] = withSnapshot(["sudo false"], "Network: Hardened", true).commands;
    m.run(before);
    expect(() => m.run(change)).toThrow();
    const out = m.run(after);
    expect(out).toContain("Fluff: this change did NOT finish — a step failed (said above). Snapshots 41 and 42 hold what it did change, so it can be undone.");
    expect(readFileSync(join(m.root, ".local/state/tuxcopilot/snapshots.tsv"), "utf8").trim().split("\t")[3]).toBe("TuxCopilot: Network: Hardened (not finished)");
    // the next run starts clean
    m.run(before);
    expect(m.run(after)).not.toContain("did NOT finish");
  });

  it("a mark left by a run whose after step never ran doesn't count against the next one", () => {
    const m = machine("");
    mkdirSync(join(m.root, ".local/state/tuxcopilot"), { recursive: true });
    writeFileSync(join(m.root, ".local/state/tuxcopilot/snapper-failed"), "1\n");
    const s = snapshotSteps("x");
    m.run(s.before);
    expect(m.run(s.after)).not.toContain("did NOT finish");
  });

  it("an exit inside the change can't skip the mark", async () => {
    const { withSnapshot } = await import("@/lib/snapshot");
    const m = machine("");
    const [before, change, after] = withSnapshot(["sudo true; exit 3"], "x", true).commands;
    m.run(before);
    expect(() => m.run(change)).toThrow();
    expect(m.run(after)).toContain("did NOT finish");
  });
});
