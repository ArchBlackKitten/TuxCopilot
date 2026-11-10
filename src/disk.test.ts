// Home's disk widget: the size formats each tool prints (flatpak, docker, df), and the cache
// buttons run for real against a fake machine.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMPTY_PACMAN_CACHE, FREE_AUR_CACHE, FREE_PACMAN_CACHE, formatBytes, parseDf, parseSize } from "@/lib/disk";

describe("sizes as the tools print them", () => {
  it("flatpak (decimal), docker (no space), binary units", () => {
    expect(parseSize("500.9 MB")).toBe(500_900_000);
    expect(parseSize("32.84kB")).toBe(32_840);
    expect(parseSize("0B")).toBe(0);
    expect(parseSize("1.5 GiB")).toBe(1_610_612_736);
    expect(parseSize("-")).toBeNull();
  });

  it("df -B1 /, and readable sizes", () => {
    expect(parseDf("Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/nvme0n1p2 500000000000 400000000000 100000000000  80% /\n")).toEqual({
      total: 500000000000, used: 400000000000, free: 100000000000,
    });
    expect(formatBytes(100000000000)).toBe("93.1 GB");
    expect(formatBytes(512)).toBe("512 B");
  });
});


describe("the cache buttons, run for real against a fake machine", () => {
  const setup = (busy = false) => {
    const root = mkdtempSync(join(tmpdir(), "am-cache-"));
    const cache = join(root, "var/cache/pacman/pkg");
    mkdirSync(join(cache, "download-0jJ8yC"), { recursive: true });
    writeFileSync(join(cache, "download-0jJ8yC", "part"), "x");
    writeFileSync(join(cache, "vlc-3.0-1-x86_64.pkg.tar.zst"), "x");
    writeFileSync(join(cache, "vlc-3.0-1-x86_64.pkg.tar.zst.sig"), "x");
    mkdirSync(join(root, "var/lib/pacman"), { recursive: true });
    if (busy) writeFileSync(join(root, "var/lib/pacman/db.lck"), "");
    const home = join(root, "home");
    mkdirSync(join(home, ".cache/yay/snapd/src"), { recursive: true });
    writeFileSync(join(home, ".cache/yay/vcs.json"), "{}");
    writeFileSync(join(home, ".cache/yay/completion.cache"), "");
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "sudo"), '#!/bin/bash\nexec "$@"\n');
    writeFileSync(join(bin, "pacman"), `#!/bin/bash\necho "$@" >> ${root}/pacman.log\n`);
    chmodSync(join(bin, "sudo"), 0o755);
    chmodSync(join(bin, "pacman"), 0o755);
    const run = (cmd: string) => {
      const c = cmd.replaceAll("/var/", `${root}/var/`);
      try {
        return { ok: true, out: execFileSync("bash", ["-c", c], { encoding: "utf8", env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` } }) };
      } catch (e) {
        return { ok: false, out: String((e as { stdout?: string }).stdout ?? "") };
      }
    };
    return { root, cache, home, run };
  };

  it("free: the interrupted downloads go, then pacman -Sc keeps the installed versions", () => {
    const m = setup();
    expect(m.run(FREE_PACMAN_CACHE).ok).toBe(true);
    expect(existsSync(join(m.cache, "download-0jJ8yC"))).toBe(false);
    expect(readdirSync(m.cache)).toContain("vlc-3.0-1-x86_64.pkg.tar.zst"); // pacman decides, not us
    expect(execFileSync("cat", [join(m.root, "pacman.log")], { encoding: "utf8" })).toBe("-Sc --noconfirm\n");
  });

  it("empty: every package file goes", () => {
    const m = setup();
    expect(m.run(EMPTY_PACMAN_CACHE).ok).toBe(true);
    expect(readdirSync(m.cache)).toEqual([]);
  });

  it("AUR: build folders go, vcs.json and the search cache stay", () => {
    const m = setup();
    expect(m.run(FREE_AUR_CACHE).ok).toBe(true);
    expect(readdirSync(join(m.home, ".cache/yay")).sort()).toEqual(["completion.cache", "vcs.json"]);
  });

  it("while pacman is busy, nothing is touched", () => {
    const m = setup(true);
    for (const cmd of [FREE_PACMAN_CACHE, EMPTY_PACMAN_CACHE, FREE_AUR_CACHE]) {
      const r = m.run(cmd);
      expect(r.ok).toBe(false);
      expect(r.out).toMatch(/pacman is busy/);
    }
    expect(existsSync(join(m.cache, "download-0jJ8yC"))).toBe(true);
    expect(readdirSync(m.cache).length).toBe(3);
    expect(existsSync(join(m.home, ".cache/yay/snapd"))).toBe(true);
  });
});
