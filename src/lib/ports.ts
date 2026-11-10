// Localhost ports: which are taken and by whom, which are free. Read from `ss` (no password):
// your own programs come with their name and process id; for system programs ss names the
// systemd service they run in (its cgroup) and the user account; Docker's published ports are
// matched to their container.

import { execOut, inv, readText } from "./host";

export interface PortUse {
  port: number;
  proto: "tcp" | "udp";
  address: string; // as ss prints it: 127.0.0.1, 0.0.0.0, [::1], [::]…
  reach: "this computer" | "your network"; // loopback only, or every interface
  program: string | null; // own programs only (ss -p needs no password for them)
  pid: number | null;
  service: string | null; // the systemd unit it runs in
  user: string | null;
  container: string | null; // a Docker container publishing it
}

/** What a port number is usually for — a hint, never used to decide anything. */
export const KNOWN_PORTS: Record<number, string> = {
  22: "SSH", 53: "DNS (name lookups)", 80: "web", 443: "web (https)", 631: "printing (CUPS)",
  3000: "dev servers", 3306: "MySQL / MariaDB", 5173: "Vite dev server", 5353: "mDNS (finding devices)",
  5355: "LLMNR (name lookups)", 5432: "PostgreSQL", 6379: "Redis", 8000: "web apps", 8080: "web apps",
  9050: "Tor (SOCKS)", 9051: "Tor control", 9150: "Tor Browser", 11434: "Ollama",
};

function splitAddr(local: string): { address: string; port: number } | null {
  const i = local.lastIndexOf(":");
  if (i < 0) return null;
  const port = Number(local.slice(i + 1));
  return Number.isInteger(port) ? { address: local.slice(0, i).replace(/%\w+$/, ""), port } : null;
}

