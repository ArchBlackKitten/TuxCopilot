// The Firewall section: what the firewall lets in, in plain words, and what Fluff recommends
// for someone who just installed Arch — turn one on (Arch turns none on by itself), close what
// nothing on this computer uses, open what an installed app needs, the right zone for the
// network. Read from firewalld's files (firewall.rs), so opening the section asks for no
// password; each change is a command, shown first, that asks for it.

import { inv } from "./host";
import { q } from "./docker";
import type { Service } from "./services";

export interface Zone {
  name: string;
  short: string;
  description: string;
  default: boolean;
  target: string;
  connections: string[];
  services: string[];
  ports: string[];
  masquerade: boolean;
  changed: boolean;
}

export interface FirewallState {
  firewalldInstalled: boolean;
  firewalldOn: boolean;
  ufwInstalled: boolean;
  ufwOn: boolean;
  defaultZone: string | null;
  zones: Zone[];
  servicePorts: Array<[string, string, string[]]>; // service, its name, the ports it opens
  networks: Network[]; // NetworkManager's active connections
  presetZones: Zone[]; // public, home and drop as they are now, in use or not
}

export interface Network {
  name: string;
  uuid: string;
  device: string;
  kind: string;
  zone: string; // "" = the default zone
}

export const firewallState = () => inv<FirewallState>("firewall_state");

/** What letting a service in means, for a beginner. */
export const SERVICE_WORDS: Record<string, string> = {
  ssh: "other computers can log into this one with SSH",
  "dhcpv6-client": "your network can give this computer an IPv6 address (needed on many networks)",
  "dhcp": "your network can give this computer an address",
  mdns: "other devices can find this one by name on your network (printers, phones)",
  "samba-client": "you can open shared folders on other computers",
  samba: "other computers can open folders this one shares",
  kdeconnect: "KDE Connect (or GSConnect) can reach your phone",
  syncthing: "Syncthing can sync with your other devices",
  "steam-streaming": "Steam can stream games to your other devices",
  "ipp-client": "you can find network printers",
  ipp: "other computers can print to printers this one shares",
  http: "other computers can open a website this one serves (port 80)",
  https: "other computers can open a secure website this one serves (port 443)",
  cockpit: "Cockpit's web page can be opened from other computers",
};
export const serviceWords = (s: string) => SERVICE_WORDS[s] ?? `the ${s} service can be reached from other computers`;

/** What each zone is for. */
export const ZONE_WORDS: Record<string, string> = {
  public: "for networks you don't trust (cafés, hotels, school): only what you allow gets in",
  home: "for your home network: a little more is allowed (finding devices, shared folders)",
  work: "for a work network you mostly trust",
  internal: "for a network inside one you control",
  trusted: "everything is allowed in — only for a network you fully trust",
  block: "everything coming in is refused, with a reply",
  drop: "everything coming in is dropped silently",
  docker: "Docker's own networks: Docker looks after this zone",
  libvirt: "virtual machines' networks: libvirt looks after this zone",
};

/** What each part of the firewall means, for someone who just installed Arch. */
export const FIREWALL_WORDS: Array<{ term: string; words: string }> = [
  { term: "Firewall", words: "Decides what other computers may reach on this one. Going out (websites, updates, games) is never blocked by it; coming in is allowed only for what you let in." },
  { term: "Coming in, going out", words: "Answers to what this computer asked for (a web page, a download) always come back in. What the firewall stops is others starting a conversation with this computer." },
  { term: "Zone", words: "A set of rules with a name: public, home, drop… Each network (your Wi-Fi, a cable) uses one zone, so the same laptop can be closed at a café and a little more open at home." },
  { term: "Default zone", words: "The zone every network uses unless it has chosen its own — what Fluff's settings set." },
  { term: "Service (a door)", words: "A named door for one kind of program, e.g. ssh opens port 22 for the SSH server. Letting a service in opens its ports in that zone." },
  { term: "Port", words: "A numbered door: programs that wait for others listen on a port (a website on 443, SSH on 22). A port opened by number is a door without a name." },
  { term: "Target", words: "What happens to what no rule lets in. default and REJECT: refused, with a reply. DROP: dropped without a word, so this computer looks absent. ACCEPT: everything let in — only for networks you fully trust." },
  { term: "Ping", words: "A tiny \u201care you there?\u201d. Most zones answer it; Stealth (drop) doesn't, which is how it stays invisible." },
  { term: "Masquerade and forwarding", words: "This computer passing other computers' traffic on — sharing its connection, virtual machines, Docker. Off unless something here needs it." },
  { term: "Saved, and for now", words: "A change can last until a restart (for now) or be saved (permanent). Every change here is saved, then applied at once (--reload)." },
  { term: "firewalld", words: "The firewall program TuxCopilot understands best; it keeps its rules in /etc/firewalld. ufw is another; only one should be on." },
];

