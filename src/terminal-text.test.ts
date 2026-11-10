import { describe, expect, it } from "vitest";
import { screen } from "@/lib/terminal-text";

describe("what the terminal shows", () => {
  it("a redrawn line shows its latest state; other lines are untouched", () => {
    expect(screen("start\n extra  10%\r extra  55%\r extra 100%\ndone\n")).toBe("start\n extra 100%\ndone\n");
    expect(screen("half\r")).toBe("half");
    expect(screen("plain\ntext")).toBe("plain\ntext");
  });
});
