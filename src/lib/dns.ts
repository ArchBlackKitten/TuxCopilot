// DNS, in Security → Network: who answers "where is this website?" — your network's own
// server, Quad9 or Cloudflare (each with its options), and whether the question travels
// encrypted. Set through systemd-resolved, in TuxCopilot's own file
// (/etc/systemd/resolved.conf.d/tuxcopilot-dns.conf); every change is checked at once and the
// old settings come back by themselves if lookups stop working.

import { inv } from "./host";

export const DNS_FILE = "/etc/systemd/resolved.conf.d/tuxcopilot-dns.conf";

export interface DnsState {
  resolvedOn: boolean;
  status: string; // resolvectl status
  ours: string | null; // TuxCopilot's file
}
export const dnsState = () => inv<DnsState>("dns_state");

// ── what resolvectl says ─────────────────────────────────────────────────

export interface DnsLink {
  index: number;
  name: string;
  servers: string[];
  domains: string[];
  defaultRoute: boolean;
  dot: boolean;
}

export interface DnsNow {
  servers: string[]; // set for the whole computer
  fallback: string[];
  dot: boolean;
  llmnr: boolean;
  links: DnsLink[]; // only links that have DNS servers
}

const list = (v: string) => v.trim().split(/\s+/).filter(Boolean);

/** `resolvectl status` → what it says (values that continue on the next lines included). */
export function parseResolvectl(text: string): DnsNow {
  const now: DnsNow = { servers: [], fallback: [], dot: false, llmnr: false, links: [] };
  let link: DnsLink | null = null;
  let last: string | null = null;
  const put = (key: string, value: string) => {
    const v = list(value);
    if (key === "Protocols") {
      const dot = v.includes("+DNSOverTLS") || v.some((x) => /^DNSOverTLS=(yes|opportunistic)/.test(x));
      if (link) {
        link.dot = dot;
        link.defaultRoute = v.includes("+DefaultRoute");
      } else {
        now.dot = dot;
        now.llmnr = v.includes("+LLMNR");
      }
    } else if (key === "DNS Servers") (link ? link.servers : now.servers).push(...v);
    else if (key === "Fallback DNS Servers" && !link) now.fallback.push(...v);
    else if (key === "DNS Domain" && link) link.domains.push(...v);
    else if (key === "Default Route" && link) link.defaultRoute = v[0] === "yes";
  };
  for (const raw of text.split("\n")) {
    const head = raw.match(/^Link (\d+) \(([^)]+)\)/);
    if (head) {
      link = { index: Number(head[1]), name: head[2], servers: [], domains: [], defaultRoute: false, dot: false };
      now.links.push(link);
      last = null;
      continue;
    }
    if (/^Global\b/.test(raw)) {
      link = null;
      last = null;
      continue;
    }
    const kv = raw.match(/^\s*([A-Za-z][A-Za-z .]*?):\s*(.*)$/);
    if (kv) {
      last = kv[1];
      put(last, kv[2]);
    } else if (last && /^\s+\S/.test(raw)) put(last, raw); // a value going on to the next line
  }
  now.links = now.links.filter((l) => l.servers.length);
  return now;
}

const VPN = /^(tun|wg|tap|proton|nordlynx|mullvad|ppp)/;

