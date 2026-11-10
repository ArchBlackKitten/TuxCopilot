// Merge a waiting .pacnew with yours. The way pacdiff merges
// (diff3 -m, the base from the older package in pacman's cache), without vim. The command that
// writes rebuilds the merge as root from root-owned files and writes only what you were shown
// (its sha256). Run here for real — sh, bsdtar, diff3, sha256sum — against a fake /etc.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeCommand, mergeSaid, type Merge, type Waiting } from "@/lib/checkup";

const BASE = "# x settings\na=1\nb=2\nc=3\n";
const MINE = "# x settings\na=1\nb=MINE\nc=3\n";
const NEW = "# x settings\na=1\nb=2\nc=3\nd=NEW\n";
const MERGED = "# x settings\na=1\nb=MINE\nc=3\nd=NEW\n";
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

function machine(opts: { mine?: string; base?: string; pacnew?: string; member?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "tux-merge-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "sudo"), `#!/bin/bash\necho "sudo $1 $2" >> ${root}/calls.log\nexec "$@"\n`);
  chmodSync(join(bin, "sudo"), 0o755);
  mkdirSync(join(root, "etc"));
  writeFileSync(join(root, "etc/x.conf"), opts.mine ?? MINE, { mode: 0o640 });
  writeFileSync(join(root, "etc/x.conf.pacnew"), opts.pacnew ?? NEW);
  // the older package, as pacman's cache keeps it
  const pkgdir = join(root, "pkgsrc");
  mkdirSync(join(pkgdir, "etc"), { recursive: true });
  writeFileSync(join(pkgdir, "etc/x.conf"), opts.base ?? BASE);
  writeFileSync(join(pkgdir, ".PKGINFO"), "pkgname = x\npkgver = 1.0-1\n");
  const pkg = join(root, "x-1.0-1-any.pkg.tar.zst");
  execFileSync("bsdtar", ["-acf", pkg, "-C", pkgdir, ".PKGINFO", ...(opts.member === "none" ? [] : ["etc"])]);
  const w: Waiting = { path: "/etc/x.conf.pacnew", file: "/etc/x.conf", kind: "pacnew", owner: "x", fileExists: true };
  const m: Merge = { owner: "x", installed: "1.1-1", basePackage: pkg, baseVersion: "1.0-1", conflicts: 0, preview: "", sha256: sha(MERGED) };
  // a failure says only what the command printed (its error message would hold the command's own text)
  const run = (cmd: string) => {
    try {
      return execFileSync("bash", ["-c", cmd.replaceAll("'/etc/", `'${root}/etc/`)], { encoding: "utf8", stdio: "pipe", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    } catch (e) {
      throw new Error(`stderr: ${String((e as { stderr?: string }).stderr)}`);
    }
  };
  const read = (p: string) => readFileSync(join(root, p), "utf8");
  return { root, w, m, run, read, has: (p: string) => existsSync(join(root, p)) };
}

describe("merging a waiting .pacnew with yours", () => {
  it("your change and the new line together; yours kept beside it, its permissions kept, the waiting one gone", () => {
    const x = machine();
    const out = x.run(mergeCommand(x.w, x.m, "20261104-120000"));
    expect(x.read("etc/x.conf")).toBe(MERGED);
    expect(x.read("etc/x.conf.before-fluff-20261104-120000")).toBe(MINE);
    expect(x.has("etc/x.conf.pacnew")).toBe(false);
    expect(statSync(join(x.root, "etc/x.conf")).mode & 0o777).toBe(0o640);
    expect(out).toContain("Fluff merged it. Your old one is kept as");
    expect(x.read("calls.log")).toBe("sudo sh -c\n"); // one command as root, nothing else
  });

  it("the files changed since you looked: nothing is written", () => {
    const x = machine();
    writeFileSync(join(x.root, "etc/x.conf"), MINE + "e=LATER\n");
    // a change that merges cleanly, so only the sha256 stops it
    writeFileSync(join(x.root, "etc/x.conf"), "# x settings LATER\na=1\nb=MINE\nc=3\n");
    expect(() => x.run(mergeCommand(x.w, x.m, "t"))).toThrow(/^stderr: Fluff: the files changed since you looked, so nothing was written/);
    writeFileSync(join(x.root, "etc/x.conf"), MINE + "e=LATER\n");
    expect(x.read("etc/x.conf")).toBe(MINE + "e=LATER\n");
    expect(x.has("etc/x.conf.pacnew")).toBe(true);
    expect(x.has("etc/x.conf.before-fluff-t")).toBe(false);
  });

  it("both changed the same lines: nothing is written", () => {
    const x = machine({ pacnew: "# x settings\na=1\nb=THEIRS\nc=3\n" });
    expect(() => x.run(mergeCommand(x.w, x.m, "t"))).toThrow(/^stderr: Fluff: both changed the same lines, so nothing was written/);
    expect(x.read("etc/x.conf")).toBe(MINE);
    expect(x.has("etc/x.conf.pacnew")).toBe(true);
  });

  it("any step that fails stops it: the older package without the file writes nothing", () => {
    const x = machine({ member: "none" });
    let err = "";
    try {
      x.run(mergeCommand(x.w, x.m, "t"));
    } catch (e) {
      err = String(e);
    }
    expect(err).toMatch(/Not found in archive/);
    expect(err).not.toMatch(/Fluff:/); // it stopped at bsdtar, before diff3
    expect(x.read("etc/x.conf")).toBe(MINE);
    expect(x.has("etc/x.conf.pacnew")).toBe(true);
  });

  it("no temporary folder is left behind as root", () => {
    const x = machine();
    const cmd = mergeCommand(x.w, x.m, "t");
    expect(cmd).toContain('trap "rm -rf -- \\"\\$d\\"" EXIT');
    const tmp = mkdtempSync(join(tmpdir(), "tux-merge-tmp-"));
    execFileSync("bash", ["-c", cmd.replaceAll("'/etc/", `'${x.root}/etc/`)], { stdio: "pipe", env: { ...process.env, TMPDIR: tmp, PATH: `${x.root}/bin:${process.env.PATH}` } });
    expect(execFileSync("ls", ["-A", tmp], { encoding: "utf8" })).toBe("");
  });

  it("only with a base, no places to choose, a previewed merge, and a package from the cache", () => {
    const x = machine();
    expect(() => mergeCommand(x.w, { ...x.m, basePackage: null })).toThrow(/no older package/);
    expect(() => mergeCommand(x.w, { ...x.m, conflicts: 2 })).toThrow(/places to choose/);
    expect(() => mergeCommand(x.w, { ...x.m, sha256: "" })).toThrow(/no merge was previewed/);
    expect(() => mergeCommand(x.w, { ...x.m, basePackage: "/var/cache/pacman/pkg/x.tar" })).toThrow(/no older package/);
    expect(() => mergeCommand(x.w, { ...x.m, basePackage: "/var/cache/../../tmp/x-1-1-any.pkg.tar.zst" })).toThrow(/no older package/);
    expect(() => mergeCommand({ ...x.w, path: "/etc/x.conf.pacsave", kind: "pacsave" }, x.m)).toThrow();
    expect(() => mergeCommand({ ...x.w, path: "/etc/x'y.conf.pacnew", file: "/etc/x'y.conf" }, x.m)).toThrow();
  });

  it("what the preview means, in plain words", () => {
    const m: Merge = { owner: "pacman", installed: "7.1.0-5", basePackage: "/var/cache/pacman/pkg/pacman-7.1.0-4-x86_64.pkg.tar.zst", baseVersion: "7.1.0-4", conflicts: 0, preview: "", sha256: sha(MERGED) };
    expect(mergeSaid(m)).toBe("Your changes and the new version fit together (from pacman 7.1.0-4 to 7.1.0-5). Below is how yours would change. Yours is kept beside it first.");
    expect(mergeSaid({ ...m, conflicts: 1 })).toMatch(/^1 place where both you and the package changed the same lines/);
    expect(mergeSaid({ ...m, conflicts: 3 })).toMatch(/^3 places where/);
    expect(mergeSaid({ ...m, basePackage: null, baseVersion: null })).toMatch(/no older pacman is left in pacman's cache \(it was cleaned\)/);
  });
});
