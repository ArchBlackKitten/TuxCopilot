// Git clones: used or unused, and removal refused whenever it would lose work — shaped like
// sample repos.
import { describe, expect, it } from "vitest";
import { cannotRemove, removeCommand, usage, webUrl, wouldLose, type Repo } from "@/lib/gitrepos";

const now = 1_800_000_000;
const repo = (over: Partial<Repo>): Repo => ({
  path: "/home/x/some-tool", name: "some-tool", size: 1_609 << 20, remote: "https://github.com/example/some-tool",
  lastCommit: now - 90 * 86400, lastTouched: now - 18 * 86400, running: [], uncommitted: 0, unpushed: 0, yours: false, holdsHome: false, ...over,
});

describe("git clones", () => {
  it("used: something runs from it, or touched within 30 days", () => {
    expect(usage(repo({}), now)).toEqual({ used: true, text: "used 18 days ago" });
    expect(usage(repo({ lastTouched: now - 110 * 86400 }), now)).toEqual({ used: false, text: "unused for 110 days" });
    expect(usage(repo({ lastTouched: now - 400 * 86400, running: [12, 13] }), now).text).toBe("in use now (2 processes)");
  });

  it("removal is refused when it would lose work, and for your own projects", () => {
    expect(wouldLose(repo({ uncommitted: 1 }))).toMatch(/1 changed file were never committed/);
    expect(wouldLose(repo({ unpushed: 3 }))).toMatch(/3 commits exist only here/);
    expect(wouldLose(repo({ yours: true }))).toMatch(/your own project/);
    expect(wouldLose(repo({ running: [5] }))).toMatch(/running/);
    expect(wouldLose(repo({ uncommitted: null }))).toMatch(/did not answer/);
    expect(() => removeCommand(repo({ uncommitted: 2 }))).toThrow();
    // the button is there anyway: removing what would be lost is your choice…
    expect(removeCommand(repo({ uncommitted: 2 }), true)).toBe("rm -rf '/home/x/some-tool'");
    // …but never their own project, and never while something runs from it
    expect(() => removeCommand(repo({ yours: true }), true)).toThrow();
    expect(() => removeCommand(repo({ running: [7] }), true)).toThrow();
    expect(removeCommand(repo({}))).toBe("rm -rf '/home/x/some-tool'");
    expect(() => removeCommand(repo({ path: "relative/x" }))).toThrow();
  });

  it("links to where it came from", () => {
    expect(webUrl("https://github.com/example/some-tool.git")).toBe("https://github.com/example/some-tool");
    expect(webUrl("git@github.com:example/other-tool.git")).toBe("https://github.com/example/other-tool");
    expect(webUrl(null)).toBeNull();
  });
});

describe("never your home", () => {
  const base = { name: "x", size: 1, remote: null, lastCommit: null, lastTouched: 0, running: [], uncommitted: 0, unpushed: 0, yours: false, holdsHome: false };
  it("your home folder, or one that holds it, is never removed — whatever else is said about it", () => {
    for (const r of [
      { ...base, path: "/home/penguin", holdsHome: true },
      { ...base, path: "/home", holdsHome: true },
      { ...base, path: "/", holdsHome: false }, // even if the reader didn't say so
      { ...base, path: "/srv", holdsHome: false },
    ]) {
      expect(cannotRemove(r), r.path).toMatch(/your home folder/);
      expect(() => removeCommand(r, true), r.path).toThrow(/your home folder/);
    }
    expect(removeCommand({ ...base, path: "/home/penguin/clones/x" }, true)).toBe("rm -rf '/home/penguin/clones/x'");
  });
});