/** A zone's target in a sentence. */
export const targetWords = (t: string) =>
  t === "ACCEPT"
    ? "lets everything in"
    : t === "DROP"
      ? "drops everything else without a word — to others this computer isn't there"
      : t === "%%REJECT%%" || t === "REJECT" || t === "default"
        ? "refuses everything else, with a reply"
        : `does \u201c${t}\u201d with everything else`;

/** Installed apps that need a door opened to work across the network. */
export const APP_NEEDS: Array<{ app: string; service: string; why: string }> = [
  { app: "kdeconnect", service: "kdeconnect", why: "KDE Connect can't find your phone until it is let in" },
  { app: "gnome-shell-extension-gsconnect", service: "kdeconnect", why: "GSConnect can't find your phone until it is let in" },
  { app: "syncthing", service: "syncthing", why: "Syncthing can't reach your other devices until it is let in" },
  { app: "steam", service: "steam-streaming", why: "Steam can't stream to your other devices until it is let in (only if you use Remote Play)" },
];

const zoneOk = (z: string) => {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(z)) throw new Error(`not a zone name: ${z}`);
  return z;
};
const serviceOk = (s: string) => {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(s)) throw new Error(`not a service name: ${s}`);
  return s;
};

// Every command ends by checking, as root, that the firewall now is what it said — or it fails, out
// loud: no gap left, no error masked. The answer printed is what counts: a query says "yes" or
// "no" (and exits 1 for "no", so its exit code can't be the test); a command that failed prints
// nothing there, so a check that can't ask firewalld fails too.
const fwSays = (what: string, cmd: string, want: string) => `{ r=$(${cmd}); [ "$r" = ${want} ] || { echo "Fluff: ${what}" >&2; false; }; }`;
export const FIREWALLD_ON = `sudo systemctl enable --now firewalld.service && ${fwSays("firewalld didn't start.", "sudo firewall-cmd --state", "running")}`;
export const FIREWALLD_INSTALL = `sudo pacman -Syu --needed firewalld && ${FIREWALLD_ON}`;
const stopped = (unit: string, name: string) => `{ ! systemctl is-active -q ${unit} || { echo "Fluff: ${name} is still running." >&2; false; }; }`;
export const UFW_OFF = `sudo systemctl disable --now ufw.service && ${stopped("ufw.service", "ufw")}`;
export const FIREWALLD_OFF = `sudo systemctl disable --now firewalld.service && ${stopped("firewalld.service", "firewalld")}`;
const query = (zone: string, service: string, want: "yes" | "no", permanent: boolean) =>
  fwSays(`${service} is ${want === "yes" ? "still not let in" : "still open"} in ${zone}${permanent ? " from the next start" : ""}.`, `sudo firewall-cmd${permanent ? " --permanent" : ""} --zone=${q(zone)} --query-service=${q(service)}`, want);
/** Close a service in a zone, now and from the next start. */
export const closeCommand = (zone: string, service: string) =>
  `sudo firewall-cmd --permanent --zone=${q(zoneOk(zone))} --remove-service=${q(serviceOk(service))} && sudo firewall-cmd --reload && ${query(zone, service, "no", false)} && ${query(zone, service, "no", true)}`;
/** Let a service in, now and from the next start. */
export const openCommand = (zone: string, service: string) =>
  `sudo firewall-cmd --permanent --zone=${q(zoneOk(zone))} --add-service=${q(serviceOk(service))} && sudo firewall-cmd --reload && ${query(zone, service, "yes", false)} && ${query(zone, service, "yes", true)}`;