/** Who answers now, in plain words. */
export function whoAnswers(now: DnsNow): string {
  const vpn = now.links.filter((l) => VPN.test(l.name) && l.domains.includes("~."));
  const parts: string[] = [];
  if (vpn.length) parts.push(`your VPN (${vpn.map((l) => `${l.name}: ${l.servers.join(", ")}`).join("; ")})`);
  if (now.servers.length) parts.push(`the servers chosen for this computer (${now.servers.map(plainServer).join(", ")})`);
  const net = now.links.filter((l) => !VPN.test(l.name) && l.defaultRoute);
  if (net.length && !now.servers.length && !vpn.length) parts.push(`your network's own (${net.map((l) => `${l.name}: ${l.servers.join(", ")}`).join("; ")})`);
  if (!parts.length) return now.fallback.length ? `nobody chosen: systemd's fallback servers (${now.fallback.map(plainServer).join(", ")})` : "nobody: no DNS server is known";
  return parts.join(", and ");
}
const plainServer = (s: string) => s.replace(/#.*$/, "");

// ── the choices ──────────────────────────────────────────────────────────

export type DnsChoice = "network" | "quad9" | "quad9-plain" | "quad9-ecs" | "cloudflare" | "cloudflare-security" | "cloudflare-family";
export type Encryption = "always" | "possible" | "off";

export interface DnsChoiceInfo {
  id: DnsChoice;
  provider: "Your network" | "Quad9" | "Cloudflare";
  label: string;
  what: string;
  servers: string[]; // address#name-the-certificate-must-have
}

const tls = (name: string, ...ips: string[]) => ips.map((ip) => `${ip}#${name}`);

export const DNS_CHOICES: DnsChoiceInfo[] = [
  { id: "network", provider: "Your network", label: "Your network's own", what: "Whatever your Wi-Fi, cable or VPN hands out — often your internet provider, who then sees every website you look up.", servers: [] },
  {
    id: "quad9",
    provider: "Quad9",
    label: "Quad9 — blocks malware",
    what: "A Swiss non-profit. Blocks websites known to spread malware or steal passwords, checks answers are genuine (DNSSEC), and keeps no record of who asked.",
    servers: tls("dns.quad9.net", "9.9.9.9", "149.112.112.112", "2620:fe::fe", "2620:fe::9"),
  },
  {
    id: "quad9-plain",
    provider: "Quad9",
    label: "Quad9 — no blocking",
    what: "Quad9 without the blocking and without the genuineness check: every answer, as it comes.",
    servers: tls("dns10.quad9.net", "9.9.9.10", "149.112.112.10", "2620:fe::10", "2620:fe::fe:10"),
  },
  {
    id: "quad9-ecs",
    provider: "Quad9",
    label: "Quad9 — blocks malware, nearer servers",
    what: "Like Quad9's first, and it tells websites roughly where you are (your area, not you), so big sites can send you to a server nearer you. A little less private.",
    servers: tls("dns11.quad9.net", "9.9.9.11", "149.112.112.11", "2620:fe::11", "2620:fe::fe:11"),
  },
  {
    id: "cloudflare",
    provider: "Cloudflare",
    label: "Cloudflare — fast, no blocking",
    what: "Cloudflare's 1.1.1.1: very fast almost everywhere, deletes its logs within a day, blocks nothing.",
    servers: tls("cloudflare-dns.com", "1.1.1.1", "1.0.0.1", "2606:4700:4700::1111", "2606:4700:4700::1001"),
  },
  {
    id: "cloudflare-security",
    provider: "Cloudflare",
    label: "Cloudflare — blocks malware",
    what: "Cloudflare's 1.1.1.2: fast, and blocks websites known for malware.",
    servers: tls("security.cloudflare-dns.com", "1.1.1.2", "1.0.0.2", "2606:4700:4700::1112", "2606:4700:4700::1002"),
  },
  {
    id: "cloudflare-family",
    provider: "Cloudflare",
    label: "Cloudflare — blocks malware and adult sites",
    what: "Cloudflare's 1.1.1.3: blocks malware and adult content — for a computer children use.",
    servers: tls("family.cloudflare-dns.com", "1.1.1.3", "1.0.0.3", "2606:4700:4700::1113", "2606:4700:4700::1003"),
  },
];

export const ENCRYPTION: Array<{ id: Encryption; label: string; what: string }> = [
  {
    id: "always",
    label: "Always encrypted",
    what: "Nobody on the network (the café, your internet provider) can read or change what you look up. If a network blocks encrypted DNS, websites stop opening there until you choose “When possible”.",
  },
  {
    id: "possible",
    label: "Encrypted when possible",
    what: "Encrypted whenever the server and the network allow it, plain otherwise — so it always works, with VPNs and hotel Wi-Fi too; someone on the network could force it plain.",
  },
  { id: "off", label: "Not encrypted", what: "Plain, as DNS has always been: anyone on the network can see what you look up." },
];

/** What Fluff recommends: Quad9 blocking malware, always encrypted — when possible with a VPN (its own DNS server isn't encrypted). */
export const recommendedDns = (usesVpn: boolean): { choice: DnsChoice; encryption: Encryption } => ({ choice: "quad9", encryption: usesVpn ? "possible" : "always" });

const DOT: Record<Encryption, string> = { always: "yes", possible: "opportunistic", off: "no" };

/** TuxCopilot's settings file for systemd-resolved. LLMNR goes off whatever you choose. */
export function dnsConf(choice: DnsChoice, encryption: Encryption): string {
  const c = DNS_CHOICES.find((x) => x.id === choice)!;
  const lines = [
    `# TuxCopilot: DNS — ${c.label}${choice === "network" ? "" : `, ${ENCRYPTION.find((e) => e.id === encryption)!.label.toLowerCase()}`}.`,
    "# TuxCopilot's Security → Network changes it; deleting this file gives you your network's own DNS back.",
    "[Resolve]",
  ];
  if (choice !== "network") lines.push(`DNS=${c.servers.join(" ")}`, "Domains=~.", `DNSOverTLS=${DOT[encryption]}`);
  lines.push("LLMNR=no");
  return lines.join("\n") + "\n";
}

/** The choice in TuxCopilot's file, or null when there is none (or it isn't one Fluff wrote). */
export function currentDns(ours: string | null): { choice: DnsChoice; encryption: Encryption } | null {
  if (!ours || !/^# TuxCopilot: DNS/m.test(ours)) return null;
  const dns = ours.match(/^DNS=(.*)$/m)?.[1]?.trim();
  if (!dns) return { choice: "network", encryption: "off" };
  const c = DNS_CHOICES.find((x) => x.servers.join(" ") === dns);
  if (!c) return null;
  const dot = ours.match(/^DNSOverTLS=(\w+)/m)?.[1] ?? "no";
  const encryption = (Object.entries(DOT).find(([, v]) => v === dot)?.[0] ?? "off") as Encryption;
  return { choice: c.id, encryption };
}

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

/** How /etc/resolv.conf is kept (resolvectl status): programs ask systemd-resolved only when it is
 *  resolved's own — stub, static or uplink. "foreign" (a VPN or NetworkManager wrote it) or
 *  "missing": they ask someone else, and a DNS set here isn't used (a VPN app may keep it: it says
 *  "foreign"). */
export const resolvConfMode = (status: string): string | null => status.match(/resolv\.conf mode:\s*(\S+)/)?.[1] ?? null;
export const programsAskResolved = (d: Pick<DnsState, "resolvedOn" | "status">): boolean => d.resolvedOn && ["stub", "static", "uplink"].includes(resolvConfMode(d.status) ?? "");

// as you, before anything changes: programs ask systemd-resolved, or a DNS set here would be a gap
const ASKED = `m=$(resolvectl status | sed -n 's/^ *resolv\\.conf mode: *//p'); case "$m" in stub|static|uplink) ;; *) echo "Fluff: your programs don't ask systemd-resolved (resolv.conf mode: \${m:-unknown} — often a VPN or NetworkManager writes resolv.conf), so a DNS set here wouldn't be used. Nothing was changed." >&2; exit 1;; esac`;

/** After the restart: resolved answers, with the servers and the encryption the file says. */
function resolvedSays(conf: string): string {
  const first = conf.match(/^DNS=(\S+)/m)?.[1] ?? null;
  const dot = conf.match(/^DNSOverTLS=(\w+)/m)?.[1] ?? "no";
  return [
    `{ why=; resolvectl query --cache=no archlinux.org >/dev/null 2>&1 || why="looking up archlinux.org failed"`,
    ...(first ? [`g=$(resolvectl dns | sed -n 's/^Global: *//p'); case " $g " in *" ${first} "*) ;; *) why="\${why:+$why; }systemd-resolved doesn't use the new servers";; esac`] : []),
    `o=$(resolvectl dnsovertls | sed -n 's/^Global: *//p'); [ "$o" = ${dot} ] || why="\${why:+$why; }encryption is \${o:-unknown}, not ${dot}"`,
    `[ -z "$why" ]; }`,
  ].join("; ");
}

/** The old settings back, when the new ones don't work as they say. */
const BACK = (f: string) => `if [ -e ${f}.before ]; then sudo mv ${f}.before ${f}; else sudo rm -f ${f}; fi; sudo systemctl restart systemd-resolved.service; false`;

/** Writes the file, restarts systemd-resolved, looks something up and checks the servers and the
 *  encryption in use: if any of it fails, the old settings come back, and it says why. */
export function dnsCommand(conf: string): string {
  const f = `"${DNS_FILE}"`;
  return [
    `${ASKED};`,
    `sudo install -d -m 755 /etc/systemd/resolved.conf.d && sudo rm -f ${f}.before && { [ ! -e ${f} ] || sudo cp -p ${f} ${f}.before; }`,
    `&& printf '%s' '${b64(conf)}' | base64 -d | sudo tee ${f} >/dev/null && sudo systemctl restart systemd-resolved.service && sleep 2`,
    `&& if ${resolvedSays(conf)}; then sudo rm -f ${f}.before; echo "DNS works with the new settings, as they say.";`,
    `else echo "Fluff: $why — so Fluff put the old settings back." >&2; ${BACK(f)}; fi`,
  ].join(" ");
}

/** As it comes: TuxCopilot's file gone, your network's DNS again — looked up after, or it comes back. */
export function dnsRemoveCommand(): string {
  const f = `"${DNS_FILE}"`;
  return [
    `sudo rm -f ${f}.before && sudo mv ${f} ${f}.before && sudo systemctl restart systemd-resolved.service && sleep 2`,
    `&& if resolvectl query --cache=no archlinux.org >/dev/null 2>&1; then sudo rm -f ${f}.before; echo "DNS works as your network gives it.";`,
    `else echo "Fluff: looking up archlinux.org failed without TuxCopilot's DNS file, so Fluff put it back." >&2; sudo mv ${f}.before ${f}; sudo systemctl restart systemd-resolved.service; false; fi`,
  ].join(" ");
}
