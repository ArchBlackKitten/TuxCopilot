// What should be off when not needed (ssh, bluetooth…) — each
// said plainly with when you need it; Off stops its sockets too; On never starts both sshd's
// socket and service (both want port 22).
import { describe, expect, it } from "vitest";
import { installedNotNeeded, isOn, NOT_NEEDED, offCommand, onCommand } from "@/lib/not-needed";
import { FIREWALL_WORDS, targetWords } from "@/lib/firewall";
import type { Service } from "@/lib/services";

const svc = (name: string, state: string, enabled: string, user = false) => ({ name, state, enabled, user, description: "", since: null }) as unknown as Service;
const n = (s: string) => NOT_NEEDED.find((x) => x.service === s)!;

describe("off if not needed", () => {
  it("the usual suspects are there, each said plainly", () => {
    for (const s of ["sshd.service", "bluetooth.service", "cups.service", "avahi-daemon.service", "smb.service", "teamviewerd.service", "anydesk.service"]) expect(n(s), s).toBeDefined();
    for (const x of NOT_NEEDED) expect([x.what, x.needed, x.advice].every((t) => t.length > 3), x.service).toBe(true);
  });

  it("only what is installed is shown; on means running, waiting, or set to start", () => {
    const list = installedNotNeeded([svc("bluetooth.service", "running", "enabled"), svc("cups.service", "off", "disabled"), svc("sshd.service", "dormant", "disabled", true), svc("vlc.service", "running", "enabled")]);
    expect(list.map((x) => x.service)).toEqual(["bluetooth.service", "cups.service"]); // a user's own sshd isn't the system's
    expect([isOn(svc("a", "running", "disabled")), isOn(svc("a", "dormant", "disabled")), isOn(svc("a", "off", "enabled")), isOn(svc("a", "off", "disabled"))]).toEqual([true, true, true, false]);
  });

  it("Off stops its sockets first (they would wake it), each only if it exists here", () => {
    expect(offCommand(n("cups.service"))).toBe(
      "true && { ! systemctl cat cups.socket >/dev/null 2>&1 || sudo systemctl disable --now cups.socket; } && { ! systemctl cat cups.path >/dev/null 2>&1 || sudo systemctl disable --now cups.path; } && sudo systemctl disable --now cups.service",
    );
    expect(offCommand(n("bluetooth.service"))).toBe("true && sudo systemctl disable --now bluetooth.service");
  });

  it("On brings it back — sshd without its socket, which wants the same port", () => {
    expect(onCommand(n("sshd.service"))).toBe("sudo systemctl enable --now sshd.service");
    expect(offCommand(n("sshd.service"))).toContain("disable --now sshd.socket");
    expect(onCommand(n("avahi-daemon.service"))).toBe("sudo systemctl enable --now avahi-daemon.service && { ! systemctl cat avahi-daemon.socket >/dev/null 2>&1 || sudo systemctl enable --now avahi-daemon.socket; }");
    expect(() => offCommand({ ...n("cups.service"), service: "cups; reboot" })).toThrow();
  });

  it("every part of the firewall is explained, the targets in a sentence", () => {
    const terms = FIREWALL_WORDS.map((w) => w.term);
    for (const t of ["Zone", "Default zone", "Port", "Target", "Ping"]) expect(terms).toContain(t);
    expect(targetWords("ACCEPT")).toBe("lets everything in");
    expect(targetWords("DROP")).toMatch(/isn't there/);
    expect(targetWords("default")).toBe("refuses everything else, with a reply");
    expect(targetWords("%%REJECT%%")).toBe("refuses everything else, with a reply");
  });
});
