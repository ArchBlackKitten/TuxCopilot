// A snapshot before TuxCopilot changes the system. snap-pac
// covers pacman; TuxCopilot's own system changes get a snapper pair: a step before and a step
// after, shown in "Are you sure?" like any other, so `snapper undochange <before>..<after>` puts back
// what changed between them (not "exactly" this change — anything else that changed a file then
// too; and a failed before must stop the change). The steps are run
// here for real against a fake snapper.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let ready = true;
let snapshot: Record<string, unknown> = { status: "success", total: 0, output: "", steps: [] };
const started: Array<{ steps: Array<{ label: string; command: string }> }> = [];
const asked: string[][] = [];
vi.mock("@/lib/host", () => ({
  errText: (e: unknown) => String(e),
  inv: async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "tree_get") return [];
    if (cmd === "snapshot_ready") return ready;
    if (cmd === "run_start") started.push(args as (typeof started)[number]);
    if (cmd === "run_snapshot") return snapshot;
    return null;
  },
  execRaw: async () => null,
  execOut: async () => null,
  readText: async () => null,
  readDir: async () => [],
  httpGet: async () => null,
  openExternal: async () => {},
  saveTextFile: async () => null,
}));

const { useArch } = await import("@/components/arch/store");
const { EMPTY_HISTORY } = await import("@/lib/changes");
const { changesNotDone, markFailed, SNAP_AFTER, SNAP_BEFORE, SNAP_GUARD, snapshotSteps, touchesSystem, UNDO_WORDS, withSnapshot } = await import("@/lib/snapshot");

