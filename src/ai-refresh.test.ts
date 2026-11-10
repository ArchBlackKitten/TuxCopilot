// "Ask AI to refresh": the answer is read even when a chat wraps it, only additions are offered,
// what is wrong is said and left out, and what you add joins the catalogue (and its search)
// without replacing anything.
import { describe, expect, it } from "vitest";
import { buildPrompt, isPrompt, PART_LIMIT, promptParts, proposals, readAnswer, readAnswers } from "@/lib/ai-refresh";
import { CATALOG, commandDoc, joinAdditions, mergeAdditions, NO_ADDITIONS } from "@/lib/commands/catalog";
import { searchCommands } from "@/lib/command-search";

const fstrim = {
  name: "fstrim", pkg: "util-linux", group: "System", what: "Tells an SSD which blocks are free, so it stays fast.",
  usage: "sudo fstrim [-v] <mountpoint>", words: ["ssd", "trim"], examples: [{ command: "sudo fstrim -v /", meaning: "trim the root filesystem" }],
  options: [{ token: "-v", meaning: "say how much was trimmed" }], oftenWith: ["lsblk"], neededBy: [],
};

describe("ask AI to refresh", () => {
  it("the prompt says what the catalogue has, the -Syu rule, and that it moves house", () => {
    const p = JSON.parse(buildPrompt({ os: "CachyOS", desktop: "Hyprland", sessionType: "wayland", installedDesktops: ["Hyprland", "Plasma (Wayland)"] }));
    expect(p.the_computer).toBe("OS: CachyOS; desktop in use: Hyprland (wayland); also installed: Plasma (Wayland)");
    expect(p.rules.join(" ")).toContain("right for this computer's OS (CachyOS)");
    expect(p.rules.join(" ")).toContain("The desktop matters as much (Hyprland, wayland)");
    expect(JSON.parse(buildPrompt(null)).the_computer).toMatch(/plain Arch Linux/);
    expect(p.catalogue).toHaveLength(CATALOG.length);
    expect(p.rules.join(" ")).toContain("sudo pacman -Syu --needed");
    expect(p.rules.join(" ")).toContain("Relocate Fluff");
  });

  it("reads the answer bare, in ``` fences, or with a line around it", () => {
    const j = JSON.stringify({ new_commands: [fstrim] });
    for (const t of [j, "```json\n" + j + "\n```", "Here you go:\n" + j + "\nHope it helps!"]) expect(readAnswer(t).new_commands).toHaveLength(1);
    expect(() => readAnswer("[1,2]")).toThrow();
    expect(() => readAnswer('{"new_commands": 3}')).toThrow(/should be a list/);
  });

  it("offers only what the catalogue lacks, and says what it left out", () => {
    const mkdir = commandDoc("mkdir")!;
    const { items, refused } = proposals({
      refreshed_commands: [
        { name: "mkdir", add_options: [{ token: "-p", meaning: "again" }, { token: "--context", meaning: "SELinux context" }], add_words: [mkdir.words[0], "folders2"], add_caution: mkdir.caution ? "x" : undefined },
        { name: "no-such-command", add_words: ["x"] },
      ],
      new_commands: [fstrim, { ...fstrim, name: "mkdir" }, { ...fstrim, name: "ghost", oftenWith: ["nobody"] }, { name: "bad name!" }],
    });
    expect(items.map((i) => i.label)).toEqual(["new command: fstrim", "mkdir: option --context", 'mkdir: search word "folders2"']);
    expect(refused.join("\n")).toMatch(/no-such-command: not in the catalogue/);
    expect(refused.join("\n")).toMatch(/mkdir: already in the catalogue/);
    expect(refused.join("\n")).toMatch(/ghost: names commands nobody knows \(nobody\)/);
    expect(refused.join("\n")).toMatch(/bad name!: a field is missing/);
  });

  it("what you add joins the catalogue and the search, twice is once, and nothing is replaced", () => {
    const before = commandDoc("mkdir")!.options.map((o) => o.token);
    const a = joinAdditions(joinAdditions(NO_ADDITIONS, { refreshed: {}, added: [fstrim] }), {
      refreshed: { mkdir: { options: [{ token: "-p", meaning: "REPLACED?" }, { token: "--context", meaning: "SELinux context" }], words: ["solidstate"] } },
      added: [],
    });
    expect(searchCommands("trim my ssd")[0]?.command).not.toBe("fstrim");
    mergeAdditions(a);
    mergeAdditions(a);
    expect(CATALOG.filter((c) => c.name === "fstrim")).toHaveLength(1);
    const mkdir = commandDoc("mkdir")!;
    expect(mkdir.options.map((o) => o.token)).toEqual([...before, "--context"]);
    expect(mkdir.options.find((o) => o.token === "-p")!.meaning).not.toBe("REPLACED?");
    expect(searchCommands("trim my ssd").map((m) => m.command)).toContain("fstrim");
  });

  it("the prompt goes in parts of at most 1,000 characters, cut only between whole commands", () => {
    const heavy = { os: "CachyOS", desktop: "Hyprland", sessionType: "wayland", installedDesktops: ["Hyprland", "Plasma (Wayland)", "GNOME", "Sway", "Niri"] };
    for (const withNames of [false, true]) {
      const parts = promptParts(heavy, { withNames });
      const n = parts.length;
      expect(n).toBeGreaterThan(3);
      parts.forEach((p, i) => {
        expect(p.text.length, p.title).toBeLessThanOrEqual(PART_LIMIT);
        expect(p.text.startsWith(`Part ${i + 1} of ${n}. `)).toBe(true);
      });
      expect(parts[0].answer).toBe("ready");
      expect(parts[0].text).toContain("OS: CachyOS; desktop in use: Hyprland (wayland)");
      expect(parts[0].text).toContain("Hyprland is not Plasma");
      expect(parts[0].text).toContain("sudo pacman -Syu --needed");
      // every command is in exactly one part, on a whole line
      const lines = parts.slice(1, -1).flatMap((p) => p.text.split("\n").filter((l) => l.startsWith("- ")));
      expect(lines.map((l) => l.slice(2, l.indexOf(": has ")))).toEqual(CATALOG.map((c) => c.name));
      expect(parts[n - 1].text).toContain('"new_commands"');
      expect(parts[n - 1].answer).toBe("json");
      // asked one part at a time, Ollama and an API get the names, whole, just before the last question
      const named = parts.filter((p) => p.text.includes("The commands in the list: "));
      expect(named.length > 0).toBe(withNames);
      expect(named.every((p) => p.answer === "ready")).toBe(true);
      const names = named.flatMap((p) => p.text.slice(p.text.indexOf("list: ") + 6, p.text.lastIndexOf(". Answer")).split(", "));
      if (withNames) expect(names).toEqual(CATALOG.map((c) => c.name));
      if (withNames) expect(parts.indexOf(named[named.length - 1])).toBe(n - 2);
    }
    expect(promptParts(null)[0].text).toContain("plain Arch Linux");
    // a smaller limit makes more parts, never a cut command
    const small = promptParts(null, { limit: 600 });
    expect(small.length).toBeGreaterThan(promptParts(null).length);
    expect(small.slice(1, -1).every((p) => p.text.length <= 600)).toBe(true);
  });

  it("the prompt copied back is not taken for the answer", () => {
    const parts = promptParts(null);
    expect(isPrompt(parts[0].text, parts)).toBe(true);
    expect(isPrompt(`  ${parts[2].text}\n`, parts)).toBe(true);
    expect(isPrompt(parts[2].text.slice(0, 200), parts)).toBe(true);
    expect(isPrompt('{"refreshed_commands":[]}', parts)).toBe(false);
  });

  it("several answers in the box are read as one, also as a terminal copies them", () => {
    const a = JSON.stringify({ refreshed_commands: [{ name: "mkdir", add_words: ["folders2"] }] });
    const blk = { ...fstrim, name: "blkdiscard", what: "Throws away every block on a drive." };
    const b = "```json\n" + JSON.stringify({ new_commands: [blk] }, null, 2) + "\n```";
    const r = readAnswers(`Here:\n${a}\n\nSure! ${b}\nready`);
    expect([r.read, r.unreadable, r.answer.refreshed_commands.length, r.answer.new_commands.length]).toEqual([2, 0, 1, 1]);
    // a terminal breaks a long line at its width, inside a string too
    const wrapped = '{"new_commands":[{"name":"fstrim","pkg":"util-linux","group":"System","what":"Tells an SSD which\n   blocks are free.","usage":"fstrim","words":["ssd"],"examples":[],"options":[],"oftenWith":[],"neededBy":[]}]}';
    expect(() => JSON.parse(wrapped)).toThrow();
    const w = readAnswers(wrapped).answer.new_commands[0] as { what: string };
    expect(w.what).toBe("Tells an SSD which blocks are free.");
    // a broken one is counted, the others still count; none at all is said
    const cut = readAnswers(`${a}\n{"new_commands":[{"name":"x",}]}`);
    expect([cut.read, cut.unreadable]).toEqual([1, 1]);
    expect(() => readAnswers("ready")).toThrow(/no JSON/);
    expect(() => readAnswers('{"new_commands":[{"name":"x",}]}')).toThrow(/broken/);
    expect(proposals(r.answer).items.map((i) => i.label)).toEqual(["new command: blkdiscard", 'mkdir: search word "folders2"']);
  });
});
