// Words → command: everyday descriptions, in different words, must land on the right command.
import { describe, expect, it } from "vitest";
import { searchCommands } from "@/lib/command-search";

const top = (q: string) => searchCommands(q)[0]?.command ?? "(nothing)";

describe("describe it, get the command", () => {
  it.each([
    ["remove packages nothing needs anymore", "sudo pacman -Rns $(pacman -Qtdq)"],
    ["get rid of unused leftover packages", "sudo pacman -Rns $(pacman -Qtdq)"],
    ["upgrade my whole system", "sudo pacman -Syu"],
    ["which package owns this file", "pacman -Qo <file>"],
    ["keep a package so it is not removed as orphan, mark it installed on purpose", "sudo pacman -D --asexplicit <package>"],
    ["show services that failed", "systemctl --failed"],
    ["clean the package cache to free space", "sudo paccache -rk2"],
    ["rebuild the initramfs", "sudo mkinitcpio -P"],
  ])("%j → %s", (q, want) => expect(top(q)).toBe(want));

  it("'update everything' offers both full updates first (yay's also covers the AUR)", () => {
    expect(searchCommands("update everything").slice(0, 2).map((m) => m.command).sort()).toEqual(["sudo pacman -Syu", "yay -Syu"]);
  });

  it("tolerates a typo", () => {
    expect(top("uninstal orphans")).toBe("sudo pacman -Rns $(pacman -Qtdq)");
  });

  it("says nothing rather than guess wildly", () => {
    expect(searchCommands("bake a chocolate cake")).toEqual([]);
    expect(searchCommands("the and of")).toEqual([]);
  });

  it("uses what this machine taught it", () => {
    const learned = { pacman: [{ token: "--dbonly", kind: "flag" as const, meaning: "only modify database entries, not package files" }] };
    expect(searchCommands("modify database entries only", learned).map((m) => m.command)).toContain("pacman --dbonly");
  });
});
