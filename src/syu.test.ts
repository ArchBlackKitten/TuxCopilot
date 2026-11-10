// The rule: every install TuxCopilot writes is `-Syu --needed` — the lists
// are fresh AND the system is updated first, so nothing is installed onto a half-updated system.
// The explainer warns about `-Sy <package>` (pacman or yay), in plain words, with -Syu as the
// fix; the one sanctioned -Sy is the keyring alone followed by the full update.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { explainCommand } from "@/lib/arch-explain";

const partial = (cmd: string) => explainCommand(cmd).warnings.find((w) => w.text.startsWith("Partial upgrade"));

describe("-Syu, the rule", () => {
  it("the explainer warns about -Sy <package>, for pacman and yay, and offers -Syu", () => {
    const p = partial("sudo pacman -Sy --needed vlc");
    expect(p?.text).toMatch(/updates the list of packages but not your system/);
    expect(p?.safeAlt).toBe("sudo pacman -Syu --needed <package>");
    expect(p?.fix).toMatch(/^use '.*-Syu/); // the fix button rewrites -Sy to -Syu in place
    expect(partial("yay -Sy google-chrome")?.safeAlt).toBe("yay -Syu --needed <package>");
    expect(partial("sudo pacman -Syu --needed vlc")).toBeUndefined();
    expect(partial("yay -Syu --needed brave-bin")).toBeUndefined();
    expect(partial("sudo pacman -Sy")).toBeUndefined(); // only refreshing the lists installs nothing
  });

  it("the keyring alone, then the full update, is the one -Sy that is fine", () => {
    expect(partial("sudo pacman -Sy archlinux-keyring && sudo pacman -Syu")).toBeUndefined();
    expect(partial("sudo pacman -Sy archlinux-keyring")).toBeDefined(); // without the update after it
    expect(partial("sudo pacman -Sy archlinux-keyring vlc && sudo pacman -Syu")).toBeDefined();
    expect(partial("sudo pacman -Syu && sudo pacman -Sy archlinux-keyring")).toBeDefined(); // the update came first
  });

  it("no command TuxCopilot writes installs with -Sy", () => {
    // the folders walked directly, not `git ls-files`: a release tarball (makepkg's check()) is
    // not a git folder
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const p = join(d, n);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    const files = [...walk("src"), ...walk("src-tauri/src"), ...walk("scripts"), "README.md"].filter((f) => !/\.test\.tsx?$/.test(f) && /\.(ts|tsx|rs|json|md)$/.test(f));
    const found: string[] = [];
    for (const f of files) {
      // Rust tests (after #[cfg(test)]) hold -Sy on purpose, as what must not count
      readFileSync(f, "utf8")
        .split("#[cfg(test)]")[0]
        .split("\n")
        .forEach((line, i) => {
          if (!/\b(pacman|yay) -Sy(?![a-zA-Z])/.test(line)) return;
          // what may still say it: the keyring fix, the explainer's warning, and examples of what *you* might type
          if (/archlinux-keyring|Partial upgrade|what do -Sy/.test(line)) return;
          if (f === "src/components/arch/arch-commands.tsx" && /^\s*"(sudo )?(pacman|yay) -Sy [\w.-]+",$|placeholder=/.test(line)) return;
          found.push(`${f}:${i + 1}`);
        });
    }
    expect(found).toEqual([]);
  });
});
