// The lock's rules (password code ≥ 8): the screen says the
// same as the lock — at least 8 characters; honest about what opens the files; and how much a
// shorter seed gives away, asking to be sure below 6 words.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MIN_PASSWORD, passwordLongEnough, seedWarning } from "@/lib/lock";

describe("the lock's rules on screen", () => {
  it("at least 8 characters, counted as characters", () => {
    expect(MIN_PASSWORD).toBe(8);
    expect(passwordLongEnough("1234567")).toBe(false);
    expect(passwordLongEnough("12345678")).toBe(true);
    expect(passwordLongEnough("ñandú12")).toBe(false); // 7 characters, more bytes
    expect(passwordLongEnough("ñandú123")).toBe(true);
    expect(passwordLongEnough("🐧🐧🐧🐧123")).toBe(false); // 7 characters (Rust counts the same), 11 UTF-16 units
  });

  it("the screen's 8 is the lock's 8", () => {
    expect(readFileSync("src-tauri/src/lock.rs", "utf8")).toContain(`pub const MIN_PASSWORD: usize = ${MIN_PASSWORD};`);
  });

  it("a shorter seed says what it gives away; below 6 it is called easy to guess", () => {
    expect(seedWarning(9).level).toBe("ok");
    expect(seedWarning(12)).toEqual({ level: "ok", text: "12 words: even harder to guess than the standard 9." });
    expect(seedWarning(6).level).toBe("weaker");
    expect(seedWarning(8).text).toMatch(/weaker than 9/);
    expect(seedWarning(5).level).toBe("weak");
    expect(seedWarning(1).text).toMatch(/2,048 words/);
    expect(seedWarning(0).level).toBe("weak");
    expect(seedWarning(Number.NaN).level).toBe("weak");
  });

  it("the words are honest: TuxCopilot asks for both, the files open with the password code", () => {
    const gate = readFileSync("src/components/arch/lock-gate.tsx", "utf8");
    const settings = readFileSync("src/components/arch/lock-settings.tsx", "utf8");
    expect(gate).not.toMatch(/opens only with\s+two things together/);
    expect(gate).toMatch(/files themselves open with the password code alone/);
    expect(settings).toMatch(/the files themselves open with the password code \(or the seed\)/);
  });
});

describe("the lock says what it can't seal", () => {
  it("data from before the lock, in the disk's free space, is said at setup", async () => {
    const { BEFORE_THE_LOCK } = await import("@/lib/lock");
    expect(BEFORE_THE_LOCK).toMatch(/before it had this lock/);
    expect(BEFORE_THE_LOCK).toMatch(/free space until it is written over/);
    expect(BEFORE_THE_LOCK).toMatch(/LUKS/);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/components/arch/lock-gate.tsx", "utf8")).toContain("{BEFORE_THE_LOCK}");
  });
});