const defaultIs = (zone: string) => fwSays(`the default zone isn't ${zone}.`, "sudo firewall-cmd --get-default-zone", q(zone));
export const defaultZoneCommand = (zone: string) => `was=$(sudo firewall-cmd --get-default-zone) && sudo firewall-cmd --set-default-zone=${q(zoneOk(zone))} && ${defaultIs(zone)} && ${SAID_BACK}`;
// after a default zone changed: what it was, the way back, and the networks that keep their own zone
const SAID_BACK = `echo "Fluff: the default zone was $was. Networks with a zone of their own keep it — the zones in use now:" && sudo firewall-cmd --get-active-zones && echo "To go back: sudo firewall-cmd --set-default-zone=$was"`;

// ── Fluff's settings (presets) ───────────────────────────────────────────
// Like Tor's presets: each is one of firewalld's own zones, set up the way Fluff recommends,
// said in plain words with what it changes and what it costs. Going out (websites, updates) is
// never blocked by any of them; they decide what may come in.

export type FwPreset = "public" | "home" | "drop";

export interface FwPresetInfo {
  id: FwPreset;
  label: string;
  what: string;
  lets: string; // what gets in, in plain words
  caution: string | null;
}

export const FW_PRESETS: FwPresetInfo[] = [
  {
    id: "public",
    label: "Out and about",
    what: "Safe on any network — a café, school, a hotel, and home too. Other computers can't reach anything on this one; only answers to what this computer asked for come in.",
    lets: "only what your network needs to give this computer an address (IPv6)",
    caution: null,
  },
  {
    id: "home",
    label: "Home",
    what: "For your own network: your devices can find each other (printers, phones, shared folders), and the apps you installed that need a door get one (KDE Connect, Syncthing, Steam streaming).",
    lets: "finding devices by name, opening shared folders on other computers, and the doors your installed apps need",
    caution: "Use it only on a network you trust: anyone on it can see this computer is there.",
  },
  {
    id: "drop",
    label: "Stealth",
    what: "Nothing that comes in is answered, not even a ping, so other computers on the network can't reach this one. What you open (websites, updates) still works — and it still shows itself by what it sends.",
    lets: "nothing — only answers to what this computer asked for",
    caution: "Your phone (KDE Connect), Syncthing, casting, and games on your network can't find this computer; an IPv6 address from a DHCPv6 server may not come.",
  },
];

/** The doors a preset opens: `sshServer` keeps SSH open (a server runs here); `apps`: installed packages. */
export function presetServices(p: FwPreset, sshServer: boolean, apps: Set<string>): string[] {
  const out =
    p === "public" ? ["dhcpv6-client"] : p === "home" ? ["dhcpv6-client", "mdns", "samba-client", ...APP_NEEDS.filter((n) => apps.has(n.app)).map((n) => n.service)] : [];
  if (sshServer && p !== "drop") out.push("ssh");
  return [...new Set(out)].sort();
}

/** What a preset's zone does with what comes in that nothing lets in: Stealth drops it, unanswered. */
export const PRESET_TARGET: Record<FwPreset, string> = { public: "default", home: "default", drop: "DROP" };

const portOk = (p: string) => {
  if (!/^\d{1,5}(-\d{1,5})?\/(tcp|udp|sctp|dccp)$/.test(p)) throw new Error(`not a port: ${p}`);
  return p;
};

/** The preset the default zone is now, or null: your own settings. */
export function currentPreset(f: FirewallState, sshServer: boolean, apps: Set<string>): FwPreset | null {
  const z = f.presetZones.find((x) => x.default);
  if (!z || z.ports.length || !(z.name in PRESET_TARGET) || z.target !== PRESET_TARGET[z.name as FwPreset]) return null;
  const want = presetServices(z.name as FwPreset, sshServer, apps);
  return JSON.stringify([...z.services].sort()) === JSON.stringify(want) ? (z.name as FwPreset) : null;
}

