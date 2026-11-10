// What would wreck the system is never run by Fluff — a window says what
// it does and why not, and you may copy it to run yourself. The runner refuses (wreck.rs); the
// screen opens the window.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const started: string[] = [];
vi.mock("@/lib/host", () => ({
  errText: (e: unknown) => String(e),
  inv: async (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "run_start") {
      const steps = args.steps as Array<{ command: string }>;
      if (steps.some((s) => s.command.includes("rm -rf ~")))
        throw 'FLUFF_WONT_RUN:{"part":"sudo rm -rf ~","what":"deletes your whole home folder and everything in it, without asking","why":"it can\'t be undone"}';
      started.push(steps.map((s) => s.command).join(" | "));
    }
    if (cmd === "tree_get") return [];
    if (cmd === "run_snapshot") return { status: "idle", total: 0, output: "", steps: [] };
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
const { WRECK_PREFIX } = await import("@/lib/api");

describe("Fluff won't run this one", () => {
  it("a refused run opens the window with what, why and the whole command to copy — and nothing starts", async () => {
    useArch.setState({ savedConfirmCount: 0, dryRun: false, wreck: null });
    const err = await useArch.getState().runQuick("Clean up", "echo bye && sudo rm -rf ~", false);
    expect(started).toEqual([]);
    const w = useArch.getState().wreck!;
    expect(w.command).toBe("echo bye && sudo rm -rf ~");
    expect(w.part).toBe("sudo rm -rf ~");
    expect(w.what).toMatch(/whole home folder/);
    expect(err).toMatch(/won't run this one/);
    useArch.getState().closeWreck();
    expect(useArch.getState().wreck).toBeNull();
  });

  it("an ordinary run starts as before", async () => {
    await useArch.getState().runQuick("Hello", "echo hi", false);
    expect(started).toEqual(["echo hi"]);
    expect(useArch.getState().wreck).toBeNull();
  });

  it("the screen and the runner speak the same word for it, and the runner checks before every real run", () => {
    const rs = readFileSync("src-tauri/src/runner.rs", "utf8");
    expect(rs).toContain(`pub const WRECK_PREFIX: &str = "${WRECK_PREFIX}";`);
    expect(rs).toMatch(/if !dry_run \{\s*if let Some\(w\) = steps\.iter\(\)\.find_map\(\|s\| crate::wreck::wrecks\(&s\.command\)\)/);
    expect(readFileSync("src/App.tsx", "utf8")).toContain("<WreckDialog />");
  });
});
