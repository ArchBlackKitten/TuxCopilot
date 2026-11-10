// The command catalogue: every command explained, found by plain words, and sudo's own
// options told apart from the command it runs.
import { describe, expect, it } from "vitest";
import { explainCommand } from "@/lib/arch-explain";
import { searchCommands } from "@/lib/command-search";
import { CATALOG, commandDoc, needs, usedWith } from "@/lib/commands/catalog";

describe("the command catalogue", () => {
  it("every entry is whole, and every link points at a command in it", () => {
    const names = new Set(CATALOG.map((c) => c.name));
    expect(names.size).toBe(CATALOG.length);
    for (const c of CATALOG) {
      expect(c.what.length, c.name).toBeGreaterThan(10);
      expect(c.examples.length, c.name).toBeGreaterThan(0);
      for (const l of [...c.oftenWith, ...c.neededBy]) expect(names.has(l), `${c.name} → ${l}`).toBe(true);
    }
  });

  it("mkdir is explained, option by option", () => {
    const r = explainCommand("mkdir -pv ~/Projects/site");
    expect(r.segments[0].tokens[0].meaning).toMatch(/new folder/);
    expect(r.segments[0].tokens[1].meaning).toMatch(/parents.*verbose/);
  });

  it("“directory” finds mkdir; plain words find the everyday commands", () => {
    expect(searchCommands("make a new directory")[0].command).toMatch(/^mkdir/);
    expect(searchCommands("create folder").some((m) => m.command.startsWith("mkdir"))).toBe(true);
    expect(searchCommands("how full is my disk").some((m) => m.command.startsWith("df"))).toBe(true);
    expect(searchCommands("which program listens on a port").some((m) => m.command.startsWith("ss"))).toBe(true);
    expect(searchCommands("extract a tar archive").some((m) => m.command.startsWith("tar"))).toBe(true);
  });

  it("sudo's own options belong to sudo, and one it doesn't have is said so", () => {
    const bad = explainCommand("sudo --ignore");
    expect(bad.segments[0].tokens[1].ok).toBe(false);
    expect(bad.segments[0].tokens[1].meaning).toMatch(/sudo has no --ignore option/);
    expect(bad.segments[0].binary).toBeNull();
    const good = explainCommand("sudo -u alice ls -la");
    expect(good.segments[0].binary).toBe("ls");
    expect(good.segments[0].tokens[1].meaning).toMatch(/^sudo: as another user/);
    expect(good.segments[0].tokens[2].meaning).toMatch(/value for sudo's -u/);
    expect(explainCommand("sudo -k").segments[0].tokens[1].ok).toBe(true);
  });

  it("what a command goes with, and what needs it — both ways", () => {
    expect(usedWith("mkdir")).toEqual(expect.arrayContaining(["cd", "chmod"]));
    expect(needs("makepkg")).toEqual({ neededBy: ["yay"], needs: expect.arrayContaining(["pacman", "git", "tar", "curl"]) });
    expect(commandDoc("chmod")!.what).toMatch(/700 = only you/);
  });
});

describe("search finds", () => {
  it("“clone” finds git clone — and never the kill commands (clone is not close)", () => {
    const r = searchCommands("clone").map((m) => m.command);
    expect(r.slice(0, 2).some((c) => c.startsWith("git clone"))).toBe(true);
    expect(r.some((c) => /kill/.test(c))).toBe(false);
  });

  it("a typo still finds its word when no command uses the typo as it is", () => {
    expect(searchCommands("uninstal package").some((m) => /-R/.test(m.command))).toBe(true);
  });

  it("fast enough to search as you type", () => {
    searchCommands("warm up");
    const t = performance.now();
    for (const q of ["make a new directory", "clone", "update everything", "which program listens on a port"]) searchCommands(q);
    expect((performance.now() - t) / 4).toBeLessThan(30);
  });
});