/** What choosing a preset opens and closes in its zone: services, ports opened by hand, and what it does with the rest. */
export function presetChanges(f: FirewallState, p: FwPreset, sshServer: boolean, apps: Set<string>): { opens: string[]; closes: string[]; closesPorts: string[]; target: string | null } {
  const z = f.presetZones.find((x) => x.name === p);
  const now = z?.services ?? [];
  const want = presetServices(p, sshServer, apps);
  return {
    opens: want.filter((s) => !now.includes(s)),
    closes: now.filter((s) => !want.includes(s)),
    closesPorts: z?.ports ?? [],
    target: z && z.target !== PRESET_TARGET[p] ? PRESET_TARGET[p] : null,
  };
}

/** After a preset, as root: the zone is the default, lets in exactly its services (now and from the
 *  next start), no port, and does with the rest what the preset says — or the command fails. */
function presetCheck(p: FwPreset, want: string[]): string {
  const z = q(p);
  // firewalld's answer first (its own exit code counts), then sorted: a pipe would hide a failure
  const list = (v: string, permanent: boolean) => `${v}=$(sudo firewall-cmd${permanent ? " --permanent" : ""} --zone=${z} --list-services) && [ "$(printf '%s\\n' $${v} | sort | xargs)" = "${want.join(" ")}" ]`;
  return [
    "{ bad=",
    `[ "$(sudo firewall-cmd --get-default-zone)" = ${z} ] || bad="$bad default-zone"`,
    `${list("now", false)} || bad="$bad services-now"`,
    `${list("saved", true)} || bad="$bad services-from-the-next-start"`,
    `ports=$(sudo firewall-cmd --zone=${z} --list-ports) && [ -z "$ports" ] || bad="$bad ports"`,
    `t=$(sudo firewall-cmd --permanent --zone=${z} --get-target) && [ "$t" = ${PRESET_TARGET[p]} ] || bad="$bad target"`,
    `[ -z "$bad" ] || { echo "Fluff: the firewall isn't as “${FW_PRESETS.find((x) => x.id === p)!.label}” says:$bad" >&2; false; }; }`,
  ].join("; ");
}

/** Choosing a preset: its zone set up (saved, then applied), made the default for every network
 *  without a zone of its own, and checked; it says the zone it replaced, and the way back. */
export function presetCommand(f: FirewallState, p: FwPreset, sshServer: boolean, apps: Set<string>): string {
  const { opens, closes, closesPorts, target } = presetChanges(f, p, sshServer, apps);
  const z = q(zoneOk(p));
  const edits = [...closes.map((s) => `--remove-service=${q(serviceOk(s))}`), ...opens.map((s) => `--add-service=${q(serviceOk(s))}`)];
  const saved = [
    ...(edits.length ? [`sudo firewall-cmd --permanent --zone=${z} ${edits.join(" ")}`] : []),
    ...(closesPorts.length ? [`sudo firewall-cmd --permanent --zone=${z} ${closesPorts.map((x) => `--remove-port=${q(portOk(x))}`).join(" ")}`] : []),
    ...(target ? [`sudo firewall-cmd --permanent --zone=${z} --set-target=${target}`] : []),
  ];
  return [
    "was=$(sudo firewall-cmd --get-default-zone)",
    ...(saved.length ? [...saved, "sudo firewall-cmd --reload"] : []),
    `sudo firewall-cmd --set-default-zone=${z}`,
    presetCheck(p, presetServices(p, sshServer, apps)),
    `sudo firewall-cmd --zone=${z} --list-all`, // everything it does now, rules Fluff didn't write included
    SAID_BACK,
  ].join(" && ");
}

const uuidOk = (u: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(u)) throw new Error(`not a connection id: ${u}`);
  return u;
};
const deviceOk = (d: string) => {
  if (!/^[\w.@:-]{1,32}$/.test(d)) throw new Error(`not a device name: ${d}`);
  return d;
};

