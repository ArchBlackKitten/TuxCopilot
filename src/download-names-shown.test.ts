// The review (5.3): what Play skipped is said in "Are you sure?", above the commands, and a Play
// where everything was skipped says why instead of "nothing to run".
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/host", () => ({
  errText: (e: unknown) => String(e),
  inv: async (cmd: string) => (cmd === "run_snapshot" ? { status: "success", total: 0, output: "", steps: [] } : null),
  execRaw: async () => null,
  execOut: async () => null,
  readText: async () => null,
  readDir: async () => [],
  httpGet: async () => null,
  openExternal: async () => {},
  saveTextFile: async () => null,
}));

const { useArch } = await import("@/components/arch/store");
const node = (name: string, content: string) => ({ id: name, name, category: "download" as const, source: "pacman" as const, content, enabled: true, order: 0, parentId: null, children: [] });

describe("what Play skipped is said", () => {
  it("in Are you sure, above the commands", async () => {
    const seen: string[][] = [];
    const unsub = useArch.subscribe((st) => st.pendingConfirm && (seen.push(st.pendingConfirm.notes ?? []), st.pendingConfirm.answer(false)));
    useArch.setState({ tree: [node("Media", "vlc mpv;rm")], dryRun: false, savedConfirmCount: 1, pendingConfirm: null });
    await useArch.getState().startPlay("all");
    unsub();
    expect(seen[0]).toEqual(['Download item "Media": "mpv;rm" isn\'t a package name, so Fluff skipped it (the rest runs).']);
  });

  it("everything skipped: the reason, not 'nothing to run'", async () => {
    useArch.setState({ tree: [node("Bad", "x;y")], dryRun: false, savedConfirmCount: 1, pendingConfirm: null });
    expect(await useArch.getState().startPlay("all")).toMatch(/Fluff found nothing it could run here\. Download item "Bad": "x;y" isn't a package name/);
  });
});
