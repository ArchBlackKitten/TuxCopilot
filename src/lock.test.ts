// The lock's helpers on screen: which seed words are asked back, and what the code box accepts.
import { describe, expect, it } from "vitest";
import { askBack, codeDigits, grouped } from "@/lib/lock";

describe("the lock's helpers", () => {
  it("three different seed words are asked back, in order — all of them for a shorter seed", () => {
    for (let n = 0; n < 50; n++) {
      const a = askBack(9);
      expect(new Set(a).size).toBe(3);
      expect([...a].sort((x, y) => x - y)).toEqual(a);
      expect(a.every((i) => i >= 0 && i < 9)).toBe(true);
    }
    expect(askBack(2)).toEqual([0, 1]);
    expect(askBack(1)).toEqual([0]);
    expect(askBack(2000).length).toBe(3);
    // not always the same three
    expect(new Set(Array.from({ length: 30 }, () => askBack(9).join())).size).toBeGreaterThan(1);
  });

  it("the code box keeps 6 digits, whatever was pasted", () => {
    expect(codeDigits("123 456")).toBe("123456");
    expect(codeDigits(" 12-34 56 78")).toBe("123456");
    expect(codeDigits("abc")).toBe("");
  });

  it("the phone's key is shown in groups of four", () => {
    expect(grouped("ABCDEFGHIJKL")).toBe("ABCD EFGH IJKL");
  });
});
