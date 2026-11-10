// "Did anyone change my system files?", against the packages' and Fluff's recorded SHA-256s.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECK_AS_ROOT, changeKind, compare, knownChange, placeWords, record, reinstallCommand, toLookAt, type FileChange } from "@/lib/filecheck";

const fc = (path: string, reasons: string[], settings = false, pkg = "p"): FileChange => ({ package: pkg, path, reasons, settings });

describe("against the packages' own fingerprints", () => {
  it("what kind of change", () => {
    expect(changeKind(fc("/x", ["SHA256 checksum mismatch"]))).toBe("contents");
    expect(changeKind(fc("/x", ["Size mismatch"]))).toBe("contents");
    expect(changeKind(fc("/x", ["File type mismatch"]))).toBe("contents");
    expect(changeKind(fc("/x", ["UID mismatch", "Permissions mismatch"]))).toBe("owner");
  });

  it("sample findings: every one Fluff can explain", () => {
    const here = [
      fc("/boot", ["Permissions mismatch"], false, "filesystem"),
      fc("/etc/cups/printers.conf", ["Permissions mismatch"], false, "cups"),
      fc("/etc/lsb-release", ["Size mismatch", "SHA256 checksum mismatch"], false, "lsb-release"),
      fc("/usr/lib/plymouth/plymouth-update-initrd", ["File type mismatch"], false, "plymouth"),
      fc("/usr/lib/utempter/utempter", ["GID mismatch", "Permissions mismatch"], false, "libutempter"),
      fc("/usr/lib/vlc/plugins/plugins.dat", ["SHA256 checksum mismatch"], false, "libvlc"),
      fc("/var/lib/ollama", ["UID mismatch", "GID mismatch"], false, "ollama"),
      fc("/var/lib/passim/data", ["UID mismatch"], false, "passim"),
    ];
    expect(here.filter((c) => !knownChange(c.path)).map((c) => c.path)).toEqual([]);
  });

  it("a program file changed and nobody explains it: first in the list; settings files aren't listed", () => {
    const l = toLookAt([fc("/usr/lib/vlc/plugins/plugins.dat", ["SHA256 checksum mismatch"]), fc("/etc/pacman.conf", ["SHA256 checksum mismatch"], true), fc("/usr/bin/sudo", ["SHA256 checksum mismatch"]), fc("/usr/bin/odd", ["Permissions mismatch"])]);
    expect(l.map((c) => c.path)).toEqual(["/usr/bin/sudo", "/usr/bin/odd", "/usr/lib/vlc/plugins/plugins.dat"]);
    expect(knownChange("/usr/bin/sudo")).toBeNull();
  });

  it("put back: reinstalled with the whole system updated first, only package names", () => {
    expect(reinstallCommand(["sudo", "coreutils", "sudo"])).toBe("sudo pacman -Syu coreutils sudo");
    expect(() => reinstallCommand([])).toThrow();
    expect(() => reinstallCommand(["x; rm -rf /"])).toThrow();
    expect(CHECK_AS_ROOT).toMatch(/^out=\$\(sudo pacman -Qkk 2>&1\); /); // pacman's answer first, then only what differs
  });
});

describe("against Fluff's own recorded fingerprints", () => {
  it("changed, new and gone, since the record", () => {
    const was = record([{ path: "/etc/a", sha256: "1" }, { path: "/etc/b", sha256: "2" }, { path: "/etc/c", sha256: "3" }], "2026-11-05T10:00:00Z");
    expect(was.when).toBe("2026-11-05T10:00:00Z");
    const d = compare(was, [{ path: "/etc/a", sha256: "1" }, { path: "/etc/b", sha256: "CHANGED" }, { path: "/usr/local/bin/new", sha256: "4" }]);
    expect(d).toEqual({ changed: ["/etc/b"], added: ["/usr/local/bin/new"], removed: ["/etc/c"] });
    expect(compare(was, [{ path: "/etc/a", sha256: "1" }, { path: "/etc/b", sha256: "2" }, { path: "/etc/c", sha256: "3" }])).toEqual({ changed: [], added: [], removed: [] });
  });

  it("why each place matters, in plain words", () => {
    expect(placeWords("/home/someone/.bashrc")).toMatch(/every time you open a terminal/);
    expect(placeWords("/home/someone/.ssh/authorized_keys")).toMatch(/log in to this computer over SSH/);
    expect(placeWords("/home/someone/.config/autostart/x.desktop")).toMatch(/starts by itself when you log in/);
    expect(placeWords("/home/someone/.config/plasma-workspace/env/x.sh")).toMatch(/starts by itself/);
    expect(placeWords("/usr/local/bin/sudo")).toMatch(/found before the system's/);
    expect(placeWords("/etc/ca-certificates/trust-source/anchors/x.crt")).toMatch(/certificate your computer trusts/);
    expect(placeWords("/etc/pam.d/x")).toMatch(/sudo check who you are/);
    expect(placeWords("/etc/whatever.conf")).toBe("a settings file no package owns");
  });
});

describe("check as root: never \"all fine\" when nothing was checked", () => {
  const run = (pacman: string) => {
    const root = mkdtempSync(join(tmpdir(), "tux-qkk-"));
    mkdirSync(join(root, "bin"));
    for (const [n, b] of [["sudo", 'exec "$@"'], ["pacman", pacman]]) {
      writeFileSync(join(root, "bin", n), `#!/bin/bash\n${b}\n`);
      chmodSync(join(root, "bin", n), 0o755);
    }
    try {
      return execFileSync("bash", ["-c", CHECK_AS_ROOT], { encoding: "utf8", stdio: "pipe", env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}` } });
    } catch (e) {
      throw new Error(`stderr: ${(e as { stderr?: string }).stderr ?? ""}`);
    }
  };
  it("pacman checked: only what differs; or that nothing does", () => {
    expect(run(`echo "sudo: 120 total files, 0 altered files"; echo "warning: sudo: /usr/bin/sudo (SHA256 checksum mismatch)"; echo "x: /etc/x (Modification time mismatch)"; exit 1`)).toBe("warning: sudo: /usr/bin/sudo (SHA256 checksum mismatch)\n");
    expect(run(`echo "sudo: 120 total files, 0 altered files"`)).toBe("Fluff: no file differs from what its package recorded.\n");
  });
  it("sudo not allowed, or pacman never ran: said, and it fails", () => {
    expect(() => run(`echo "sudo: a password is required" >&2; exit 1`)).toThrow(/^stderr: sudo: a password is required\nFluff: pacman couldn't check the files, so nothing is known\.\n$/);
  });
});
