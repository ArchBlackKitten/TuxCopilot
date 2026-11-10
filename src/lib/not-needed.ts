// "Off if not needed": services that open this computer to others (or listen for them) and that
// many people never use — the SSH server, Bluetooth, printing, network discovery, sharing,
// remote control. Each says what it is, when you need it, and Fluff's advice; Off stops it and
// its socket (which would quietly start it again), On brings both back.

import type { Service } from "./services";

export interface MaybeNotNeeded {
  service: string; // the .service
  also: string[]; // sockets and paths that start it on demand: Off stops them too
  onAlso?: string[]; // what On starts with it (default: `also`)
  label: string;
  what: string;
  needed: string; // when you need it
  advice: string; // Fluff's
}

export const NOT_NEEDED: MaybeNotNeeded[] = [
  {
    service: "sshd.service",
    also: ["sshd.socket"],
    onAlso: [], // sshd.socket and sshd.service both listen on port 22: On starts the service alone
    label: "SSH server",
    what: "Lets other computers log into this one and run commands, with a password or a key.",
    needed: "only if you log into this computer from another one (or it is a server)",
    advice: "Off unless you do. It is the door attackers try most.",
  },
  {
    service: "bluetooth.service",
    also: [],
    label: "Bluetooth",
    what: "Wireless headphones, speakers, mice, keyboards, game controllers, and phones.",
    needed: "if you use any Bluetooth device",
    advice: "Off if you use none: Bluetooth has had flaws that let nearby devices in, and off it saves battery.",
  },
  {
    service: "cups.service",
    also: ["cups.socket", "cups.path"],
    label: "Printing (CUPS)",
    what: "Sends what you print to a printer, and finds printers.",
    needed: "if you print",
    advice: "Off if you never print; turn it on again the day you need it.",
  },
  {
    service: "avahi-daemon.service",
    also: ["avahi-daemon.socket"],
    label: "Network discovery (Avahi)",
    what: "Announces this computer on your network and finds others' printers, shared folders and screens to cast to.",
    needed: "for network printers, casting, and finding shared folders by name",
    advice: "Off if you need none of these: it tells everyone on the network this computer is here.",
  },
  {
    service: "smb.service",
    also: ["nmb.service"],
    label: "Sharing folders (Samba)",
    what: "Lets other computers (Windows, Mac, phones) open folders this one shares.",
    needed: "only if this computer shares folders with others",
    advice: "Off unless you share folders. Opening others' shares works without it.",
  },
  {
    service: "nfs-server.service",
    also: ["rpcbind.service", "rpcbind.socket"],
    label: "Sharing folders (NFS)",
    what: "Shares folders with other Linux computers.",
    needed: "only if this computer is a file server",
    advice: "Off unless it is one.",
  },
  {
    service: "xrdp.service",
    also: ["xrdp-sesman.service"],
    label: "Remote desktop (xrdp)",
    what: "Lets someone see and use this computer's desktop from another computer.",
    needed: "only if you use this computer's desktop from elsewhere",
    advice: "Off unless you do.",
  },
  {
    service: "teamviewerd.service",
    also: [],
    label: "TeamViewer",
    what: "Lets someone with your code control this computer from anywhere.",
    needed: "only while someone is helping you remotely",
    advice: "Off when nobody is helping you: scammers ask people to install it.",
  },
  {
    service: "anydesk.service",
    also: [],
    label: "AnyDesk",
    what: "Lets someone control this computer from anywhere.",
    needed: "only while someone is helping you remotely",
    advice: "Off when nobody is helping you: scammers ask people to install it.",
  },
  {
    service: "httpd.service",
    also: [],
    label: "Web server (Apache)",
    what: "Serves websites from this computer to others.",
    needed: "only if this computer serves a website",
    advice: "Off unless it does.",
  },
  {
    service: "nginx.service",
    also: [],
    label: "Web server (nginx)",
    what: "Serves websites from this computer to others.",
    needed: "only if this computer serves a website",
    advice: "Off unless it does.",
  },
  {
    service: "vsftpd.service",
    also: [],
    label: "FTP server",
    what: "Lets others download and upload files here, often without encryption.",
    needed: "almost never today",
    advice: "Off.",
  },
  {
    service: "ModemManager.service",
    also: [],
    label: "Mobile modems",
    what: "Runs mobile-broadband modems (a SIM card in a laptop or a USB stick).",
    needed: "only with a SIM-card modem",
    advice: "Off if you have none.",
  },
];

/** Is it on: running, or set to start (by itself or by its socket)? */
export const isOn = (s: Pick<Service, "state" | "enabled">) => s.state === "running" || s.state === "dormant" || s.enabled === "enabled";

/** The ones installed here, with their service as systemd has it. */
export function installedNotNeeded(services: Service[]): Array<MaybeNotNeeded & { s: Service }> {
  return NOT_NEEDED.flatMap((n) => {
    const s = services.find((x) => x.name === n.service && !x.user);
    return s ? [{ ...n, s }] : [];
  });
}

const UNIT = /^[A-Za-z0-9@:._-]+\.(service|socket|path)$/;
const unitOk = (u: string) => {
  if (!UNIT.test(u)) throw new Error(`not a unit name: ${u}`);
  return u;
};
/** Each extra unit only if it exists here (systemctl refuses ones that don't). */
const extras = (units: string[], verb: string) =>
  units.map((u) => ` && { ! systemctl cat ${unitOk(u)} >/dev/null 2>&1 || sudo systemctl ${verb} ${u}; }`).join("");

/** Off: stopped now and not started again — by itself or by its socket. Its sockets go first, so they can't wake it. */
export const offCommand = (n: MaybeNotNeeded) => `true${extras(n.also, "disable --now")} && sudo systemctl disable --now ${unitOk(n.service)}`;

/** On again, as it was before. */
export const onCommand = (n: MaybeNotNeeded) => `sudo systemctl enable --now ${unitOk(n.service)}${extras(n.onAlso ?? n.also, "enable --now")}`;
