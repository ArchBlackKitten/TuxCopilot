// Tor section — the Tor service, its settings, the tools around it, and troubleshooting.
//
// Guides about Tor go out of date (transport programs get renamed, built-in bridges change),
// so what changes is read from the Tor Project when it is needed, not carried in the app:
// the built-in bridges and the transport lines come from the same file Tor Browser is built
// from. Only when that cannot be reached do the copies below stand in, and the UI says so.
//
// TuxCopilot's settings live in their own file, /etc/tor/torrc.d/tuxcopilot.conf, included
// from /etc/tor/torrc. Your own torrc is never rewritten; removing that one file undoes all.

import { execOut, httpGet, readText } from "./host";
import type { Diagnosis, Check, Fix } from "./troubleshoot";
import { errorLines } from "./troubleshoot";

export const CONF = "/etc/tor/torrc.d/tuxcopilot.conf";
export const INCLUDE = "%include /etc/tor/torrc.d/*.conf";
export const PT_CONFIG_URL =
  "https://gitlab.torproject.org/tpo/applications/tor-browser-build/-/raw/main/projects/tor-expert-bundle/pt_config.json";
/** On Arch the transport program comes from the AUR (lyrebird-proxy), installed here. */
export const PT_PATH = "/usr/bin/";

// ── built-in bridges, from the Tor Project ───────────────────────────────

export interface Builtins {
  bridges: Record<string, string[]>; // transport → bridge lines
  plugins: Record<string, string>; // program → ClientTransportPlugin line
  fetchedAt: string | null; // null: the stand-in copy below
}

// As the Tor Project's file had them when this was written — used only when it can't be reached.
const STANDIN_PLUGINS: Record<string, string> = {
  lyrebird: "ClientTransportPlugin meek_lite,obfs2,obfs3,obfs4,scramblesuit,webtunnel exec ${pt_path}lyrebird${pt_extension}",
  snowflake: "ClientTransportPlugin snowflake exec ${pt_path}lyrebird${pt_extension}",
};

export function parsePtConfig(text: string): Omit<Builtins, "fetchedAt"> | null {
  try {
    const j = JSON.parse(text) as { bridges?: Record<string, string[]>; pluggableTransports?: Record<string, string> };
    if (!j.bridges || !j.pluggableTransports) return null;
    return { bridges: j.bridges, plugins: j.pluggableTransports };
  } catch {
    return null;
  }
}

export async function fetchBuiltins(): Promise<Builtins> {
  const res = await httpGet(PT_CONFIG_URL, { Accept: "application/json" }, 10000);
  const parsed = res?.ok ? parsePtConfig(res.text) : null;
  return parsed ? { ...parsed, fetchedAt: new Date().toISOString() } : { bridges: {}, plugins: STANDIN_PLUGINS, fetchedAt: null };
}

/** The ClientTransportPlugin line for a transport, with Arch's program path filled in. */
export function pluginLine(transport: string, plugins: Record<string, string>): string | null {
  const t = transport === "obfs4" || transport === "meek_lite" || transport === "webtunnel" ? "lyrebird" : transport;
  const tpl = plugins[t] ?? STANDIN_PLUGINS[t];
  return tpl ? tpl.replace("${pt_path}", PT_PATH).replace("${pt_extension}", "") : null;
}

// ── settings ─────────────────────────────────────────────────────────────

export type BridgeMode = "off" | "snowflake" | "obfs4" | "own";
export type Preset = "standard" | "secure" | "ghost" | "shadow";

export interface TorSettings {
  socksPort: number;
  bridges: BridgeMode;
  ownBridges: string[]; // lines as bridges.torproject.org gives them
  control: boolean; // ControlPort + cookie, so nyx (and you) can watch Tor
  preset: Preset;
  bridgesSince: string | null; // YYYY-MM-DD: when these bridges were set (Fluff recommends new ones after a while)
}

export const DEFAULTS: TorSettings = { socksPort: 9050, bridges: "off", ownBridges: [], control: false, preset: "standard", bridgesSince: null };

// ── presets ──────────────────────────────────────────────────────────────
// Each one is a few lines of Tor's own options (man torrc), written into TuxCopilot's file.
// None of them makes you anonymous by itself: what you sign in to, and what a program sends
// about you, still tell. For the web, Tor Browser is the right tool.

