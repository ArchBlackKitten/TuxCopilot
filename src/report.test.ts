// A plain report for a helper: how the computer stands, and never a
// secret — no names of people, computers or networks, no addresses, no journal lines.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { helperReport, scrub, type ReportInput } from "@/lib/report";
import { glance } from "@/lib/glance";

const names = { user: "kit", home: "/home/kit", host: "kits-laptop" };

describe("the cleaner: names and addresses out, whatever a reading carried", () => {
  it("removes them", () => {
    expect(scrub("/home/kit/.config/x and /home/kitty stays apart", names)).toBe("~/.config/x and /home/kitty stays apart");
    expect(scrub("user kit failed; kitchen and kit-two and skit stay", names)).toBe("user [you] failed; kitchen and kit-two and skit stay");
    expect(scrub("kits-laptop and KITS-LAPTOP.local", names)).toBe("[this computer] and [this computer].local");
    expect(scrub("from 192.168.1.20 and 10.0.0.0/8, 203.0.113.9.", names)).toBe("from [an address] and [an address], [an address].");
    expect(scrub("fe80::1c2b:3aff:fe4d:5e6f%wlan0 and 2001:db8::1 and ::1", names)).toBe("[an address] and [an address] and [an address]");
    expect(scrub("wlan0 a4:5e:60:d1:22:9b up", names)).toBe("wlan0 [a hardware address] up");
    expect(scrub("ends a4:5e:60:d1:22:9b. And fe80::1. And 10.1.2.3:22.", names)).toBe("ends [a hardware address]. And [an address]. And [an address]:22.");
  });

  it("keeps what isn't one: versions, times, dates, sizes", () => {
    const keep = "linux-cachyos 7.1.5-1-cachyos, openssl 1.2.3.4-1, glib 1.2.3.4.5, 1.2.3.400, 2026-11-07T13:06:34, 13:06:34, 120.3 GB, zone public, 999.1.1.1";
    expect(scrub(keep, names)).toBe(keep);
    expect(scrub("nothing to hide", { user: "", home: "", host: "" })).toBe("nothing to hide");
  });
});

const here: ReportInput = {
  profile: { osId: "cachyos", osName: "CachyOS Linux", osChosen: false, detectedOsId: "cachyos", detectedOsName: "CachyOS Linux", osOptions: [], desktop: "KDE", sessionType: "wayland", sessions: [], kernels: [], bootloaders: [], loginScreen: "sddm", shell: "/home/kit/.local/bin/zsh", core: [], detectedAt: "" },
  boot: { kernels: [{ package: "linux-cachyos", version: "7.1.5-1-cachyos" }, { package: "linux-cachyos-lts", version: "6.12.40-1-cachyos-lts" }], running: "linux-cachyos", loader: "limine", snapshotMenu: true, snapper: true, headers: true, cachyos: true },
  updates: { repo: [{ name: "a", from: "1", to: "2" }], repoError: null, aur: [], lastUpgrade: "2026-11-07T13:06:34+0000", btrfs: true, snapperRoot: true, snapPac: true, limineSnapper: true, mirrorlistDays: 1, reflector: false, reflectorTimer: false, cachyosMirrors: true, cachyosMirrorsTimer: true } as never,
  checkup: {
    waiting: [{ path: "/etc/pacman.conf.pacnew", file: "/etc/pacman.conf", kind: "pacnew", owner: "pacman", fileExists: true }],
    lockLeft: false, pacmanRunning: false, boot: null,
    errors: ["kits-laptop kwin_wayland[1234]: kit: can't open /home/kit/Secret Plans.odt", "NetworkManager: HomeWifi-5G: 192.168.1.1 timed out"],
    disk: [120_300_000_000, 500_000_000_000],
  },
  services: [
    { name: "drkonqi-coredump-pickup.service", description: "", user: true, state: "failed", enabled: "", since: null, result: "exit-code" },
    { name: "tor.service", description: "", user: false, state: "failed", enabled: "", since: null, result: "timeout" },
    { name: "sshd.service", description: "", user: false, state: "running", enabled: "", since: null },
  ],
  glance: glance({ logins: { failures: [{ when: "2026-11-09 10:00:00+0100", place: "ssh", user: "kit", from: "192.168.1.77" }], since: null } }),
  levels: { network: "good", devices: null, accounts: "secured" },
};

describe("the report", () => {
  const r = helperReport(here, names, new Date("2026-11-10T09:00:00Z"));

  it("says how the computer stands", () => {
    expect(r.startsWith("# How this computer stands — TuxCopilot, 2026-11-10\n")).toBe(true);
    for (const s of [
      "- System: CachyOS Linux · desktop KDE (wayland) · login screen sddm",
      "- Kernels: linux-cachyos 7.1.5-1-cachyos (running now), linux-cachyos-lts 6.12.40-1-cachyos-lts",
      "- Start menu: Limine, which lists snapshots to start from · snapper takes snapshots",
      "- System disk: 120.3 GB free of 500.0 GB",
      "- Last full update: 2026-11-07",
      "- Waiting: 1 update from the repos, 0 updates from the AUR",
      "- Settings files waiting after updates: /etc/pacman.conf.pacnew",
      "- Failed: drkonqi-coredump-pickup.service (yours) — exit-code (Fluff knows it: harmless)",
      "- Failed: tor.service — timeout",
      "- Errors since this start: 2 lines in the journal (not copied here",
      "- Levels: Network Good security · Devices (a mix of my own) · Accounts & login Secured · System (a mix of my own)",
    ])
      expect(r).toContain(s);
    expect(r).not.toContain("sshd.service"); // running: not a problem
  });

  it("never a secret: no journal line, no name, no address — even where a reading carried one", () => {
    for (const secret of ["kit", "kits-laptop", "Secret Plans", "HomeWifi", "192.168.1", "/home/"]) expect(r).not.toContain(secret);
    expect(r).toContain("Wrong passwords: 1 wrong password"); // the row is there, its address cleaned
    expect(r).toContain("[an address]");
  });

  it("what couldn't be read is said, never guessed", () => {
    const none = helperReport({ profile: null, boot: null, updates: null, checkup: null, services: null, glance: [], levels: {} }, names);
    expect(none.match(/Fluff couldn't read it\./g)).toHaveLength(4);
    expect(none).toContain("- Kernels: Fluff couldn't read it.");
  });

  it("made only when you press it, shown whole, then saved with its checksum or copied", () => {
    const p = readFileSync("src/components/arch/report-panel.tsx", "utf8");
    expect(p).toContain("return helperReport(");
    expect(p).toMatch(/\{text && \(\s*<>\s*<Button[^]*Save it…/); // nothing to save until it is made and shown
    expect(p).toContain("saveFile(`tuxcopilot-report-");
    expect(readFileSync("src/components/arch/troubleshoot-view.tsx", "utf8")).toContain("<ReportPanel />");
    expect(readFileSync("src-tauri/src/report.rs", "utf8")).toContain('std::fs::read_to_string("/proc/sys/kernel/hostname")');
  });
});