function machine() {
  const root = mkdtempSync(join(tmpdir(), "tux-snap-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const log = join(root, "calls.log");
  writeFileSync(join(bin, "sudo"), `#!/bin/bash\necho "sudo $*" >> ${log}\nexec "$@"\n`);
  // a snapper that numbers its snapshots 41, 42, …
  writeFileSync(join(bin, "snapper"), `#!/bin/bash\nn=$(( $(cat ${root}/n 2>/dev/null || echo 40) + 1 )); echo $n > ${root}/n\nprintf '%s\\n' "$*" >> ${root}/snapper.log\necho $n\n`);
  for (const f of ["sudo", "snapper"]) chmodSync(join(bin, f), 0o755);
  // a failure says only what the command wrote to stderr: never the command's own text (which
  // holds Fluff's messages too, so a match on it would prove nothing)
  const run = (cmd: string) => {
    try {
      return execFileSync("bash", ["-c", cmd], { encoding: "utf8", stdio: "pipe", env: { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH}` } });
    } catch (e) {
      throw new Error(`stderr: ${(e as { stderr?: string }).stderr ?? ""}`);
    }
  };
  return { root, run, snapper: () => readFileSync(join(root, "snapper.log"), "utf8").trim().split("\n"), pre: join(root, ".local/state/tuxcopilot/snapper-pre") };
}

describe("a snapshot before TuxCopilot changes the system", () => {
  it("what changes the system: root, but not pacman (snap-pac takes those) or snapper itself", () => {
    expect(touchesSystem("printf x | sudo tee /etc/x.conf >/dev/null")).toBe(true);
    expect(touchesSystem("sudo systemctl disable --now sshd.service")).toBe(true);
    expect(touchesSystem("sudo -E sh -c 'echo hi'")).toBe(true);
    expect(touchesSystem("sudo pacman -Syu --needed vlc && sudo systemctl enable --now vlc.service")).toBe(true);
    expect(touchesSystem("sudo pacman -Syu --needed vlc")).toBe(false);
    expect(touchesSystem("sudo snapper -c root list")).toBe(false);
    expect(touchesSystem("systemctl --user reset-failed x.service")).toBe(false);
    expect(touchesSystem("visudo -c")).toBe(false);
    expect(touchesSystem("sudo -v")).toBe(false);
  });

  it("before writes down its number, after pairs with it, says honestly what the pair holds, and tidies up", () => {
    const m = machine();
    const s = snapshotSteps("Firewall: public");
    m.run(s.before);
    expect(readFileSync(m.pre, "utf8").trim()).toBe("41");
    const out = m.run(s.after);
    expect(out).toContain("Fluff: snapshots 41 and 42 hold what this run changed in the system's files (and anything else that changed one at the same moment). To see the files: sudo snapper -c root status 41..42. To undo it: History, beside this run, Undo this change — it lists the files first.");
    expect(out).not.toMatch(/exactly/);
    expect(m.snapper()).toEqual([
      "-c root create --type pre --cleanup-algorithm number --print-number --description TuxCopilot: Firewall: public",
      "-c root create --type post --pre-number 41 --cleanup-algorithm number --print-number --description TuxCopilot: Firewall: public",
    ]);
    expect(existsSync(m.pre)).toBe(false);
    expect(readFileSync(join(m.root, "calls.log"), "utf8")).toMatch(/^sudo snapper -c root create --type pre[^\n]*\nsudo snapper -c root create --type post/);
  });

  it("after, without a before, stops and pairs with nothing", () => {
    const m = machine();
    expect(() => m.run(snapshotSteps("x").after)).toThrow();
    expect(existsSync(join(m.root, "snapper.log"))).toBe(false);
  });

  it("a label can't break out of its quotes", () => {
    const m = machine();
    const s = snapshotSteps("evil'; touch /tmp/owned-by-label; echo '\nnext");
    expect(s.before).not.toMatch(/owned-by-label'/);
    m.run(s.before);
    expect(m.snapper()[0]).toBe("-c root create --type pre --cleanup-algorithm number --print-number --description TuxCopilot: evil; touch /tmp/owned-by-label; echo next");
    expect(snapshotSteps("x".repeat(200)).before).toContain(`'TuxCopilot: ${"x".repeat(60)}'`);
  });

  it("only around changes to the system, and only when snapper is ready", () => {
    const sys = ["printf x | sudo tee /etc/x >/dev/null"];
    const w = withSnapshot(sys, "L", true);
    expect(w.commands).toHaveLength(3);
    expect(w.commands[1]).toBe(`${SNAP_GUARD}; ${markFailed(sys[0])}`); // runs only after a snapshot was taken before it, and a failure is marked
    expect(w.labels(["Write x"])).toEqual([SNAP_BEFORE, "Write x", SNAP_AFTER]);
    expect(withSnapshot(sys, "L", false).commands).toEqual(sys);
    expect(withSnapshot(["sudo pacman -Syu --needed vlc"], "L", true).commands).toEqual(["sudo pacman -Syu --needed vlc"]);
  });

  it("a snapshot step that failed isn't a change that failed", () => {
    expect(changesNotDone([0], 1, 2)).toEqual([]); // before failed
    expect(changesNotDone([3], 1, 2)).toEqual([]); // after failed
    expect(changesNotDone([0, 2, 3], 1, 2)).toEqual([1]);
    expect(changesNotDone([1], 0, 2)).toEqual([1]);
  });
});

describe("Apply and quick runs take the pair", () => {
  let unsub = () => {};
  beforeEach(() => {
    unsub();
    unsub = useArch.subscribe((st) => {
      if (st.pendingConfirm) {
        asked.push([...((st.pendingConfirm as { commands?: string[] }).commands ?? [])]);
        queueMicrotask(() => st.pendingConfirm?.answer(true));
      }
    });
    started.length = 0;
    asked.length = 0;
    ready = true;
    useArch.setState({ history: EMPTY_HISTORY, savedConfirmCount: 1, dryRun: false, pendingConfirm: null });
  });

  it("Apply: before, the changes, after — the pair shown in Are you sure; a failed change stays, a failed snapshot step doesn't count", async () => {
    snapshot = { status: "failed", total: 0, output: "", steps: [], okSteps: [0, 1, 3], failedSteps: [2] };
    useArch.getState().stageSystem("Write a", "printf a | sudo tee /etc/a >/dev/null");
    useArch.getState().stageSystem("Write b", "printf b | sudo tee /etc/b >/dev/null");
    const r = await useArch.getState().apply();
    const steps = started[0].steps;
    expect(steps.map((s) => s.label)).toEqual([SNAP_BEFORE, "Write a", "Write b", SNAP_AFTER]);
    expect(steps[0].command).toContain("--type pre");
    expect(steps[3].command).toContain("--type post");
    expect(asked[0]).toHaveLength(4); // shown before it runs
    expect(useArch.getState().history.pending.map((c) => c.label)).toEqual(["Write b"]);
    expect(r.applied).toBe(1);
  });

  it("Apply: the snapshot before failed, both changes ended well — nothing stays", async () => {
    snapshot = { status: "failed", total: 0, output: "", steps: [], okSteps: [1, 2, 3], failedSteps: [0] };
    useArch.getState().stageSystem("Write a", "printf a | sudo tee /etc/a >/dev/null");
    useArch.getState().stageSystem("Write b", "printf b | sudo tee /etc/b >/dev/null");
    const r = await useArch.getState().apply();
    expect(useArch.getState().history.pending).toEqual([]);
    expect(r.applied).toBe(2);
  });

  it("Apply without snapper, or with pacman only: no pair", async () => {
    snapshot = { status: "success", total: 0, output: "", steps: [], okSteps: [0], failedSteps: [] };
    ready = false;
    useArch.getState().stageSystem("Write a", "printf a | sudo tee /etc/a >/dev/null");
    await useArch.getState().apply();
    expect(started[0].steps.map((s) => s.label)).toEqual(["Write a"]);
    ready = true;
    useArch.getState().stageSystem("Mark vlc", "sudo pacman -D --asexplicit vlc");
    await useArch.getState().apply();
    expect(started[1].steps.map((s) => s.label)).toEqual(["Mark vlc"]);
  });

  it("a quick run that changes the system: the pair around it; one that doesn't: as before", async () => {
    snapshot = { status: "success", total: 0, output: "", steps: [], okSteps: [0, 1, 2], failedSteps: [] };
    await useArch.getState().runQuick("Shut KWin's door", "printf x | sudo tee /etc/dbus-1/session.d/x.conf >/dev/null", false);
    expect(started[0].steps.map((s) => s.label)).toEqual([SNAP_BEFORE, "Shut KWin's door", SNAP_AFTER]);
    await useArch.getState().runQuick("Clear the mark", "systemctl --user reset-failed x.service", false);
    expect(started[1].steps.map((s) => s.label)).toEqual(["Clear the mark"]);
  });
});

describe("a failed snapshot before stops the change", () => {
  const brokenSnapper = (m: ReturnType<typeof machine>) => {
    writeFileSync(join(m.root, "bin", "snapper"), "#!/bin/bash\necho 'snapper: config root not found' >&2\nexit 1\n");
    chmodSync(join(m.root, "bin", "snapper"), 0o755);
  };
  const steps = (label: string, change: string) => withSnapshot([change], label, true).commands;

  it("snapper fails before: the change doesn't run, says why, and after pairs with nothing", () => {
    const m = machine();
    brokenSnapper(m);
    const marker = join(m.root, "changed");
    const [before, change, after] = steps("Bluetooth: off", `sudo touch ${marker}`);
    expect(() => m.run(before)).toThrow();
    expect(() => m.run(change)).toThrow(/^stderr: Fluff: the snapshot before this change wasn't taken, so nothing was changed\./);
    expect(existsSync(marker)).toBe(false);
    expect(() => m.run(after)).toThrow(/^stderr: Fluff: no snapshot before was written down/);
    expect(existsSync(join(m.root, ".local/state/tuxcopilot/snapshots.tsv"))).toBe(false);
  });

  it("snapper works: the change runs; a change that failed half way is still paired, so it can be undone", () => {
    const m = machine();
    const marker = join(m.root, "changed");
    const [before, change, after] = steps("x", `sudo touch ${marker} && false`);
    m.run(before);
    expect(() => m.run(change)).toThrow();
    expect(existsSync(marker)).toBe(true); // half done
    expect(m.run(after)).toContain("snapshots 41 and 42 hold what this run changed");
  });

  it("a number that isn't one is never handed to snapper", () => {
    const m = machine();
    mkdirSync(join(m.root, ".local/state/tuxcopilot"), { recursive: true });
    writeFileSync(m.pre, "41; reboot\n");
    expect(() => m.run(snapshotSteps("x").after)).toThrow(/^stderr: Fluff: no snapshot before was written down/);
    expect(() => m.run(`${SNAP_GUARD}; echo changed`)).toThrow(/^stderr: Fluff: the snapshot before this change wasn't taken/);
    expect(existsSync(join(m.root, "snapper.log"))).toBe(false);
  });

  it("only the steps that change the system wait for the snapshot; a way back never does", () => {
    const w = withSnapshot(["printf x | sudo tee /etc/x >/dev/null", "systemctl --user daemon-reload"], "L", true);
    expect(w.commands[1].startsWith(SNAP_GUARD)).toBe(true);
    expect(w.commands[2]).toBe("systemctl --user daemon-reload");
    const back = withSnapshot(["sudo rm -f /etc/x"], "L", true, true);
    expect(back.commands).toHaveLength(3); // still a pair, when snapper can take one
    expect(back.commands[1]).toBe(markFailed("sudo rm -f /etc/x")); // no guard: it runs; a failure still marked
  });

  it("Undo says what it can't do: other changes in the same moment, and services' running state", () => {
    expect(UNDO_WORDS).toMatch(/anything else that changed a file at that same moment, so Fluff lists the files first/);
    expect(UNDO_WORDS).toMatch(/a service it stopped stays stopped/);
  });

  it("the hands check's way back runs without waiting for a snapshot (you may have no keyboard)", async () => {
    ready = true;
    started.length = 0;
    useArch.setState({ dryRun: false, handsCheck: null, pendingConfirm: null });
    const p = useArch.getState().checkHands({ title: "t", what: "w", undoLabel: "Back", undo: "sudo rm -f /etc/x" });
    useArch.getState().handsCheck!.done(false);
    await p;
    const cmds = started.at(-1)!.steps.map((s) => s.command);
    expect(cmds).toHaveLength(3);
    expect(cmds[1]).toBe(markFailed("sudo rm -f /etc/x"));
    // an ordinary quick run of the same command waits for it
    started.length = 0;
    useArch.setState({ savedConfirmCount: 0 });
    await useArch.getState().runQuick("Remove x", "sudo rm -f /etc/x", false);
    expect(started.at(-1)!.steps[1].command).toBe(`${SNAP_GUARD}; ${markFailed("sudo rm -f /etc/x")}`);
  });
});
