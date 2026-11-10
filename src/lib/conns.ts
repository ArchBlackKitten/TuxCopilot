// Programs talking to the internet now, by program, in plain words.
// Addresses only: looking up their names would itself ask the internet.

import { inv } from "./host";

export interface Conn {
  proto: string;
  local: string;
  peer: string;
  program: string;
  pid: number | null;
  package: string;
}
export const connections = () => inv<Conn[]>("connections"); // conns.rs

const PORTS: Record<number, string> = {
  443: "secure web (HTTPS)",
  80: "plain web (HTTP, not encrypted)",
  53: "a name lookup (DNS)",
  853: "a private name lookup (DNS over TLS)",
  22: "SSH",
  993: "mail (IMAP)",
  465: "mail (sending)",
  587: "mail (sending)",
  5222: "chat (XMPP)",
  3478: "a call (STUN)",
  51820: "a VPN (WireGuard)",
  1194: "a VPN (OpenVPN)",
  67: "your network giving this computer its address (DHCP)",
  123: "the clock (NTP)",
  9001: "Tor",
};

const portOf = (ep: string) => Number(ep.slice(ep.lastIndexOf(":") + 1)) || 0;
export const hostOf = (ep: string) => ep.slice(0, ep.lastIndexOf(":")).replace(/^\[|\]$/g, "").split("%")[0];

/** Whether the other end is on your own network (a router, a printer, a phone). */
export function onYourNetwork(host: string): boolean {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|fe80:|fd|fc)/i.test(host);
}

/** What a connection is, in words. */
export function connWords(c: Pick<Conn, "peer" | "proto">): string {
  const p = portOf(c.peer);
  const what = PORTS[p] ?? `port ${p}`;
  return `${what}, ${onYourNetwork(hostOf(c.peer)) ? "with a computer on your own network" : "with the internet"} (${hostOf(c.peer)})`;
}

export interface ByProgram {
  program: string; // "" = the system's (only root may see which)
  package: string;
  conns: Conn[];
}

/** Grouped by program, the busiest first; the system's unnamed ones last. */
export function byProgram(cs: Conn[]): ByProgram[] {
  const m = new Map<string, ByProgram>();
  for (const c of cs) {
    const g = m.get(c.program) ?? { program: c.program, package: c.package, conns: [] };
    g.conns.push(c);
    if (!g.package && c.package) g.package = c.package;
    m.set(c.program, g);
  }
  return [...m.values()].sort((a, b) => (a.program === "" ? 1 : 0) - (b.program === "" ? 1 : 0) || b.conns.length - a.conns.length || a.program.localeCompare(b.program));
}

/** Plain web is the one to notice: not encrypted. */
export const plainWeb = (cs: Conn[]): Conn[] => cs.filter((c) => portOf(c.peer) === 80 && !onYourNetwork(hostOf(c.peer)));

export const ALL_AS_ROOT = "sudo ss -tunp state established";