export interface PresetInfo {
  id: Preset;
  label: string;
  what: string; // in plain words
  changes: string[]; // what it sets, said plainly
  caution: string | null;
}

export const PRESETS: PresetInfo[] = [
  {
    id: "standard",
    label: "Standard",
    what: "Tor as it comes: programs you send through it (torsocks, a browser set to use it) reach the Tor network.",
    changes: ["nothing beyond Tor's own defaults"],
    caution: null,
  },
  {
    id: "secure",
    label: "Secure",
    what: "Each website gets its own path through Tor, so the sites you visit can't be linked by sharing one; Tor writes less to disk.",
    changes: ["stream isolation by destination (IsolateDestAddr, IsolateDestPort)", "fewer disk writes (AvoidDiskWrites)", "never relays for others (ClientOnly)"],
    caution: null,
  },
  {
    id: "ghost",
    label: "Ghost",
    what: "The strictest Tor for the programs you send through it: Secure, and Tor refuses requests that could leak where you are going, pads its traffic against analysis, changes paths more often, and hides from your network that you use Tor (bridges).",
    changes: [
      "everything in Secure, and isolation by program type (IsolateClientProtocol)",
      "refuses requests that could leak your destination (SafeSocks) — programs that connect by IP address through torsocks are refused, on purpose",
      "padding against traffic analysis (ConnectionPadding)",
      "new paths every 5 minutes instead of 10 (MaxCircuitDirtiness 300)",
      "bridges on (Snowflake unless you choose others): your network can't tell you use Tor",
    ],
    caution: "Slower, and some programs refuse to work with it. That is the price of strict.",
  },
  {
    id: "shadow",
    label: "Shadow",
    what: "The whole computer through Tor: every program's connections go through Tor, or are stopped. Nothing leaves this computer outside Tor.",
    changes: [
      "everything in Secure",
      "Tor's transparent proxy and DNS (TransPort 9040, DNSPort 5353)",
      "firewall rules that send all connections into Tor and stop everything else: other UDP, IPv6, the local network",
      "fails closed: if Tor stops, the internet stops — nothing leaks",
    ],
    caution:
      "The riskiest: your local network (printers, other computers) is out of reach, time sync stops, and programs that need UDP (calls, games) stop working. A restart turns Shadow off — always a way back.",
  },
];

const PRESET_LINES: Record<Preset, string[]> = {
  standard: [],
  secure: ["AvoidDiskWrites 1", "ClientOnly 1"],
  ghost: ["AvoidDiskWrites 1", "ClientOnly 1", "SafeSocks 1", "ConnectionPadding 1", "MaxCircuitDirtiness 300"],
  shadow: [
    "AvoidDiskWrites 1",
    "ClientOnly 1",
    "VirtualAddrNetworkIPv4 10.192.0.0/10",
    "AutomapHostsOnResolve 1",
    "TransPort 127.0.0.1:9040 IsolateClientAddr IsolateDestAddr IsolateDestPort",
    "DNSPort 127.0.0.1:5353",
  ],
};

const SOCKS_FLAGS: Record<Preset, string> = {
  standard: "",
  secure: " IsolateDestAddr IsolateDestPort",
  ghost: " IsolateDestAddr IsolateDestPort IsolateClientProtocol",
  shadow: " IsolateDestAddr IsolateDestPort",
};

/** Fluff recommends new bridges after this many days (and whenever Tor gets stuck or strange). */
export const BRIDGE_DAYS = 30;

export function bridgesAge(since: string | null, today = new Date()): number | null {
  if (!since || !/^\d{4}-\d{2}-\d{2}$/.test(since)) return null;
  return Math.floor((today.getTime() - new Date(`${since}T00:00:00Z`).getTime()) / 86_400_000);
}

// ── Shadow: the firewall side ────────────────────────────────────────────
// Rules of TuxCopilot's own (nftables tables "tuxcopilot_shadow"), beside firewalld's:
// TCP goes to Tor's TransPort, DNS to its DNSPort, Tor itself goes out, and everything else is
// refused — other UDP, IPv6, the local network. Loaded by a systemd unit that is started, not
// enabled: a restart always turns Shadow off. Tested in a private network namespace: TCP and
// DNS arrive at Tor's ports; NTP and IPv6 are refused.