const LOOPBACK = /^(127\.|\[::1\]$|\[::ffff:127\.)/;

/** `ss -Htulnpe`: one socket per line. */
export function parseSs(out: string, users: Map<number, string> = new Map()): PortUse[] {
  const rows: PortUse[] = [];
  for (const line of out.split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || (cols[0] !== "tcp" && cols[0] !== "udp")) continue;
    if (cols[0] === "tcp" && cols[1] !== "LISTEN") continue;
    const a = splitAddr(cols[4]);
    if (!a) continue;
    if (/^\[fe80:/i.test(a.address)) continue; // link-local helpers (DHCPv6), not a "localhost" port
    const prog = line.match(/users:\(\("([^"]+)",pid=(\d+)/);
    const uid = line.match(/\buid:(\d+)/);
    const unit = line.match(/cgroup:\S*\/([\w@.\\-]+\.service)\b/);
    // a user-session app's cgroup names the app's scope, not a service: keep only real services
    const service = unit && !/\/user@\d+\.service\/app\.slice\//.test(line) ? unit[1].replace(/\\x2d/g, "-") : null;
    rows.push({
      port: a.port,
      proto: cols[0] as "tcp" | "udp",
      address: a.address,
      reach: LOOPBACK.test(a.address) ? "this computer" : "your network",
      program: prog?.[1] ?? null,
      pid: prog ? Number(prog[2]) : null,
      service,
      user: uid ? (users.get(Number(uid[1])) ?? `uid ${uid[1]}`) : "root",
      container: null,
    });
  }
  return rows;
}

/** /etc/passwd → uid → name. */
export function parsePasswd(text: string): Map<number, string> {
  const m = new Map<number, string>();
  for (const l of text.split("\n")) {
    const f = l.split(":");
    if (f.length > 3 && /^\d+$/.test(f[2])) m.set(Number(f[2]), f[0]);
  }
  return m;
}

/** Who to show as the owner, most specific first. */
export function ownerOf(p: PortUse): string {
  if (p.container) return `Docker: ${p.container}`;
  if (p.program) return p.program;
  if (p.service) return p.service.replace(/\.service$/, "");
  return p.user ? `a program of ${p.user}` : "unknown";
}

export async function listPorts(): Promise<PortUse[]> {
  const [ss, passwd, ps] = await Promise.all([
    execOut("ss", ["-Htulnpe"]),
    readText("/etc/passwd"),
    execOut("docker", ["ps", "-a", "--format", "{{json .}}"], 10000),
  ]);
  const rows = parseSs(ss ?? "", parsePasswd(passwd ?? ""));
  // Docker publishes a container's port from its own service: name the container instead
  const byPort = new Map<number, string>();
  for (const l of (ps ?? "").split("\n").filter(Boolean)) {
    try {
      const j = JSON.parse(l) as { Names: string; Ports: string; State: string };
      if (j.State !== "running") continue;
      for (const m of j.Ports.matchAll(/:(\d+)->/g)) byPort.set(Number(m[1]), j.Names);
    } catch {
      // not JSON: skip the line
    }
  }
  for (const r of rows) r.container = byPort.get(r.port) ?? null;
  return rows.sort((a, b) => a.port - b.port || a.proto.localeCompare(b.proto));
}

/** Who holds this TCP port (any address), or nothing when it is free. */
export function takenBy(ports: PortUse[], port: number): PortUse | null {
  return ports.find((p) => p.proto === "tcp" && p.port === port) ?? null;
}

/** The nearest free TCP port at or above `from` (1024–65535). */
export function nearestFree(ports: PortUse[], from: number): number | null {
  const used = new Set(ports.filter((p) => p.proto === "tcp").map((p) => p.port));
  for (let n = Math.max(1024, from); n <= 65535; n++) if (!used.has(n)) return n;
  return null;
}

export const validPort = (n: number) => Number.isInteger(n) && n >= 1 && n <= 65535;

// ── switching a port's service off and on ───────────────────────────────
// A service and the units that start it on demand (its socket, its path) are switched as
// one: `systemctl disable cups.service` alone leaves cups.socket and cups.path to start it
// again. Off writes down what it changed (~/.local/state/tuxcopilot/off/port-<unit>); On puts
// back exactly that. Turned off some other way (no record): On enables what is disabled.


export interface UnitInfo {
  name: string;
  user: boolean;
  enabled: string; // enabled / disabled / static / indirect / …
  active: string; // active / inactive / failed / …
}

export interface UnitFamily {
  units: UnitInfo[]; // triggers first, the service last
  package: string | null;
  offRecord: string | null;
}

export const unitFamily = (name: string) => inv<UnitFamily>("unit_family", { name });
export const portRecords = () => inv<Array<[string, string]>>("port_records");

/** Services the machine itself needs: name lookups, the network, logging in. */
export function criticalUnit(name: string): string | null {
  if (/^systemd-resolved/.test(name)) return "name lookups (every web address) need it";
  if (/^(NetworkManager|iwd|wpa_supplicant|systemd-networkd|connman)/.test(name)) return "your network connection needs it";
  if (/^(systemd-|dbus|polkit|udisks2|upower|accounts-daemon)/.test(name)) return "part of how the system itself runs";
  if (/^(sddm|gdm|lightdm|plasmalogin|greetd|ly)\b/.test(name)) return "your login screen";
  return null;
}

/**
 * On: running. Off: stopped for now, starts again at the next restart (still enabled).
 * Dead: stopped and disabled — stays off until you choose On. Read from the machine each
 * time, so a service started or re-enabled some other way shows as it really is.
 */
export type PortState = "on" | "off" | "dead";

export function portState(f: UnitFamily): PortState {
  if (f.units.some((u) => u.active === "active")) return "on";
  return f.units.some((u) => u.enabled === "enabled") ? "off" : "dead";
}

/** Running now, but nothing of it starts at the next restart. */
export const notAtBoot = (f: UnitFamily) => portState(f) === "on" && !f.units.some((u) => u.enabled === "enabled");

const UNIT = /^[\w@.:-]+\.(service|socket|path|timer)$/;
const recFile = (unit: string) => `"$HOME/.local/state/tuxcopilot/off/port-${unit}"`;

/** Off: stop it now — what starts it on demand first, so it cannot start it again — and leave
 * everything enabled, so the next restart brings it back. */
export function portStopCommand(f: UnitFamily): string {
  const names = f.units.map((u) => u.name).filter((n) => UNIT.test(n));
  const service = names[names.length - 1] ?? "";
  if (!service || criticalUnit(service)) throw new Error(`not switched off: ${service}`);
  return `sudo systemctl stop ${names.join(" ")} && echo "${service} is off for now; it starts again at the next restart."`;
}

/** On from Off: start what starts it, and the service. */
export function portStartCommand(f: UnitFamily): string {
  const names = f.units.map((u) => u.name).filter((n) => UNIT.test(n));
  if (!names.length) throw new Error("nothing to start");
  return `sudo systemctl start ${names.join(" ")}`;
}

/** Off from Dead: able to start at the next restart again, without starting now. */
export function portReviveCommand(service: string, f: UnitFamily): string {
  if (!UNIT.test(service)) throw new Error(`not a unit: ${service}`);
  const rec = recFile(service);
  if (f.offRecord != null) {
    return `while read -r kind what; do [ "$kind" = enabled ] && sudo systemctl enable "$what"; done < ${rec}; rm -f ${rec} && echo "${service} starts again at the next restart."`;
  }
  const parts = f.units.filter((u) => UNIT.test(u.name) && u.enabled === "disabled").map((u) => `sudo systemctl enable ${u.name}`);
  return [...parts, `echo "${service} starts again at the next restart."`].join(" && ");
}

/** The command that takes a port's service from one state to another. */
export function portCommand(service: string, f: UnitFamily, port: number, to: PortState): string {
  const from = portState(f);
  if (from === to) throw new Error("already there");
  if (to === "dead") return portDeadCommand(f, port);
  if (to === "on") return from === "dead" ? portOnCommand(service, f) : portStartCommand(f);
  return from === "on" ? portStopCommand(f) : portReviveCommand(service, f);
}

/** Dead: disabled and stopped, written down so On puts back exactly that. */
export function portDeadCommand(f: UnitFamily, port: number): string {
  const service = f.units[f.units.length - 1]?.name ?? "";
  if (!UNIT.test(service) || criticalUnit(service)) throw new Error(`not switched off: ${service}`);
  const rec = recFile(service);
  const parts = [`mkdir -p "$HOME/.local/state/tuxcopilot/off"`, `echo "port ${Math.trunc(port)}" > ${rec}`];
  for (const u of f.units) {
    if (!UNIT.test(u.name)) continue;
    if (u.enabled === "enabled") parts.push(`sudo systemctl disable --now ${u.name} && echo "enabled ${u.name}" >> ${rec}`);
    else if (u.active === "active") parts.push(`sudo systemctl stop ${u.name} && echo "started ${u.name}" >> ${rec}`);
  }
  parts.push(`echo "port ${Math.trunc(port)} is free now: ${service} and what starts it are off."`);
  return parts.join(" && ");
}

export function portOnCommand(service: string, f: UnitFamily | null): string {
  if (!UNIT.test(service)) throw new Error(`not a unit: ${service}`);
  const rec = recFile(service);
  if (f?.offRecord != null || !f) {
    return `[ -f ${rec} ] && while read -r kind what; do case "$kind" in enabled) sudo systemctl enable --now "$what";; started) sudo systemctl start "$what";; esac; done < ${rec} && rm -f ${rec} && echo "${service} is on again."`;
  }
  // switched off some other way: enable what is disabled, start what is not running
  const parts = f.units
    .filter((u) => UNIT.test(u.name))
    .map((u) => (u.enabled === "disabled" ? `sudo systemctl enable --now ${u.name}` : u.active !== "active" ? `sudo systemctl start ${u.name}` : ""))
    .filter(Boolean);
  return [...(parts.length ? parts : [`sudo systemctl start ${service}`]), `echo "${service} is on, and starts at boot."`].join(" && ");
}

/** Running now but not starting after a restart: make it start at boot again. */
export function keepOnCommand(f: UnitFamily): string {
  const parts = f.units.filter((u) => UNIT.test(u.name) && u.enabled === "disabled").map((u) => `sudo systemctl enable --now ${u.name}`);
  if (!parts.length) throw new Error("nothing to enable");
  return parts.join(" && ");
}

// ── TuxCopilot's own ─────────────────────────────────────────────────────

/** The ports TuxCopilot's Tor file sets (SocksPort 9050, Shadow's TransPort and DNSPort, nyx's ControlPort). */
export function torPortsSet(conf: string | null): Map<number, string> {
  const m = new Map<number, string>();
  for (const line of (conf ?? "").split("\n")) {
    const hit = line.match(/^(SocksPort|TransPort|DNSPort|ControlPort)\s+(?:[\d.]+:)?(\d+)\b/);
    if (hit) m.set(Number(hit[2]), hit[1]);
  }
  return m;
}

/** What each of your own processes is of TuxCopilot's, read from the process itself (own_processes):
 * TuxCopilot, or its dev preview — never guessed from a port number. */
export const ownProcesses = (pids: number[]) => inv<Array<[number, string]>>("own_processes", { pids }).then((r) => new Map(r));

/** Why a port is TuxCopilot's own (it carries TuxCopilot's tag), or null. `own`: from ownProcesses. */
export function tuxcopilotRole(p: PortUse, torConf: string | null, own?: Map<number, string>): string | null {
  if (p.pid !== null && own?.has(p.pid)) return own.get(p.pid)!;
  if (p.program === "tuxcopilot") return "TuxCopilot itself";
  if (p.service === "tor.service") {
    const what = torPortsSet(torConf).get(p.port);
    if (what) return `Tor, as TuxCopilot's Tor settings set it (${what})`;
  }
  return null;
}
