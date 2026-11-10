// Security → Network, as levels (levels.ts): the firewall and DNS.
//                 the firewall                     DNS
//   As it comes   none on (Arch turns none on)     your network's own, no file of Fluff's
//   Good security firewalld, Out and about         Quad9, encrypted when possible
//   Secured       firewalld, Out and about         Quad9, always encrypted
//   Hardened      firewalld, Stealth               Quad9, always encrypted
// Good security is what the Firewall section already recommends (Out and about, Quad9), so a level
// is never below Fluff's own advice. Home stays in the panels below, for a network you trust.
// Each DNS change looks a name up after it and checks the servers and encryption in use, and puts the
// old settings back if any of it fails (dns.ts). When your programs don't ask systemd-resolved
// (resolv.conf "foreign": a VPN or NetworkManager wrote it), DNS is left alone and said so: a
// level is then the firewall alone — a DNS set there would never be used.

import type { DnsState, Encryption } from "./dns";
import { currentDns, dnsCommand, dnsConf, dnsRemoveCommand, programsAskResolved, resolvConfMode } from "./dns";
import type { FirewallState, FwPreset } from "./firewall";
import { currentPreset, FIREWALLD_INSTALL, FIREWALLD_OFF, FIREWALLD_ON, FW_PRESETS, presetCommand, UFW_OFF } from "./firewall";
import { levelOf, type Level, type LevelCard } from "./levels";

export interface NetworkNow {
  firewall: FirewallState;
  dns: DnsState | null;
  sshServer: boolean; // an SSH server runs here: the presets keep SSH open (not in Stealth)
  apps: Set<string>;
}

type Parts = { firewall: "off" | FwPreset; dns: "none" | `quad9:${Encryption}` };

export const PARTS: Record<Level, Parts> = {
  arch: { firewall: "off", dns: "none" },
  good: { firewall: "public", dns: "quad9:possible" },
  secured: { firewall: "public", dns: "quad9:always" },
  hardened: { firewall: "drop", dns: "quad9:always" },
};

export function firewallPart(n: NetworkNow): Parts["firewall"] | null {
  const f = n.firewall;
  if (!f.firewalldOn && !f.ufwOn) return "off";
  if (!f.firewalldOn || f.ufwOn) return null; // ufw: not one Fluff's levels set
  return currentPreset(f, n.sshServer, n.apps);
}
export function dnsPart(d: DnsState | null): Parts["dns"] | null {
  if (!d) return null;
  if (d.ours === null) return "none";
  const c = currentDns(d.ours);
  return c?.choice === "quad9" ? `quad9:${c.encryption}` : null;
}

/** Fluff can set DNS here: your programs ask systemd-resolved. */
export const dnsSettable = (n: NetworkNow): boolean => !!n.dns && programsAskResolved(n.dns);
const firewallOnly = Object.fromEntries(Object.entries(PARTS).map(([l, p]) => [l, { firewall: p.firewall }])) as Record<Level, Pick<Parts, "firewall">>;

export const networkLevel = (n: NetworkNow): Level | null =>
  dnsSettable(n) ? levelOf({ firewall: firewallPart(n), dns: dnsPart(n.dns) }, PARTS) : levelOf({ firewall: firewallPart(n) }, firewallOnly);

const usesVpn = (f: FirewallState) => f.networks.some((x) => ["vpn", "wireguard", "tun"].includes(x.kind));
const label = (p: FwPreset) => FW_PRESETS.find((x) => x.id === p)!.label;

export function networkCards(n: NetworkNow): LevelCard[] {
  const why = !n.dns
    ? "Fluff couldn't read how DNS is set"
    : !n.dns.resolvedOn
      ? "systemd-resolved isn't running"
      : `your programs don't ask systemd-resolved (resolv.conf: ${resolvConfMode(n.dns.status) ?? "unknown"} — often your VPN or NetworkManager writes it)`;
  const dns = (words: string) => (dnsSettable(n) ? `DNS: ${words}` : `DNS: not changed — ${why}, so a DNS set here wouldn't be used`);
  const vpn = usesVpn(n.firewall) ? " You use a VPN: “always encrypted” can stop names being looked up while it is on — Fluff looks one up after the change and puts the old settings back if it fails." : "";
  const ssh = n.sshServer ? "SSH stays open: an SSH server runs here." : null;
  return [
    {
      id: "arch",
      what: "As Arch comes: no firewall, and whoever your network hands out answers DNS.",
      sets: ["firewall: none on (firewalld and ufw switched off)", dns("your network's own — TuxCopilot's DNS file removed")],
      caution: "Other computers on your network reach every program that listens here, and your internet provider sees every website you look up.",
    },
    {
      id: "good",
      what: "Safe on any network: nothing on this computer can be reached from outside, and DNS blocks known malware sites, encrypted where the network allows.",
      sets: [`firewall: firewalld, “${label("public")}” — only answers to what this computer asked for come in`, ...(ssh ? [ssh] : []), dns("Quad9 (blocks malware), encrypted when possible")],
      caution: null,
    },
    {
      id: "secured",
      what: "Good security, and DNS is always encrypted: nobody on the way sees the names you look up.",
      sets: [`firewall: firewalld, “${label("public")}”`, ...(ssh ? [ssh] : []), dns("Quad9, always encrypted — no encryption, no answer")],
      caution: dnsSettable(n) ? `On a network that blocks encrypted DNS (some hotels, schools, captive Wi-Fi), websites don't open until you're signed in or choose Good security.${vpn}` : null,
    },
    {
      id: "hardened",
      what: "Nothing that comes in is answered, not even a ping, so other computers can't reach this one. DNS always encrypted.",
      sets: [`firewall: firewalld, “${label("drop")}” — nothing that comes in is answered${n.sshServer ? ", SSH too" : ""}`, dns("Quad9, always encrypted")],
      caution: `${FW_PRESETS.find((x) => x.id === "drop")!.caution}${n.sshServer ? " SSH from other computers stops." : ""} It still shows itself by what it sends (every website it opens sees it).${dnsSettable(n) ? vpn : ""}`,
    },
  ];
}


/** The command that sets a level from how it is now: only the parts that differ. */
export function networkCommand(to: Level, n: NetworkNow): string {
  const want = PARTS[to];
  const f = n.firewall;
  const steps: string[] = [];
  if (firewallPart(n) !== want.firewall) {
    if (want.firewall === "off") {
      if (f.firewalldOn) steps.push(FIREWALLD_OFF);
      if (f.ufwOn) steps.push(UFW_OFF);
    } else {
      if (f.ufwOn) steps.push(UFW_OFF); // never two firewalls
      if (!f.firewalldInstalled) steps.push(FIREWALLD_INSTALL);
      else if (!f.firewalldOn) steps.push(FIREWALLD_ON);
      steps.push(presetCommand(f, want.firewall, n.sshServer, n.apps));
    }
  }
  if (dnsSettable(n) && dnsPart(n.dns) !== want.dns) {
    if (want.dns === "none") {
      if (n.dns?.ours != null) steps.push(dnsRemoveCommand());
    } else steps.push(dnsCommand(dnsConf("quad9", want.dns.slice("quad9:".length) as Encryption)));
  }
  return steps.join(" && ");
}