export const SHADOW_UNIT = "tuxcopilot-shadow.service";
export const SHADOW_RULES = `# TuxCopilot Shadow: the whole computer through Tor. Every connection goes through Tor or
# not at all. Removed by: sudo systemctl stop ${SHADOW_UNIT} (or a restart).
table ip tuxcopilot_shadow {}
delete table ip tuxcopilot_shadow
table ip6 tuxcopilot_shadow {}
delete table ip6 tuxcopilot_shadow

table ip tuxcopilot_shadow {
	chain nat_out {
		type nat hook output priority -100; policy accept;
		meta skuid "tor" return
		ip daddr 127.0.0.0/8 return
		udp dport 53 redirect to :5353
		ip protocol tcp redirect to :9040
	}
	chain filter_out {
		type filter hook output priority 0; policy drop;
		oifname "lo" accept
		ip daddr 127.0.0.0/8 accept
		meta skuid "tor" accept
		udp sport 68 udp dport 67 accept comment "DHCP: keep the network address"
		reject with icmp type admin-prohibited
	}
}

table ip6 tuxcopilot_shadow {
	chain filter_out {
		type filter hook output priority 0; policy drop;
		oifname "lo" accept
		meta skuid "tor" accept
		icmpv6 type { nd-neighbor-solicit, nd-neighbor-advert, nd-router-solicit } accept comment "IPv6 neighbours: the local link only"
		reject with icmpv6 type admin-prohibited
	}
}
`;

export const SHADOW_SERVICE = `[Unit]
Description=TuxCopilot Shadow: the whole computer through Tor
After=tor.service network-online.target
Wants=tor.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/bin/nft -f /etc/tuxcopilot/shadow.nft
ExecStop=-/usr/bin/nft delete table ip tuxcopilot_shadow
ExecStop=-/usr/bin/nft delete table ip6 tuxcopilot_shadow
`;

function b64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/** Shadow on: the rules and the unit written (as base64, so every character is safe), started, then checked. */
export const shadowOnCommand = () =>
  [
    `{ command -v nft >/dev/null || sudo pacman -Syu --needed nftables; }`,
    `sudo install -d -m 755 /etc/tuxcopilot`,
    `printf '%s' '${b64(SHADOW_RULES)}' | base64 -d | sudo tee /etc/tuxcopilot/shadow.nft >/dev/null`,
    `printf '%s' '${b64(SHADOW_SERVICE)}' | base64 -d | sudo tee /etc/systemd/system/${SHADOW_UNIT} >/dev/null`,
    `sudo systemctl daemon-reload`,
    `sudo systemctl start ${SHADOW_UNIT}`,
    `echo "Shadow is on. Checking: this asks check.torproject.org directly — through Shadow it must answer IsTor:true."`,
    `sleep 2; curl -s --max-time 60 https://check.torproject.org/api/ip; echo`,
  ].join(" && ");

export const SHADOW_OFF = `sudo systemctl stop ${SHADOW_UNIT} && echo "Shadow is off: connections go out directly again."`;

/** Through Shadow, a plain request (no SOCKS) must come back IsTor:true. */
export const SHADOW_CHECK = "curl -s --max-time 60 https://check.torproject.org/api/ip; echo";

const TRANSPORTS = ["obfs4", "snowflake", "webtunnel", "meek_lite"];

