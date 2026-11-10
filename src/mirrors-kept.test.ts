// The review (5.4): "Fresh mirrors now" keeps your old mirror list beside it first. Run here for
// real against a fake /etc/pacman.d and a fake reflector.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIRRORLIST, MIRRORS_NOW } from "@/lib/updates";
import { tuxPath } from "@/lib/tux-own";

function machine(reflectorFails = false) {
  const root = mkdtempSync(join(tmpdir(), "tux-mirrors-"));
  const bin = join(root, "bin");
  const dir = join(root, "pacman.d");
  mkdirSync(bin);
  mkdirSync(dir);
  writeFileSync(join(dir, "mirrorlist"), "Server = https://mine.example/$repo/os/$arch\n");
  writeFileSync(join(bin, "sudo"), '#!/bin/bash\nexec "$@"\n');
  writeFileSync(join(bin, "reflector"), reflectorFails ? "#!/bin/bash\nexit 1\n" : '#!/bin/bash\nwhile [ "$1" != --save ]; do shift; done; echo "Server = https://fresh.example/\\$repo/os/\\$arch" > "$2"\n');
  for (const f of ["sudo", "reflector"]) chmodSync(join(bin, f), 0o755);
  const run = () => execFileSync("bash", ["-c", MIRRORS_NOW.replaceAll(MIRRORLIST, join(dir, "mirrorlist"))], { encoding: "utf8", stdio: "pipe", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  return { dir, run };
}

describe("fresh mirrors, and yours kept", () => {
  it("your list is copied beside it first, then reflector writes the new one, and it says where yours is", () => {
    const m = machine();
    const out = m.run();
    const kept = readdirSync(m.dir).filter((f) => f.startsWith("mirrorlist.before-fluff-"));
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatch(/^mirrorlist\.before-fluff-\d{8}-\d{6}$/);
    expect(readFileSync(join(m.dir, kept[0]), "utf8")).toContain("mine.example");
    expect(readFileSync(join(m.dir, "mirrorlist"), "utf8")).toContain("fresh.example");
    expect(out).toContain(`Fluff kept your old list as ${join(m.dir, kept[0])}`);
    expect(tuxPath(`/etc/pacman.d/${kept[0]}`)).toMatch(/a copy Fluff kept/);
  });

  it("reflector failing leaves yours in place, and the copy too", () => {
    const m = machine(true);
    expect(() => m.run()).toThrow();
    expect(readFileSync(join(m.dir, "mirrorlist"), "utf8")).toContain("mine.example");
  });
});
