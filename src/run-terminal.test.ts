// Settings → Where commands run, and the folders added to the git search: a pending choice shows at once and waits for Apply; Undo
// takes it back.
import { describe, expect, it } from "vitest";
import { EMPTY_HISTORY, previewGitDirs, previewRunTerminal, stage, undo } from "@/lib/changes";

describe("where commands run", () => {
  it("the latest pending choice wins, undo goes back to the saved one", () => {
    let h = stage(EMPTY_HISTORY, { kind: "run.terminal", label: "Run commands in kitty", value: "kitty" });
    expect(previewRunTerminal("", h.pending)).toBe("kitty");
    h = stage(h, { kind: "run.terminal", label: "Run commands in WezTerm", value: "wezterm" });
    expect(previewRunTerminal("", h.pending)).toBe("wezterm");
    h = undo(undo(h));
    expect(previewRunTerminal("kitty", h.pending)).toBe("kitty");
  });
});


describe("folders added to the git search", () => {
  it("adding and removing wait for Apply; undo takes them back", () => {
    let h = stage(EMPTY_HISTORY, { kind: "git.dirs", label: "Search ~/tools", value: ["/home/x/tools"] });
    expect(previewGitDirs([], h.pending)).toEqual(["/home/x/tools"]);
    h = undo(h);
    expect(previewGitDirs([], h.pending)).toEqual([]);
  });
});
