// App pages: pacman's record read from sample `pacman -Qii` output (pacman and
// dolphin), flatpak permissions, and the Fix-it commands run for real in a
// temporary home — a reset never deletes, a restore never loses what was there.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hasPerm, optionalCommand, parsePerms, parseQii, reinstallCommand, resetCommand, restoreCommand, toggleable, unitCommand,
} from "@/lib/app-details";

const fixture = (n: string) => readFileSync(join(__dirname, "test-fixtures", n), "utf8");

describe("pacman's record", () => {
  it("pacman: needs, needed by, optional extras with their state, the config you changed", () => {
    const i = parseQii(fixture("qii-pacman.txt"));
    expect(i.name).toBe("pacman");
    expect(i.from).toBe("cachyos");
    expect(i.explicit).toBe(false);
    expect(i.depends).toContain("bash");
    expect(i.depends.some((d) => d.includes(".so"))).toBe(false); // libraries by soname are left out
    expect(i.requiredBy).toContain("yay");
    expect(i.optional[0]).toEqual({ name: "base-devel", why: "required to use makepkg", installed: true });
    expect(i.optional.find((o) => o.name === "perl-locale-gettext")?.installed).toBe(false);
    expect(i.configs).toEqual([
      { path: "/etc/pacman.conf", modified: true },
      { path: "/etc/makepkg.conf", modified: false },
      { path: "/etc/makepkg.conf.d/rust.conf", modified: false },
    ]);
  });

  it("dolphin: no config files, optional extras listed", () => {
    const i = parseQii(fixture("qii-dolphin.txt"));
    expect(i.name).toBe("dolphin");
    expect(i.configs).toEqual([]);
    expect(i.optional.map((o) => o.name)).toContain("filelight");
    expect(i.url).toMatch(/^https?:\/\//);
  });
});

describe("flatpak permissions", () => {
  const perms = parsePerms("[Context]\nshared=network;ipc;\nsockets=x11;wayland;\nfilesystems=home;xdg-run/gvfs;\n\n[Session Bus Policy]\norg.freedesktop.Notifications=talk\n");
  it("reads the ini, ;-lists split", () => {
    expect(perms.Context.filesystems).toEqual(["home", "xdg-run/gvfs"]);
    expect(hasPerm(perms, "Context", "shared", "network")).toBe(true);
    expect(hasPerm(perms, "Context", "devices", "all")).toBe(false);
    expect(perms["Session Bus Policy"]["org.freedesktop.Notifications"]).toEqual(["talk"]);
  });
});

describe("the commands", () => {
  it("installs say -Syu; extras leave with the app; reinstall really reinstalls", () => {
    expect(optionalCommand("filelight")).toBe("sudo pacman -Syu --needed --noconfirm --asdeps filelight");
    expect(reinstallCommand("dolphin", false)).toBe("sudo pacman -Syu --noconfirm dolphin");
    expect(reinstallCommand("vscodium-bin", true)).toBe("yay -Syu --noconfirm vscodium-bin");
    expect(() => reinstallCommand("-Rns", false)).toThrow();
  });

  it("services: system ones through sudo, your session's without; only enabled/disabled can be switched", () => {
    expect(unitCommand({ name: "fstrim.timer", user: false }, true)).toBe("sudo systemctl enable --now fstrim.timer");
    expect(unitCommand({ name: "plasma-dolphin.service", user: true }, false)).toBe("systemctl --user disable --now plasma-dolphin.service");
    expect(() => unitCommand({ name: "x.service; id", user: false }, true)).toThrow();
    expect(toggleable({ name: "a.service", user: false, enabled: "static", active: "" })).toBe(false);
  });

  const sh = (cmd: string) => execFileSync("bash", ["-c", cmd], { encoding: "utf8" });

  it("reset sets settings aside, restore brings them back and keeps what was there", () => {
    const home = mkdtempSync(join(tmpdir(), "am-app-"));
    const cfg = join(home, ".config", "MyApp");
    mkdirSync(cfg, { recursive: true });
    writeFileSync(join(cfg, "settings.ini"), "theme=mine\n");

    sh(resetCommand([cfg, join(home, ".config", "not-there")]));
    expect(existsSync(cfg)).toBe(false);
    const backups = readdirSync(join(home, ".config")).filter((n) => n.startsWith("MyApp.bak-"));
    expect(backups.length).toBe(1);
    expect(readFileSync(join(home, ".config", backups[0], "settings.ini"), "utf8")).toBe("theme=mine\n");

    // the app ran again and wrote fresh settings; then you restore
    mkdirSync(cfg);
    writeFileSync(join(cfg, "settings.ini"), "theme=default\n");
    sh(restoreCommand(cfg, join(home, ".config", backups[0])));
    expect(readFileSync(join(cfg, "settings.ini"), "utf8")).toBe("theme=mine\n");
    const kept = readdirSync(join(home, ".config")).filter((n) => n.startsWith("MyApp.after-reset-"));
    expect(kept.length).toBe(1);
    expect(readFileSync(join(home, ".config", kept[0], "settings.ini"), "utf8")).toBe("theme=default\n");
  });

  it("a path with a quote is refused, not escaped", () => {
    expect(() => resetCommand(["/home/x/.config/it's"])).toThrow();
  });
});
