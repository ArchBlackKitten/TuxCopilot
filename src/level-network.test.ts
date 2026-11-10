// Security → Network as levels (Good security, Secured, Hardened, As it comes first). Good security is never below the Firewall section's own advice.
import { describe, expect, it } from "vitest";
import { dnsPart, firewallPart, networkCards, networkCommand, networkLevel, PARTS, type NetworkNow } from "@/lib/level-network";
import { dnsCommand, dnsConf, dnsRemoveCommand, programsAskResolved, recommendedDns, resolvConfMode } from "@/lib/dns";
import { FIREWALLD_INSTALL, FIREWALLD_OFF, FIREWALLD_ON, presetCommand, UFW_OFF, type FirewallState, type Zone } from "@/lib/firewall";

const zone = (o: Partial<Zone>): Zone => ({ name: "public", short: "Public", description: "", default: false, target: "default", connections: [], services: [], ports: [], masquerade: false, changed: false, ...o });
const zones = (def: "public" | "home" | "drop") => [
  zone({ name: "public", services: ["dhcpv6-client"], default: def === "public" }),
  zone({ name: "home", services: ["dhcpv6-client", "mdns", "samba-client"], default: def === "home" }),
  zone({ name: "drop", target: "DROP", default: def === "drop" }),
];
const fw = (o: Partial<FirewallState>): FirewallState => ({
  firewalldInstalled: true, firewalldOn: true, ufwInstalled: false, ufwOn: false, defaultZone: "public", zones: [], servicePorts: [], networks: [], presetZones: zones("public"), ...o,
});
// resolvectl status, as on a computer whose programs ask systemd-resolved (resolv.conf is its stub)
const dns = (ours: string | null, resolvedOn = true, mode = "stub") => ({ resolvedOn, status: `Global\n           Protocols: +LLMNR\n    resolv.conf mode: ${mode}\n`, ours });
const now = (f: Partial<FirewallState>, ours: string | null, sshServer = false): NetworkNow => ({ firewall: fw(f), dns: dns(ours), sshServer, apps: new Set() });

const arch = now({ firewalldOn: false }, null);
const good = now({}, dnsConf("quad9", "possible"));
const secured = now({}, dnsConf("quad9", "always"));
const hardened = now({ presetZones: zones("drop") }, dnsConf("quad9", "always"));

