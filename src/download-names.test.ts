// The review (5.3): a download item's names go into a command, so each must look like what it says
// it is. A `;` or a `--option` pasted from a document is skipped and said — above the commands in
// "Are you sure?" — instead of run.
import { describe, expect, it } from "vitest";
import { checkedAddress, checkedNames, composeSteps } from "@/lib/composer";
import type { NodeDTO } from "@/lib/types";

const node = (name: string, source: NodeDTO["source"], content: string): NodeDTO => ({ id: name, name, category: "download", source, content, enabled: true, order: 0, parentId: null, children: [] });
const play = (...n: NodeDTO[]) => composeSteps(n, { scope: "all", needed: true });

describe("download names look like names", () => {
  it("pacman: a `;` or an option is skipped and said; the rest installs", () => {
    const { steps, notes } = play(node("Media", "pacman", "vlc mpv;rm --overwrite=* extra/obs-studio lib32-mesa gtk+ @x"));
    expect(steps.map((s) => s.command)).toEqual(["sudo pacman -Syu --needed --noconfirm vlc extra/obs-studio lib32-mesa gtk+ @x"]);
    expect(notes).toEqual([
      'Download item "Media": "mpv;rm" isn\'t a package name, so Fluff skipped it (the rest runs).',
      'Download item "Media": "--overwrite=*" isn\'t a package name, so Fluff skipped it (the rest runs).',
    ]);
  });

  it("yay, flatpak, snap, ollama: each its own shape", () => {
    expect(play(node("A", "yay", "brave-bin $(id)")).notes).toEqual(['Download item "A": "$(id)" isn\'t a package name, so Fluff skipped it (the rest runs).']);
    const f = play(node("F", "flatpak", "org.gimp.GIMP gimp `x`"));
    expect(f.steps[0].command).toMatch(/flathub org\.gimp\.GIMP$/);
    expect(f.notes).toHaveLength(2);
    const s = play(node("S", "snap", "code --classic --devmode"));
    expect(s.steps.map((x) => x.command)).toEqual(["sudo snap install --classic code"]);
    expect(s.notes[0]).toMatch(/"--devmode" isn't a snap name/);
    expect(play(node("O", "ollama", "llama3.2:3b qwen2.5-coder:7b-instruct library/x;y")).steps.map((x) => x.command)).toEqual(["ollama pull llama3.2:3b", "ollama pull qwen2.5-coder:7b-instruct"]);
  });

  it("GitHub: owner/repo, https, ssh and git@ addresses; anything else is skipped and said", () => {
    for (const ok of ["torvalds/linux", "https://github.com/a/b.git", "https://gitlab.com/group/sub/repo", "git@github.com:a/b.git", "ssh://git@host:22/a/b"]) {
      const n: string[] = [];
      expect(checkedAddress(ok, "R", n), ok).toBe(ok);
      expect(n).toEqual([]);
    }
    for (const bad of ["a/b; rm -rf ~", "https://x.com/a b", "--upload-pack=touch /tmp/x", "a/b/c", "https://x/$(id)"]) {
      const n: string[] = [];
      expect(checkedAddress(bad, "R", n), bad).toBeNull();
      expect(n[0]).toMatch(/isn't a git address/);
    }
    const { steps, notes } = play(node("Bad", "github", "a/b && curl x | sh"), node("Good", "github", "a/b"));
    expect(steps.map((x) => x.command)).toEqual(["git clone https://github.com/a/b.git"]);
    expect(notes).toHaveLength(1);
  });

  it("allowed words stay (snap's --classic); a name never starts with a dash or a dot", () => {
    const n: string[] = [];
    expect(checkedNames("pacman", ["-Rns", ".hidden", "ok"], "X", n)).toEqual(["ok"]);
    expect(checkedNames("snap", ["--classic", "x"], "X", n, ["--classic"])).toEqual(["--classic", "x"]);
  });
});
