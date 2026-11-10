// The rule: a command mentioned anywhere is clickable, and can be searched.
import { describe, expect, it } from "vitest";
import { lineLinks, textLinks } from "@/lib/command-links";
import { searchCommands } from "@/lib/command-search";
import { CATALOG } from "@/lib/commands/catalog";
import { KNOWN_BINARIES } from "@/lib/arch-kb";

const links = (ps: { command?: string }[]) => ps.filter((p) => p.command).map((p) => p.command);

describe("every command mentioned is a link", () => {
  it("in a command line: each command, after pipes, &&, sudo and xargs", () => {
    expect(links(lineLinks("sudo pacman -Syyu"))).toEqual(["sudo", "pacman"]);
    expect(links(lineLinks("find . -name '*.tmp' | xargs rm"))).toEqual(["find", "xargs", "rm"]);
    expect(links(lineLinks("sudo -E pacman -Qo file && ls -la"))).toEqual(["sudo", "pacman", "ls"]);
    expect(links(lineLinks("mkdir -p ~/Projects", "mkdir"))).toEqual([]); // not a link to the page it is on
    expect(lineLinks("mkdir [options] <folder>…", "mkdir")).toEqual([{ text: "mkdir [options] <folder>…", code: true }]);
  });

  it("in a sentence: names, but everyday words only when written as code", () => {
    expect(links(textLinks("pacman · -Syyu — force refresh + full upgrade"))).toEqual(["pacman"]);
    expect(links(textLinks("clean the cache to free space, then find the file"))).toEqual([]);
    expect(links(textLinks("check with `free -h` and `find / -name x`"))).toEqual(["free", "find"]);
    expect(links(textLinks("Never run yay (or any AUR helper) with sudo — makepkg refuses"))).toEqual(["yay", "sudo", "makepkg"]);
    expect(links(textLinks("a pacmanx and xpacman are not pacman"))).toEqual(["pacman"]);
  });
});

describe("every command can be searched", () => {
  it("each catalogue command, by its name", () => {
    const missing = CATALOG.filter((c) => !searchCommands(c.name).some((m) => m.command === c.name || m.command.startsWith(`${c.name} `))).map((c) => c.name);
    expect(missing).toEqual([]);
  });

  it("each flag and subcommand Fluff knows, as typed", () => {
    const missing: string[] = [];
    for (const t of KNOWN_BINARIES)
      for (const it of t.items) {
        if (!it.token.startsWith("-") && it.kind !== "sub") continue;
        const full = t.binary === "system" ? it.token : `${t.binary} ${it.token}`;
        if (!searchCommands(it.token, {}, 12).some((m) => m.command === full)) missing.push(full);
      }
    expect(missing).toEqual([]);
  }, 60_000); // about two hundred searches in a row

  it("a flag typed bare, case counting, and a command with its flags", () => {
    expect(searchCommands("-Syyu")[0].command).toBe("pacman -Syyu");
    expect(searchCommands("Syyu")[0].command).toBe("pacman -Syyu");
    expect(searchCommands("--needed").map((m) => m.command)).toContain("pacman --needed");
    expect(searchCommands("-S").map((m) => m.command)).toContain("pacman -S");
    expect(searchCommands("-S").map((m) => m.command)).not.toContain("pacman -s");
    expect(searchCommands("pacman -Syyu").map((m) => m.command).slice(0, 2)).toEqual(["pacman", "pacman -Syyu"]);
    expect(searchCommands("which")[0].command).toBe("which");
    expect(searchCommands("which package owns this file")[0].command).toBe("pacman -Qo <file>"); // a sentence names no command
  });
});
