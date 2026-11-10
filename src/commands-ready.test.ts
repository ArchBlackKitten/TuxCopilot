// What a sweep of the whole catalogue found, kept from coming back.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { explainCommand } from "@/lib/arch-explain";
import { pacmanBundle } from "@/lib/pacman-letters";
import { RECIPES, searchCommands, stem } from "@/lib/command-search";
import { installLine, notInstalled, packageOf } from "@/lib/commands/install-line";

const flag = (cmd: string) => explainCommand(cmd).segments[0].tokens.find((t) => t.role === "flag")!;
const top = (q: string) => searchCommands(q)[0]?.command;
const catalog = JSON.parse(readFileSync("src/lib/commands/catalog.json", "utf8"));
const LIST: Array<{ name: string; pkg: string; what: string; examples: Array<{ command: string; meaning: string }>; options: Array<{ token: string }> }> = catalog.commands ?? catalog;
const doc = (n: string) => LIST.find((e) => e.name === n)!;

describe("Commands, really ready", () => {
  it("a | ; or && inside quotes is part of the word, not a new command", () => {
    const segs = (c: string) => explainCommand(c).segments.map((s) => s.text);
    expect(segs("lspci -k | grep -A3 -E 'VGA|3D'")).toEqual(["lspci -k", "grep -A3 -E 'VGA|3D'"]);
    expect(segs('echo "a;b" && ls')).toEqual(['echo "a;b"', "ls"]);
    expect(segs("echo a\\|b | wc -l")).toEqual(["echo a\\|b", "wc -l"]);
    expect(segs("grep 'x && y' f; ls")).toEqual(["grep 'x && y' f", "ls"]);
    expect(segs("ls | wc -l && echo done")).toEqual(["ls", "wc -l", "echo done"]);
  });

  it("pacman's letters mean what they mean in that operation", () => {
    expect(flag("sudo pacman -Rs vlc").meaning).toBe("remove + also remove the dependencies nothing else needs");
    expect(flag("sudo pacman -Rc vlc").meaning).toMatch(/also remove every package that needs it \(risky/);
    expect(flag("sudo pacman -Ru vlc").meaning).toBe("remove + only remove packages nothing needs");
    expect(flag("pacman -Qu").meaning).toBe("look in what is installed (query) + only packages that have an update waiting");
    expect(flag("pacman -Qs vlc").meaning).toMatch(/search what is installed/);
    expect(flag("pacman -Ss vlc").meaning).toMatch(/search the repositories/);
    expect(flag("sudo pacman -Sd vlc").meaning).toMatch(/skip dependency checks \(risky\)/);
    expect(flag("pacman -Qqm").meaning).toMatch(/names only.*not in any repository/);
    expect(flag("pacman -Qc vlc").meaning).toMatch(/changelog/);
    expect(flag("pacman -Sl").meaning).toMatch(/list a repository's packages/);
    expect(flag("sudo pacman -Scc").meaning).toMatch(/clean every package file/);
    expect(flag("pacman -Qkk vlc").meaning).toMatch(/changed since install/);
    expect(flag("sudo pacman -Syu").meaning).toBe("refresh databases + full-system upgrade — the normal full update"); // the hand-written one stays
    expect(pacmanBundle("-Qz")).toBeNull();
    expect(pacmanBundle("-Xs")).toBeNull();
    expect(pacmanBundle("-Rns")!.expanded).toEqual(["-R", "-n", "-s"]);
    expect(pacmanBundle("-Syyu")!.expanded).toEqual(["-S", "-yy", "-u"]);
    // every option pacman lists for -Q, -S and -R is understood
    for (const [op, letters] of [["Q", "bcdegiklmnopqrstuv"], ["S", "bcdgilpqrsuvwy"], ["R", "bcdnprsuv"]] as const)
      for (const l of letters) expect(flag(`pacman -${op}${l} x`).ok, `-${op}${l}`).toBe(true);
  });

  it("the system's own tools are commands, not “subcommands of system”", () => {
    for (const c of ["wpctl status", "bootctl status", "localectl status", "sudo pacman-key --init", "timedatectl", "sudo mkinitcpio -P", "sudo reflector --latest 5"]) {
      const b = explainCommand(c).segments[0].tokens.find((t) => t.role === "binary");
      expect(b?.ok, c).toBe(true);
    }
  });

  it("every example in the catalogue and every recipe is fully understood", () => {
    const bad: string[] = [];
    const sweep = (cmd: string) => explainCommand(cmd).segments.forEach((s) => s.tokens.forEach((t) => t.ok || bad.push(`${cmd} [${t.raw}]`)));
    for (const e of LIST) for (const x of e.examples) sweep(x.command);
    for (const r of RECIPES) sweep(r.command.replace(/<[^>]+>/g, "x"));
    expect(bad).toEqual([]);
  });

  it("a word and its plural (or -ed, -ing) meet: files is file, packages is package", () => {
    for (const [a, b] of [["file", "files"], ["package", "packages"], ["update", "updated"], ["update", "updating"], ["install", "installed"], ["fix", "fixes"], ["process", "processes"], ["service", "services"], ["cache", "caches"], ["remove", "removed"]])
      expect(stem(a), `${a}/${b}`).toBe(stem(b));
  });

  it("everyday searches land on the right command first", () => {
    expect(top("install package")).toBe("sudo pacman -Syu --needed <package>");
    expect(top("how do i install an app")).toBe("sudo pacman -Syu --needed <package>");
    expect(top("install aur package")).toBe("yay -Syu --needed <package>");
    expect(top("list files of a package")).toBe("pacman -Ql <package>");
    expect(top("which package owns this file")).toBe("pacman -Qo <file>");
    expect(top("remove package")).toBe("sudo pacman -Rns <package>");
    expect(top("no sound")).toBe("wpctl status");
    // each recipe's own words find it among the first three
    const lost = RECIPES.filter((r) => !searchCommands(r.say).slice(0, 3).some((m) => m.command === r.command)).map((r) => r.say);
    expect(lost).toEqual([]);
  });

  it("the catalogue says the truth about packages and options", () => {
    expect(doc("reboot").pkg).toBe("systemd-sysvcompat");
    expect(doc("poweroff").pkg).toBe("systemd-sysvcompat");
    expect(doc("fsck").pkg).toBe("util-linux");
    expect(doc("fsck").what).toMatch(/NOT mounted/);
    expect(doc("fsck").what).toMatch(/btrfs check/);
    expect(doc("fsck").examples.map((x) => x.command)).not.toContain("sudo fsck -A"); // it would touch mounted filesystems
    expect(doc("sha256sum").options.map((o) => o.token)).not.toContain("-q, --quiet"); // there is no -q
    expect(doc("fzf").examples[0].meaning).not.toMatch(/PAGER/); // fzf only prints what you pick
  });

  it("a page for a program that isn't here says which package has it, and how to get it", () => {
    expect(notInstalled("nmap is not installed on this computer (or did not answer).")).toBe(true);
    expect(notInstalled("Usage: nmap [Scan Type(s)]")).toBe(false);
    expect(installLine("nmap")).toBe("sudo pacman -Syu --needed nmap");
    expect(installLine("yay (AUR)")).toBe("yay -Syu --needed yay");
    expect(installLine("bash (built in)")).toBeNull();
    expect(packageOf("bash (built in)")).toBeNull();
    expect(installLine("x; rm -rf ~")).toBeNull();
    for (const e of LIST) if (packageOf(e.pkg)) expect(installLine(e.pkg), e.name).toMatch(/^(sudo pacman|yay) -Syu --needed [a-z0-9@._+-]+$/);
  });
});
