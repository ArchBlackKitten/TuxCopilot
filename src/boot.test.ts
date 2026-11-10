// A way back if an update breaks starting: the commands run here for
// real against a fake computer — a fake sudo, pacman and bootctl, and start menus written in a folder.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootFindings, howToChoose, menuCheckCommand, secondKernel, secondKernelCommand, type BootFacts } from "@/lib/boot";

const here: BootFacts = {
  kernels: [{ package: "linux-cachyos", version: "7.1.5-1-cachyos" }, { package: "linux-cachyos-lts", version: "6.12.40-1-cachyos-lts" }],
  running: "linux-cachyos", loader: "limine", snapshotMenu: true, snapper: true, headers: true, cachyos: true,
};
const one = (o: Partial<BootFacts> = {}): BootFacts => ({ ...here, kernels: [here.kernels[0]], ...o });
const arch = one({ kernels: [{ package: "linux", version: "6.17.1-arch1-1" }], loader: "grub", snapshotMenu: false, headers: false, cachyos: false });

function machine(o: { installs?: string; esp?: string; menu?: string; grub?: string; bootctl?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "tux-boot-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  for (const d of ["etc/default", "boot/grub", "modules/7.1.5-1-cachyos"]) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, "modules/7.1.5-1-cachyos/pkgbase"), "linux-cachyos\n");
  writeFileSync(join(root, "modules/7.1.5-1-cachyos/vmlinuz"), "");
  if (o.esp !== undefined) writeFileSync(join(root, "etc/default/limine"), `ESP_PATH="${join(root, o.esp)}"\n`);
  if (o.menu !== undefined) {
    mkdirSync(join(root, o.esp ?? "boot"), { recursive: true });
    writeFileSync(join(root, o.esp ?? "boot", "limine.conf"), o.menu);
  }
  if (o.grub !== undefined) writeFileSync(join(root, "boot/grub/grub.cfg"), o.grub);
  const tool = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  tool("sudo", `echo "sudo $*" >> ${root}/calls; exec "$@"`);
  // pacman "installs" the kernel it is given a folder for, or nothing
  tool("pacman", o.installs ? `d=${root}/modules/9.9.9-${o.installs}; mkdir -p $d; echo ${o.installs} > $d/pkgbase; : > $d/vmlinuz` : "exit 0");
  tool("grub-mkconfig", `echo "grub-mkconfig $*" >> ${root}/calls`);
  tool("bootctl", o.bootctl ?? "exit 1");
  const run = (cmd: string) => {
    const here = cmd
      .replaceAll("/etc/default/limine", join(root, "etc/default/limine"))
      .replaceAll("/etc/limine-entry-tool.conf", join(root, "etc/limine-entry-tool.conf"))
      .replaceAll("/usr/lib/modules", join(root, "modules"))
      .replaceAll("/boot", join(root, "boot"));
    try {
      return execFileSync("bash", ["-c", here], { encoding: "utf8", stdio: "pipe", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    } catch (e) {
      throw new Error(`stderr: ${(e as { stderr?: string }).stderr ?? ""}`);
    }
  };
  return { root, run };
}

const LIMINE = "timeout: 5\n/+CachyOS\n  comment: machine-id=x\n//linux-cachyos\n    protocol: linux\n    cmdline: quiet root=UUID=1\n//linux-cachyos-lts\n//linux-cachyos fallback\n//Snapshots\n";

describe("a second kernel", () => {
  it("the long-term one, or the main one when only the long-term one is there; its headers when a kernel's are installed", () => {
    expect(secondKernel(one())).toEqual(["linux-cachyos-lts", "linux-cachyos-lts-headers"]);
    expect(secondKernel(one({ kernels: [here.kernels[1]], headers: false }))).toEqual(["linux-cachyos"]);
    expect(secondKernel(arch)).toEqual(["linux-lts"]);
    expect(secondKernel({ ...arch, kernels: [{ package: "linux-lts", version: "6.12" }] })).toEqual(["linux"]);
    expect(secondKernel(here)).toBeNull();
    expect(secondKernel(one({ kernels: [] }))).toBeNull();
    expect(() => secondKernelCommand(here)).toThrow(/already has a second kernel/);
  });

  it("installed with -Syu --needed, GRUB's menu written again, and checked in place", () => {
    const c = secondKernelCommand(arch);
    expect(c.startsWith("sudo pacman -Syu --needed linux-lts && sudo grub-mkconfig -o /boot/grub/grub.cfg && ")).toBe(true);
    expect(secondKernelCommand(one())).not.toContain("grub-mkconfig"); // Limine's hook adds it by itself
    expect(machine({ installs: "linux-lts" }).run(c)).toMatch(/^Fluff: linux-lts is in place\. Check the start menu/);
  });

  it("an install that didn't put it in place fails, and says so", () => {
    expect(() => machine().run(secondKernelCommand(arch))).toThrow(/^stderr: Fluff: linux-lts isn't in place after the install\.\n$/);
  });
});

describe("the start menu, read as root: its names only", () => {
  it("Limine: from ESP_PATH's limine.conf — each kernel said, the fallback too; never a kernel's options", () => {
    const out = machine({ esp: "efi", menu: LIMINE }).run(menuCheckCommand(here));
    expect(out).toBe(
      [
        "The start menu lists:", "  +CachyOS", "  linux-cachyos", "  linux-cachyos-lts", "  linux-cachyos fallback", "  Snapshots",
        "Fluff: in the menu: linux-cachyos", "Fluff: in the menu: linux-cachyos-lts",
        "Fluff: a fallback start is there too (it starts with every driver, for when the usual start won't).", "",
      ].join("\n"),
    );
    expect(out).not.toMatch(/cmdline|root=|machine-id/);
  });

  it("a kernel the menu doesn't name is said; linux-cachyos-lts never counts for linux-cachyos", () => {
    const out = machine({ menu: "/+CachyOS\n//linux-cachyos-lts\n" }).run(menuCheckCommand(here)); // no ESP_PATH: /boot
    expect(out).toContain("Fluff: not found by name in the menu: linux-cachyos — look at the names above.");
    expect(out).toContain("Fluff: in the menu: linux-cachyos-lts");
    expect(out).not.toContain("fallback start");
  });

  it("GRUB's and systemd-boot's names", () => {
    const grub = "menuentry 'Arch Linux' --class arch {\n}\nsubmenu 'Advanced options for Arch Linux' {\n\tmenuentry 'Arch Linux, with Linux linux' {\n\t}\n\tmenuentry 'Arch Linux, with Linux linux (fallback initramfs)' {\n\t}\n}\n";
    const g = machine({ grub }).run(menuCheckCommand(arch));
    expect(g).toContain("  Arch Linux, with Linux linux (fallback initramfs)\n");
    expect(g).toContain("Fluff: in the menu: linux\n");
    expect(g).toContain("Fluff: a fallback start is there too");
    const sd = machine({ bootctl: `printf '%s\\n' 'Boot Loader Entries:' '         title: Arch Linux (linux-lts)' '            id: arch-lts.conf'` }).run(menuCheckCommand({ ...arch, loader: "", kernels: [{ package: "linux-lts", version: "x" }] }));
    expect(sd).toContain("  Arch Linux (linux-lts)\nFluff: in the menu: linux-lts\n");
  });

  it("a menu it can't read: said, and the command fails", () => {
    expect(() => machine().run(menuCheckCommand(here))).toThrow(/^stderr: Fluff couldn't read the start menu's names \(Limine\)\.\n$/);
    expect(() => machine().run(menuCheckCommand({ ...arch, loader: "" }))).toThrow(/couldn't read the start menu's names \(your start menu\)/);
  });
});

describe("what Fluff says", () => {
  it("this computer: two kernels, snapshots in the menu", () => {
    expect(bootFindings(here)).toEqual([
      { level: "ok", title: "2 kernels", detail: "linux-cachyos (running now) and linux-cachyos-lts. If an update breaks one, start another." },
      { level: "ok", title: "Snapshots in the start menu", detail: "One starts the system as it was before an update (snapper takes one before each)." },
    ]);
  });

  it("one kernel: the recommendation; snapshots taken but not in the menu: what would list them", () => {
    const f = bootFindings({ ...arch, snapper: true });
    expect(f[0]).toMatchObject({ level: "warn", title: "One kernel only" });
    expect(f[0].detail).toMatch(/Fluff recommends a second one: linux-lts/);
    expect(f[1]).toMatchObject({ level: "info", detail: expect.stringMatching(/GRUB doesn't list them: grub-btrfs would/) });
    expect(bootFindings(one({ kernels: [] }))[0].title).toBe("Fluff couldn't find the kernels");
    expect(bootFindings({ ...arch, snapper: false }).map((x) => x.title)).toEqual(["One kernel only"]); // no snapper: no snapshots to list
  });

  it("how to choose, per start menu", () => {
    expect(howToChoose(here)).toMatch(/^When the computer starts, Limine shows its menu .* Your snapshots are there too/);
    expect(howToChoose(arch)).toMatch(/hold Shift \(or tap Esc\).*"Advanced options"\.$/);
    expect(howToChoose({ loader: "", snapshotMenu: false })).toMatch(/hold Space \(systemd-boot\)/);
  });
});

describe("in Updates", () => {
  it("under the firmware: the findings, how to choose, the second kernel when there is one only, and the menu check", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/components/arch/updates-view.tsx", "utf8")).toContain("<FirmwarePanel />\n      <BootPanel />");
    const p = readFileSync("src/components/arch/boot-panel.tsx", "utf8");
    for (const s of ["bootFindings(f)", "howToChoose(f)", "{second && (", "secondKernelCommand(f)", "menuCheckCommand(f)"]) expect(p).toContain(s);
  });
});
