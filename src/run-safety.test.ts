// The review (3.1, 3.3): a run is never stopped by a limit while a package manager works, and
// Stop asks first then. The screen's list and the runner's are one list.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { PACKAGE_WORK, packageWork } from "@/lib/run-safety";

describe("stopping a run safely", () => {
  it("Stop names the package manager at work, or nothing", () => {
    expect(packageWork(["bash", "sudo", "pacman"])).toBe("pacman");
    expect(packageWork(["bash", "yay"])).toBe("yay");
    expect(packageWork(["bash", "sleep"])).toBeNull();
    expect(packageWork(undefined)).toBeNull();
    expect(packageWork(["pacmanx"])).toBeNull();
  });

  it("the screen and the runner use the same list", () => {
    const rs = readFileSync("src-tauri/src/runner.rs", "utf8");
    const list = rs.match(/const PACKAGE_WORK: &\[&str\] = &\[([^\]]+)\]/)![1].match(/"([^"]+)"/g)!.map((x) => x.slice(1, -1));
    expect(list).toEqual(PACKAGE_WORK);
  });

  it("no fixed time limit is left in the runner, only a limit on silence", () => {
    const rs = readFileSync("src-tauri/src/runner.rs", "utf8");
    expect(rs).not.toMatch(/STEP_TIMEOUT/);
    expect(rs).toMatch(/quiet > SILENCE_LIMIT && !busy_with_packages\(\)/);
  });
});

describe("the release package can run every test", () => {
  it("no test asks git: a release tarball is not a git folder (makepkg's check())", () => {
    const tests = readdirSync("src").filter((f) => /\.test\.tsx?$/.test(f) && f !== "run-safety.test.ts"); // not this check itself
    const asking = tests.filter((f) => /execFileSync\(\s*["']git["']|execSync\(\s*["'`]git |git ls-files/.test(readFileSync(`src/${f}`, "utf8").replace(/\/\/.*$/gm, "")));
    expect(asking).toEqual([]);
  });
});