/** A bridge line as pasted: "Bridge " in front is dropped; anything odd is refused. */
export function cleanBridge(line: string): string | null {
  const l = line.trim().replace(/^Bridge\s+/i, "");
  if (!l || l.startsWith("#")) return null;
  if (/['"\\`$;|&<>]/.test(l)) return null;
  const first = l.split(/\s+/)[0];
  const plain = /^\[?[0-9a-fA-F.:]+\]?:\d+$/.test(first);
  return TRANSPORTS.includes(first) || plain ? l.replace(/\s+/g, " ") : null;
}

export function renderConf(s: TorSettings, b: Builtins): { text: string; problems: string[] } {
  const problems: string[] = [];
  const lines = [
    "# Written by TuxCopilot. Remove this file to go back to the settings in torrc alone.",
    `# TuxCopilot preset: ${s.preset}`,
    `SocksPort ${s.socksPort}${SOCKS_FLAGS[s.preset]}`,
    ...PRESET_LINES[s.preset],
  ];
  if (s.control) {
    lines.push("ControlPort 9051", "CookieAuthentication 1", "CookieAuthFileGroupReadable 1", "DataDirectoryGroupReadable 1");
  }
  const bridgeLines =
    s.bridges === "own"
      ? s.ownBridges.map(cleanBridge).filter((x): x is string => x !== null)
      : s.bridges === "off"
        ? []
        : b.bridges[s.bridges] ?? [];
  if (s.bridges !== "off") {
    if (bridgeLines.length === 0) {
      problems.push(
        s.bridges === "own"
          ? "No usable bridge lines. Paste them as bridges.torproject.org gives them."
          : "The Tor Project's built-in bridges could not be fetched. Get bridges from https://bridges.torproject.org (or the Telegram bot @GetBridgesBot) and use “My own bridges”.",
      );
    } else {
      if (s.bridgesSince) lines.push(`# Bridges since: ${s.bridgesSince}`);
      lines.push("UseBridges 1");
      const transports = [...new Set(bridgeLines.map((l) => l.split(" ")[0]).filter((t) => TRANSPORTS.includes(t)))];
      for (const t of transports) {
        const p = pluginLine(t, b.plugins);
        if (p && !lines.includes(p)) lines.push(p);
      }
      for (const l of bridgeLines) lines.push(`Bridge ${l}`);
    }
  }
  return { text: lines.join("\n") + "\n", problems };
}

/** Read TuxCopilot's own file back into the form. */
export function parseConf(text: string | null): TorSettings {
  if (!text) return { ...DEFAULTS };
  const get = (k: string) => text.match(new RegExp(`^${k}\\s+(.+)$`, "m"))?.[1]?.trim();
  const bridges = [...text.matchAll(/^Bridge\s+(.+)$/gm)].map((m) => m[1].trim());
  const kind: BridgeMode = !/^UseBridges\s+1/m.test(text)
    ? "off"
    : bridges.every((l) => l.startsWith("snowflake "))
      ? "snowflake"
      : "own";
  const preset = text.match(/^# TuxCopilot preset: (\w+)$/m)?.[1] as Preset | undefined;
  return {
    socksPort: Number(get("SocksPort")?.split(/\s+/)[0]) || DEFAULTS.socksPort,
    bridges: kind,
    ownBridges: kind === "own" ? bridges : [],
    control: /^ControlPort\s/m.test(text),
    preset: preset && PRESET_LINES[preset] ? preset : "standard",
    bridgesSince: text.match(/^# Bridges since: (\d{4}-\d{2}-\d{2})$/m)?.[1] ?? null,
  };
}

/**
 * Save: back up the old file, write the new one, make sure torrc includes it, and have Tor
 * check the whole configuration. If Tor refuses it, the previous file is put back.
 */
export function saveCommand(text: string): string {
  const lines = text.trimEnd().split("\n");
  if (lines.some((l) => l.includes("'"))) throw new Error("a setting contains a quote");
  return [
    "sudo install -d -m 755 /etc/tor/torrc.d",
    `{ [ ! -f ${CONF} ] || sudo cp ${CONF} ${CONF}.bak; }`,
    `printf '%s\\n' ${lines.map((l) => `'${l}'`).join(" ")} | sudo tee ${CONF} >/dev/null`,
    `{ grep -qxF '${INCLUDE}' /etc/tor/torrc || echo '${INCLUDE}' | sudo tee -a /etc/tor/torrc >/dev/null; }`,
    `if sudo tor --verify-config -f /etc/tor/torrc >/dev/null; then sudo systemctl reload-or-restart tor.service && echo "Tor took the new settings."; else echo "Tor refused these settings — the previous ones are back."; if [ -f ${CONF}.bak ]; then sudo mv ${CONF}.bak ${CONF}; else sudo rm -f ${CONF}; fi; exit 1; fi`,
  ].join(" && ");
}

export const UNDO_SETTINGS = `sudo rm -f ${CONF} ${CONF}.bak && sudo systemctl reload-or-restart tor.service`;

// ── state ────────────────────────────────────────────────────────────────

export interface TorTool {
  pkg: string;
  name: string;
  what: string;
  how: string;
  aur: boolean;
  installed: boolean;
}

export interface TorState {
  version: string | null; // null: not installed
  active: boolean;
  enabled: string; // enabled / disabled / not-found / ""
  bootstrap: { percent: number; summary: string } | null; // from Tor's log, this run
  settings: TorSettings;
  confText: string | null;
  included: boolean; // torrc includes torrc.d
  tools: TorTool[];
  inTorGroup: boolean;
  journal: string;
  shadowOn: boolean; // Shadow's firewall rules are loaded now
}

const TOOLS: Array<Omit<TorTool, "installed">> = [
  { pkg: "torbrowser-launcher", name: "Tor Browser", what: "the browser for Tor. It has its own Tor inside and does not need the service", how: "open “Tor Browser” from your menu; the first start downloads and checks the browser", aur: false },
  { pkg: "torsocks", name: "torsocks", what: "sends any terminal program through the Tor service", how: "put torsocks in front of a command: torsocks curl https://example.com", aur: false },
  { pkg: "nyx", name: "nyx", what: "watches the Tor service live: bandwidth, connections, log", how: "turn on “Let nyx watch Tor” below, then run nyx in a terminal", aur: false },
  { pkg: "lyrebird-proxy", name: "lyrebird", what: "the bridge program (snowflake, obfs4, webtunnel) for networks that block Tor", how: "used by Tor by itself once Bridges are on", aur: true },
];

/** The last "Bootstrapped N% (tag): summary" since Tor last started. */
export function lastBootstrap(journal: string): { percent: number; summary: string } | null {
  const lines = journal.split("\n");
  let start = 0;
  lines.forEach((l, i) => {
    if (/Tor .* opening (new )?log file|Starting Tor|Started Anonymizing overlay network/i.test(l)) start = i;
  });
  let found: { percent: number; summary: string } | null = null;
  for (const l of lines.slice(start)) {
    const m = l.match(/Bootstrapped (\d+)%(?: \([\w_]+\))?: (.*)$/);
    if (m) found = { percent: Number(m[1]), summary: m[2].trim() };
  }
  return found;
}

export function parseTorVersion(out: string): string | null {
  return out.match(/Tor version (\d+(?:\.\d+)+(?:-[\w]+)?)/)?.[1] ?? null;
}

export async function torState(): Promise<TorState> {
  const [vOut, act, en, journal, conf, torrc, pkgs, groups, shadow] = await Promise.all([
    execOut("tor", ["--version"]),
    execOut("systemctl", ["is-active", "tor.service"]),
    execOut("systemctl", ["is-enabled", "tor.service"]),
    execOut("journalctl", ["-u", "tor.service", "-n", "300", "--no-pager", "-o", "short-iso"]),
    readText("/etc/tor/torrc.d/tuxcopilot.conf"),
    readText("/etc/tor/torrc"),
    execOut("pacman", ["-Qq"]),
    execOut("id", ["-nG"]),
    execOut("systemctl", ["is-active", "tuxcopilot-shadow.service"]),
  ]);
  const have = new Set((pkgs ?? "").split("\n").map((l) => l.trim()));
  const j = journal ?? "";
  return {
    version: vOut === null ? null : (parseTorVersion(vOut) ?? "installed"),
    active: act?.trim() === "active",
    enabled: en?.trim() ?? "",
    bootstrap: lastBootstrap(j),
    settings: parseConf(conf),
    confText: conf,
    included: (torrc ?? "").split("\n").some((l) => l.trim() === INCLUDE),
    tools: TOOLS.map((t) => ({ ...t, installed: have.has(t.pkg) })),
    inTorGroup: (groups ?? "").split(/\s+/).includes("tor"),
    journal: j,
    shadowOn: shadow?.trim() === "active",
  };
}

export function installCommand(t: Pick<TorTool, "pkg" | "aur">): string {
  return t.aur ? `yay -Syu --needed --noconfirm ${t.pkg}` : `sudo pacman -Syu --needed --noconfirm ${t.pkg}`;
}

export const TOR_SETUP = "sudo pacman -Syu --needed --noconfirm tor && sudo systemctl enable --now tor.service";
export const checkCommand = (port: number) =>
  `curl -s --max-time 60 --socks5-hostname 127.0.0.1:${port} https://check.torproject.org/api/ip`;

// ── troubleshoot ─────────────────────────────────────────────────────────

export function diagnoseTorFrom(st: TorState): Diagnosis {
  const checks: Check[] = [];
  const fix = (label: string, command: string, note: string): Fix => ({ label, command, note });
  const installed = st.version !== null;
  checks.push({
    id: "installed", label: "Tor is installed", ok: installed,
    detail: installed ? `Tor ${st.version}` : "the tor program is missing",
    fix: installed ? undefined : fix("Install Tor", TOR_SETUP, "Tor from the official repos, started now and at every boot"),
  });
  checks.push({
    id: "service", label: "The Tor service is running", ok: installed ? st.active : null,
    detail: st.active ? `running${st.enabled === "enabled" ? ", and starts at boot" : " (not at boot)"}` : "the service is stopped",
    fix: installed && (!st.active || st.enabled !== "enabled") ? fix(st.active ? "Start at boot" : "Start Tor", "sudo systemctl enable --now tor.service", "starts it now and at every boot") : undefined,
  });
  const j = st.journal;
  const recent = j.split("\n").slice(-120).join("\n");
  const pct = st.bootstrap?.percent ?? 0;
  const connected = st.active && pct === 100;
  checks.push({
    id: "connected", label: "Tor reached its network", ok: st.active ? connected : null,
    detail: connected
      ? "connected (bootstrapped 100%)"
      : st.bootstrap
        ? `stuck at ${pct}%: ${st.bootstrap.summary}. ${st.settings.bridges === "off" ? "If your network blocks Tor, turn on Bridges below — Snowflake works almost everywhere." : "The bridges may be blocked or gone too: try the other kind, or fresh ones."}`
        : "no progress in its log yet — give it a minute, then check again",
  });
  if (/clock skew|Our clock is|clock.*(behind|ahead)/i.test(recent)) {
    checks.push({
      id: "clock", label: "Your clock is right", ok: false,
      detail: "Tor says your computer's clock is off; Tor refuses its network when the time is wrong",
      fix: fix("Fix the clock", "sudo timedatectl set-ntp true", "sets the time from the internet, now and from now on"),
    });
  }
  if (/Address already in use/i.test(recent)) {
    checks.push({
      id: "port", label: `Port ${st.settings.socksPort} is free`, ok: false,
      detail: "another program already listens there — usually a second Tor. (Tor Browser uses 9150, so it is not the browser.) Pick another SOCKS port below, or stop the other one.",
    });
  }
  const needsLyrebird = st.settings.bridges !== "off";
  const lyre = st.tools.find((t) => t.pkg === "lyrebird-proxy");
  if (needsLyrebird) {
    checks.push({
      id: "transport", label: "The bridge program is installed", ok: !!lyre?.installed,
      detail: lyre?.installed ? "lyrebird is there" : "Bridges are on, but lyrebird (which talks to them) is missing — Tor can't connect",
      fix: lyre && !lyre.installed ? fix("Install lyrebird", installCommand(lyre), "from the AUR") : undefined,
    });
  }
  if (st.settings.control) {
    checks.push({
      id: "group", label: "nyx may read Tor's control cookie", ok: st.inTorGroup,
      detail: st.inTorGroup ? "you are in the tor group" : "you are not in the tor group, so nyx says “permission denied”",
      fix: st.inTorGroup ? undefined : fix("Add me to the tor group", "sudo usermod -aG tor $USER", "takes effect after you log out and back in"),
    });
  }
  if (st.confText && !st.included) {
    checks.push({
      id: "include", label: "Tor reads TuxCopilot's settings", ok: false,
      detail: `${CONF} exists, but /etc/tor/torrc does not include it (a Tor update may have replaced torrc)`,
      fix: fix("Include them again", `{ grep -qxF '${INCLUDE}' /etc/tor/torrc || echo '${INCLUDE}' | sudo tee -a /etc/tor/torrc >/dev/null; } && sudo systemctl reload-or-restart tor.service`, "adds the one include line back to torrc"),
    });
  }
  return {
    checks,
    errors: errorLines(j, /\[(warn|err)\]/i),
    resets: !installed ? [] : [
      fix("Restart Tor", "sudo systemctl restart tor.service", "stops and starts it; it reconnects by itself"),
      fix("Fresh start", "sudo systemctl stop tor.service && sudo find /var/lib/tor -maxdepth 1 -name 'cached-*' -delete && sudo systemctl start tor.service", "throws away Tor's downloaded copy of the network list (it fetches a fresh one) — fixes a damaged cache. Keys and onion services are kept."),
      ...(st.confText ? [fix("Undo TuxCopilot's Tor settings", UNDO_SETTINGS, "removes only TuxCopilot's file; your own torrc is left as it is")] : []),
    ],
  };
}

export async function diagnoseTor(): Promise<Diagnosis> {
  return diagnoseTorFrom(await torState());
}
