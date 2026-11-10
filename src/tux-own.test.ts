// Everything that appears and is TuxCopilot's carries its tag, like "system" on what the system needs. One place knows what is TuxCopilot's; every list that
// can show it asks there.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { tuxPackage, tuxPath, tuxRepo, tuxTorrcLine, tuxUnit } from "@/lib/tux-own";

describe("what is TuxCopilot's own", () => {
  it("its packages, and nothing that only starts like it", () => {
    for (const n of ["tuxcopilot", "tuxcopilot-git", " TuxCopilot "]) expect(tuxPackage(n), n).toBe("TuxCopilot itself");
    for (const n of ["tux", "tuxcopilot-theme", "supertuxkart", "copilot"]) expect(tuxPackage(n), n).toBeNull();
  });

  it("its services", () => {
    expect(tuxUnit("tuxcopilot-shadow.service")).toMatch(/Shadow/);
    expect(tuxUnit("tuxcopilot-usage.timer")).toBe("TuxCopilot put this here");
    expect(tuxUnit("tor.service")).toBeNull();
    expect(tuxUnit("my-tuxcopilot.service")).toBeNull();
  });

  it("its files, in your home folder or the system's", () => {
    expect(tuxPath("/etc/tuxcopilot/shadow.nft")).toMatch(/Shadow's firewall rules/);
    expect(tuxPath("/home/penguin/.local/state/tuxcopilot/off/port-cups.service")).toMatch(/what it switched off/); // where they really are
    expect(tuxPath("~/.local/state/tuxcopilot/off/vlc")).toMatch(/what it switched off/);
    expect(tuxPath("~/.local/state/tuxcopilot")).toBe("TuxCopilot's own records");
    expect(tuxPath("/etc/tuxcopilot/off/port-cups.service")).toBe("TuxCopilot's own folder for system settings"); // not where the records are
    expect(tuxPath("/etc/tuxcopilot")).toMatch(/own folder/);
    expect(tuxPath("/etc/tor/torrc.d/tuxcopilot.conf")).toMatch(/Tor settings/);
    expect(tuxPath("/etc/systemd/resolved.conf.d/tuxcopilot-dns.conf")).toMatch(/DNS you chose/);
    expect(tuxPath("/home/penguin/.local/share/tuxcopilot.desk/tuxcopilot.db")).toMatch(/own data/);
    expect(tuxPath("~/.local/share/tuxcopilot.desk/")).toMatch(/own data/);
    expect(tuxPath("~/.config/tuxcopilot")).toMatch(/settings and cache/);
    expect(tuxPath("/usr/share/applications/tuxcopilot.desktop")).toMatch(/app menu/);
    expect(tuxPath("/usr/share/icons/hicolor/128x128/apps/tuxcopilot.png")).toMatch(/icon/);
    expect(tuxPath("/usr/bin/tuxcopilot")).toBe("TuxCopilot itself");
    expect(tuxPath("/home/penguin/Documents/tuxcopilot-backup-2026-11-04.json")).toMatch(/backup of TuxCopilot's data/);
    expect(tuxPath("tuxcopilot-backup-2026-11-04.json")).toMatch(/backup/);
    for (const p of ["/etc/tor/torrc", "~/.config/kdeconnect", "/etc/tor/torrc.d/other.conf", "~/Projects/TuxCopilot/src", "/usr/bin/tuxcopilotx", "/etc/tuxcopilots"]) expect(tuxPath(p), p).toBeNull();
  });

  it("its own source, however the clone names it", () => {
    for (const o of ["https://github.com/ArchBlackKitten/TuxCopilot.git", "git@github.com:ArchBlackKitten/TuxCopilot.git", "https://github.com/archblackkitten/tuxcopilot/", "ssh://git@github.com/ArchBlackKitten/TuxCopilot"])
      expect(tuxRepo(o), o).toBe("TuxCopilot's own source");
    for (const o of ["https://github.com/someone/TuxCopilot.git", "https://gitlab.com/ArchBlackKitten/TuxCopilot", null, ""]) expect(tuxRepo(o), String(o)).toBeNull();
  });

  it("the lines it writes in your torrc", () => {
    expect(tuxTorrcLine("%include /etc/tor/torrc.d/*.conf")).toMatch(/TuxCopilot added this line/);
    expect(tuxTorrcLine("# TuxCopilot preset: ghost")).toBe("TuxCopilot wrote this");
    expect(tuxTorrcLine("%include /etc/tor/other.conf")).toBeNull();
    expect(tuxTorrcLine("SocksPort 9050")).toBeNull();
  });

  it("every list that can show something of TuxCopilot's asks", () => {
    const asks: Record<string, RegExp> = {
      "app-link": /tuxPackage\(name\)/,
      "app-page": /tuxPackage\(app\)[\s\S]*tuxUnit\(u\.name\)[\s\S]*tuxUnit\(u\.name\)[\s\S]*tuxPath\(c\.path\)[\s\S]*tuxPath\(h\.path\)[\s\S]*tuxPackage\(p\.name\)/,
      "apps-view": /tuxPackage\(a\.name\)/,
      "appmanager-view": /tuxPackage\(r\.app\)/,
      "updates-view": /tuxPackage\(a\.name\)/,
      "services-view": /tuxUnit\(s\.name\)/,
      "ports-panel": /tuxcopilotRole\(/,
      "git-panel": /tuxRepo\(r\.remote\)/,
      "troubleshoot-view": /tuxUnit\(g\.program\)[\s\S]*tuxPath\(w\.path\)/,
      "torrc-editor": /tuxTorrcLine\(/,
      "penguin-panel": /tuxPath\(shownPath\(i\)\)/,
      "penguin-apps": /tuxPackage\(x\)/,
    };
    for (const [f, re] of Object.entries(asks)) expect(readFileSync(`src/components/arch/${f}.tsx`, "utf8"), f).toMatch(re);
  });
});
