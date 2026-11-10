// Packaging: the AUR reads .SRCINFO, not the PKGBUILD — so each .SRCINFO must say what its
// PKGBUILD says (release.sh writes both; a stale one would install the wrong thing), and the
// release key they name is the one in keys/release-key.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");
const field = (text: string, k: string) => [...text.matchAll(new RegExp(`^\\s*${k} = (.*)$`, "gm"))].map((m) => m[1]);
const array = (pkgbuild: string, k: string) => {
  const m = pkgbuild.match(new RegExp(`^${k}=\\(([\\s\\S]*?)\\)`, "m"));
  return m ? [...m[1].replace(/#.*$/gm, "").matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2]) : [];
};
const scalar = (pkgbuild: string, k: string) => pkgbuild.match(new RegExp(`^${k}=['"]?([^'"\\n]*)`, "m"))?.[1];

describe("packaging", () => {
  for (const dir of ["packaging", "packaging/tuxcopilot-git"]) {
    it(`${dir}/.SRCINFO says what its PKGBUILD says`, () => {
      const pb = read(`${dir}/PKGBUILD`);
      const si = read(`${dir}/.SRCINFO`);
      expect(field(si, "pkgbase")).toEqual([scalar(pb, "pkgname")]);
      expect(field(si, "pkgver")).toEqual([scalar(pb, "pkgver")]);
      expect(field(si, "pkgrel")).toEqual([scalar(pb, "pkgrel")]);
      for (const k of ["depends", "makedepends", "sha256sums"]) expect(field(si, k), k).toEqual(array(pb, k));
      expect(field(si, "optdepends").length).toBe(array(pb, "optdepends").length);
      expect(field(si, "validpgpkeys")).toEqual(array(pb, "validpgpkeys"));
    });
  }

  it("the release key the AUR checks is TuxCopilot's release key", () => {
    const key = read("keys/release-key").trim();
    expect(field(read("packaging/.SRCINFO"), "validpgpkeys")).toEqual([key]);
    expect(read(`keys/pgp/${key}.asc`)).toContain("BEGIN PGP PUBLIC KEY BLOCK");
  });
});

// The review (1.3): the app is built as a plain binary (PKGBUILD, install.sh: cargo build, never
// `tauri build`, which downloads its own bundlers), so no Debian package target pretends otherwise.
describe("no bundler", () => {
  it("tauri.conf.json bundles nothing, and still names the icons the window uses", () => {
    const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
    expect(conf.bundle.active).toBe(false);
    expect(conf.bundle.targets).toBeUndefined();
    expect(conf.bundle.icon).toContain("icons/icon.png");
    // the lines that run something (a comment may say "not `tauri build`")
    const run = (f: string) => read(f).split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    for (const f of ["packaging/PKGBUILD", "packaging/tuxcopilot-git/PKGBUILD", "install.sh"]) expect(run(f), f).not.toMatch(/tauri build|\.deb\b/);
  });
});