/** One network uses a zone of its own ("" = the default, Fluff's preset), saved by NetworkManager and applied at once. */
export const networkZoneCommand = (n: Network, zone: string) =>
  `sudo nmcli connection modify ${uuidOk(n.uuid)} connection.zone ${zone ? q(zoneOk(zone)) : '""'} && sudo nmcli device reapply ${q(deviceOk(n.device))} && ${fwSays(`${n.name.replace(/["'`$\\]/g, "")} doesn't use ${zone || "the default zone"}.`, `nmcli -g connection.zone connection show ${uuidOk(n.uuid)}`, zone ? q(zone) : '""')}`;

/** Networks a person chooses a zone for: Wi-Fi and cable — not VPNs and their kill switches, Docker's, libvirt's or the loopback. */
export const choosableNetworks = (f: FirewallState) =>
  f.networks.filter((n) => !["bridge", "loopback", "tun", "vpn", "wireguard", "dummy"].includes(n.kind) && n.device !== "docker0" && !n.device.startsWith("br-") && !n.device.startsWith("virbr"));

export interface Advice {
  id: string;
  level: "ok" | "info" | "warn" | "bad";
  title: string;
  detail: string;
  fix?: { label: string; command: string };
}

/** What Fluff recommends, worst first. `services`: systemd's services; `apps`: installed package names. */
export function advice(f: FirewallState, services: Service[] | null, apps: Set<string>): Advice[] {
  const out: Advice[] = [];
  if (!f.firewalldOn && !f.ufwOn) {
    out.push({
      id: "off",
      level: "bad",
      title: "No firewall is on",
      detail: "Arch turns none on by itself. A firewall keeps other computers on your network from reaching programs that listen on this one. firewalld is the one TuxCopilot understands best.",
      fix: f.firewalldInstalled ? { label: "Turn on firewalld", command: FIREWALLD_ON } : { label: "Install and turn on firewalld", command: FIREWALLD_INSTALL },
    });
    return out;
  }
  if (f.firewalldOn && f.ufwOn)
    out.push({ id: "both", level: "warn", title: "Two firewalls are on: firewalld and ufw", detail: "They fight over the same rules, and it is hard to tell what gets in. Keep one: Fluff recommends firewalld, so ufw goes off.", fix: { label: "Turn ufw off", command: UFW_OFF } });
  if (!f.firewalldOn) {
    out.push({ id: "ufw", level: "ok", title: "ufw is on", detail: "Its rules need your password to read: sudo ufw status verbose in a terminal shows them." });
    return out;
  }
  const def = f.zones.find((z) => z.default);
  const svc = (name: string) => services?.find((s) => s.name === name);
  const sshd = svc("sshd.service");
  for (const z of f.zones) {
    if (z.services.includes("ssh") && services && (!sshd || (sshd.state !== "running" && sshd.enabled !== "enabled")))
      out.push({
        id: `ssh:${z.name}`,
        level: "warn",
        title: `SSH is let in (${z.name} zone), but no SSH server runs here`,
        detail: "Nothing on this computer uses it, so the door is open for nothing. Fluff recommends closing it; you can open it again if you set up SSH later.",
        fix: { label: "Close SSH", command: closeCommand(z.name, "ssh") },
      });
    if (z.target === "ACCEPT" && !["docker", "libvirt", "libvirt-routed", "trusted"].includes(z.name))
      out.push({ id: `accept:${z.name}`, level: "warn", title: `The ${z.name} zone lets everything in`, detail: "Its target is ACCEPT. Unless you meant that, use a zone like public or home for that network." });
  }
  for (const need of APP_NEEDS)
    if (apps.has(need.app) && def && !f.zones.some((z) => z.services.includes(need.service)))
      out.push({ id: `need:${need.service}`, level: "info", title: `${need.app} is installed`, detail: `${need.why}.`, fix: { label: `Let ${need.service} in`, command: openCommand(def.name, need.service) } });
  if (def)
    out.push({
      id: "zone",
      level: "info",
      title: `Your networks use the ${def.name} zone`,
      detail: `${ZONE_WORDS[def.name] ?? def.description}. ${def.name === "public" ? "That is the safe choice anywhere; on your own home network, home lets devices find each other." : ""}`.trim(),
      fix: def.name === "public" ? undefined : { label: "Use public", command: defaultZoneCommand("public") },
    });
  const rank = { bad: 0, warn: 1, info: 2, ok: 3 } as const;
  out.sort((a, b) => rank[a.level] - rank[b.level]);
  // nothing to fix: that comes first, then the notes
  if (!out.some((a) => a.level === "bad" || a.level === "warn")) out.unshift({ id: "fine", level: "ok", title: "Your firewall looks right", detail: "firewalld is on and lets in only what something here uses." });
  return out;
}