describe("Network: As it comes · Good security · Secured · Hardened", () => {
  it("Good security is the Firewall section's own advice: Out and about, Quad9", () => {
    expect(PARTS.good.firewall).toBe("public");
    expect(PARTS.good.dns.split(":")[0]).toBe(recommendedDns(false).choice);
    expect(PARTS.hardened.dns).toBe(`quad9:${recommendedDns(false).encryption}`);
  });

  it("says the level it is at", () => {
    expect([arch, good, secured, hardened].map(networkLevel)).toEqual(["arch", "good", "secured", "hardened"]);
    expect(networkLevel(now({ presetZones: zones("home") }, dnsConf("quad9", "possible")))).toBeNull(); // Home: your own choice
    expect(networkLevel(now({}, dnsConf("cloudflare", "always")))).toBeNull();
    expect(networkLevel(now({}, dnsConf("network", "off")))).toBeNull(); // Fluff's file, saying "your network": not as Arch comes
    expect(firewallPart(now({ ufwOn: true }, null))).toBeNull(); // ufw: not a level's
    expect(firewallPart(now({ firewalldOn: false, ufwOn: true }, null))).toBeNull();
    expect(dnsPart(null)).toBeNull();
    // SSH open because an SSH server runs here is still the preset
    expect(networkLevel(now({ presetZones: [zone({ name: "public", services: ["dhcpv6-client", "ssh"], default: true })] }, dnsConf("quad9", "possible"), true))).toBe("good");
  });

  it("runs only what differs", () => {
    expect(networkCommand("good", arch)).toBe([FIREWALLD_ON, presetCommand(arch.firewall, "public", false, new Set()), dnsCommand(dnsConf("quad9", "possible"))].join(" && "));
    expect(networkCommand("secured", good)).toBe(dnsCommand(dnsConf("quad9", "always")));
    expect(networkCommand("hardened", secured)).toBe(presetCommand(secured.firewall, "drop", false, new Set()));
    expect(networkCommand("arch", hardened)).toBe(`${FIREWALLD_OFF} && ${dnsRemoveCommand()}`);
    expect(FIREWALLD_OFF).toMatch(/^sudo systemctl disable --now firewalld\.service && \{ ! systemctl is-active -q firewalld\.service \|\| /); // and checked stopped
    expect(networkCommand("good", good)).toBe("");
    // DNS not read: Fluff doesn't touch what it couldn't see
    expect(networkCommand("arch", { ...hardened, dns: null })).toBe(FIREWALLD_OFF);
    // never two firewalls; firewalld installed (the whole system updated first) when it isn't there
    expect(networkCommand("good", now({ firewalldOn: false, ufwOn: true }, dnsConf("quad9", "possible")))).toBe([UFW_OFF, FIREWALLD_ON, presetCommand(fw({}), "public", false, new Set())].join(" && "));
    expect(networkCommand("good", now({ firewalldInstalled: false, firewalldOn: false }, dnsConf("quad9", "possible")))).toMatch(new RegExp(`^${FIREWALLD_INSTALL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} && `));
    expect(FIREWALLD_INSTALL).toMatch(/pacman -Syu --needed/);
    // As it comes with ufw on: both off; no DNS file: nothing to remove
    expect(networkCommand("arch", now({ ufwOn: true }, null))).toBe(`${FIREWALLD_OFF} && ${UFW_OFF}`);
  });

  it("the cards say what they set and cost; without systemd-resolved DNS can't be set", () => {
    const c = networkCards({ ...arch, sshServer: true });
    expect(c.map((x) => x.id)).toEqual(["arch", "good", "secured", "hardened"]);
    expect(c[0].caution).toMatch(/reach every program/);
    expect(c[1].sets).toContain("SSH stays open: an SSH server runs here.");
    expect(c[1].caution).toBeNull();
    expect(c[3].sets[0]).toMatch(/nothing that comes in is answered, SSH too/);
    expect(c[3].what).not.toMatch(/isn't there/); // it still shows itself by what it sends
    expect(c[3].caution).toMatch(/still shows itself by what it sends/);
    expect(c[3].caution).toMatch(/SSH from other computers stops/);
    const vpn = networkCards({ ...arch, firewall: fw({ networks: [{ name: "My VPN", uuid: "", device: "wg0", kind: "wireguard", zone: "" }] }) });
    expect(vpn[2].caution).toMatch(/You use a VPN/);
    // without systemd-resolved every card can still be chosen (the firewall), and says DNS isn't changed, and why
    const off = networkCards({ ...arch, dns: dns(null, false) });
    expect(off.every((x) => x.unavailable === undefined)).toBe(true);
    expect(off.every((x) => x.sets.some((l) => /^DNS: not changed — systemd-resolved isn't running, so a DNS set here wouldn't be used$/.test(l)))).toBe(true);
    expect(networkCards(arch).every((x) => x.unavailable === undefined)).toBe(true); // running: every card can be chosen
  });
});

describe("DNS only where programs ask systemd-resolved", () => {
  // a VPN app on: resolv.conf is someone else's
  const foreign = (n: NetworkNow): NetworkNow => ({ ...n, dns: { resolvedOn: true, status: "Global\n    resolv.conf mode: foreign\n", ours: n.dns?.ours ?? null } });

  it("reads the mode from resolvectl status; only resolved's own resolv.conf counts", () => {
    expect(resolvConfMode("    resolv.conf mode: foreign\n")).toBe("foreign");
    expect(resolvConfMode("Global\n")).toBeNull();
    for (const m of ["stub", "static", "uplink"]) expect(programsAskResolved({ resolvedOn: true, status: `resolv.conf mode: ${m}` }), m).toBe(true);
    for (const m of ["foreign", "missing"]) expect(programsAskResolved({ resolvedOn: true, status: `resolv.conf mode: ${m}` }), m).toBe(false);
    expect(programsAskResolved({ resolvedOn: false, status: "resolv.conf mode: stub" })).toBe(false);
  });

  it("foreign: the level is the firewall alone, DNS is never touched, and each card says why", () => {
    expect(networkLevel(foreign(now({}, null)))).toBe("good"); // Out and about; DNS isn't Fluff's to set here
    expect(networkLevel(foreign(now({ presetZones: zones("drop") }, null)))).toBe("hardened");
    expect(networkCommand("secured", foreign(good))).toBe("");
    expect(networkCommand("arch", foreign(hardened))).toBe(FIREWALLD_OFF); // TuxCopilot's DNS file isn't taken away either
    const c = networkCards(foreign(arch));
    expect(c.every((x) => x.sets.some((l) => /^DNS: not changed — your programs don't ask systemd-resolved \(resolv\.conf: foreign — often your VPN/.test(l)))).toBe(true);
    expect(c[2].caution).toBeNull(); // no DNS cost when DNS isn't set
  });
});
