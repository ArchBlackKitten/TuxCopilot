// The Full plan's all-in-one command: removes THAT app entirely, and nothing else.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEliminationPlans, chainRemoval } from "@/lib/eliminate";

const SOURCES = ["pacman", "aur", "flatpak", "appimage", "git", "other"];
const oneLiner = (app: string, source: string) =>
  buildEliminationPlans(app, source).find((p) => p.level === "full")!.commands.at(-1)!;

describe("all in one", () => {
  it.each(SOURCES)("%s: Full ends with exactly one all-in-one command; Mid and Partial have none", (source) => {
    const plans = buildEliminationPlans("vlc", source);
    const full = plans.find((p) => p.level === "full")!;
    expect(full.commands.at(-1)!.allInOne).toBe(true);
    expect(plans.flatMap((p) => p.commands).filter((c) => c.allInOne)).toHaveLength(1);
  });

  it.each(SOURCES)("%s: touches only this app — no machine-wide sweeps, nothing interactive", (source) => {
    const cmd = oneLiner("vlc", source).command;
    expect(cmd).toContain("vlc");
    expect(cmd).not.toMatch(/Qtdq|-Sc\b|--unused|rm -[a-z]*i/);
    // every path rm deletes is named after the app
    for (const m of cmd.matchAll(/rm -r?f ([^&;]+)/g)) {
      for (const path of m[1].trim().split(/\s+/)) expect(path).toMatch(/vlc/);
    }
  });

  it("the uninstall comes first, and the data is deleted only if it succeeds", () => {
    const cmd = oneLiner("vlc", "pacman").command;
    expect(cmd.indexOf("pacman -Rns --noconfirm vlc")).toBeLessThan(cmd.indexOf("&& rm -rf"));
  });

  it.each([".", "..", "...", "-rf", "--help", ".config", ".local"])("refuses the dangerous name %j outright", (name) => {
    expect(buildEliminationPlans(name, "pacman")).toEqual([]);
  });
});

describe("all in one, actually run (fake home, fake pacman)", () => {
  function sandbox(pacmanExit: number) {
    const root = mkdtempSync(join(tmpdir(), "am-elim-"));
    const home = join(root, "home");
    const bin = join(root, "bin");
    for (const d of [".config/vlc", ".config/firefox", ".cache/vlc", ".local/share/vlc", ".config/autostart", "Documents"]) {
      mkdirSync(join(home, d), { recursive: true });
    }
    writeFileSync(join(home, ".config/vlc/vlcrc"), "x");
    writeFileSync(join(home, ".config/autostart/vlc.desktop"), "x");
    writeFileSync(join(home, "Documents/keep.txt"), "mine");
    mkdirSync(bin);
    const fake = (name: string, body: string) => {
      writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    };
    fake("sudo", 'exec "$@"');
    fake("pacman", `exit ${pacmanExit}`);
    fake("systemctl", "exit 0");
    return { root, home, bin };
  }

  const run = (cmd: string, home: string, bin: string) => {
    try {
      execFileSync("bash", ["-c", cmd], { env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` }, cwd: home, stdio: "pipe" });
      return 0;
    } catch (e) {
      return (e as { status: number }).status;
    }
  };

  it("deletes vlc's settings, cache, data and autostart entry — and nothing else", () => {
    const { root, home, bin } = sandbox(0);
    expect(run(oneLiner("vlc", "pacman").command, home, bin)).toBe(0);
    for (const gone of [".config/vlc", ".cache/vlc", ".local/share/vlc", ".config/autostart/vlc.desktop"]) {
      expect(existsSync(join(home, gone)), gone).toBe(false);
    }
    for (const kept of [".config/firefox", ".config/autostart", "Documents/keep.txt", ".config", ".cache"]) {
      expect(existsSync(join(home, kept)), kept).toBe(true);
    }
    rmSync(root, { recursive: true, force: true });
  });

  it("a domino chain stops at the first failed removal — the next app is not touched", () => {
    const { root, home, bin } = sandbox(0);
    mkdirSync(join(home, ".config/v4l2loopback"), { recursive: true });
    // pacman fails for obs only
    writeFileSync(join(bin, "pacman"), '#!/bin/sh\ncase "$*" in *obs*) exit 1;; esac\nexit 0\n');
    const chain = chainRemoval([
      { app: "obs", source: "pacman" },
      { app: "v4l2loopback", source: "pacman" },
    ]);
    expect(chain.startsWith("(")).toBe(true);
    expect(run(chain, home, bin)).not.toBe(0);
    expect(existsSync(join(home, ".config/v4l2loopback"))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("when pacman refuses, your data stays", () => {
    const { root, home, bin } = sandbox(1);
    expect(run(oneLiner("vlc", "pacman").command, home, bin)).not.toBe(0);
    expect(existsSync(join(home, ".config/vlc/vlcrc"))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("the removal builder refuses a bad name itself", () => {
  it("never builds rm -rf ~/.config/<app> for ., .., -name or an empty name", async () => {
    const { allInOne } = await import("@/lib/eliminate");
    for (const bad of ["", ".", "..", "-rf", "a b", "../x"]) expect(() => allInOne(bad, "pacman"), JSON.stringify(bad)).toThrow();
    expect(allInOne("vlc", "pacman")).toContain("sudo pacman -Rns --noconfirm vlc");
  });
});
