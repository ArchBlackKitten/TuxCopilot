// Your groups: out of any one and back in, wheel too (docker's is a security matter). Every group of this computer, with what
// being in it gives away in plain words; out of any one, into any one. Never out of your own group.
// Out of wheel only with a way back: someone else in wheel, or a root password — the command checks
// that as root before it changes anything, or it changes nothing.

import { inv } from "./host";

export interface Group {
  name: string;
  gid: number;
  listed: boolean; // /etc/group lists you
  thisLogin: boolean; // this login has it now
  primary: boolean; // your own group
  others: number; // other people in it
}
export const myGroups = () => inv<Group[]>("my_groups"); // devices.rs

export type Risk = "root" | "admin" | "private" | "plain";
export interface GroupWords {
  risk: Risk;
  gives: string;
  without: string; // what happens if you leave it: said before you can
}

export const RISK_WORDS: Record<Risk, string> = {
  root: "root without a password",
  admin: "an administrator",
  private: "can see private things",
  plain: "ordinary",
};

export const GROUP_WORDS: Record<string, GroupWords> = {
  wheel: {
    risk: "admin",
    gives: "you may use sudo: change anything on this computer, after typing your password.",
    without: "sudo stops working for you at once, and TuxCopilot can't change the system for you; someone with sudo (or root's password) has to put you back.",
  },
  docker: {
    risk: "root",
    gives: "Docker runs its containers as root, and anyone who may use Docker can start one with your whole disk inside (docker run -v /:/host): any program you run can act as root, without your password.",
    without: "Docker still works with sudo docker … (your password each time), and TuxCopilot's Docker section stops until you add yourself back.",
  },
  libvirt: {
    risk: "root",
    gives: "libvirt runs the system's virtual machines as root, and anyone in this group may make one with any disk of this computer inside, without your password — close to root.",
    without: "Virtual machines still work: virt-manager asks for your password first.",
  },
  disk: { risk: "root", gives: "read and write every disk directly, around every file permission — close to root.", without: "programs you run can no longer read or write disks directly; ordinary files and drives work as before." },
  root: { risk: "root", gives: "the root group: many of the system's own files may be changed by it.", without: "you lose write access to the files the root group may change; your own files are untouched." },
  lxd: { risk: "root", gives: "LXD containers, which can be given the whole system — root without a password.", without: "LXD containers need sudo (your password) to manage." },
  "incus-admin": { risk: "root", gives: "Incus containers, which can be given the whole system — root without a password.", without: "Incus containers need sudo (your password) to manage." },
  input: { risk: "private", gives: "read every key pressed on every keyboard, and move the pointer, with no window — what a keylogger needs.", without: "tools that read keyboards directly (key remappers like keyd or kanata, some game tools) stop working for you; your keyboard and mouse themselves keep working." },
  wireshark: { risk: "private", gives: "see all the network traffic of this computer (Wireshark's capture).", without: "Wireshark can't capture network traffic without sudo." },
  adm: { risk: "private", gives: "read the system's logs, which can hold private details.", without: "you can't read the system's log files without sudo; the desktop's own logs are still yours." },
  "systemd-journal": { risk: "private", gives: "read the whole system journal, which can hold private details.", without: "journalctl shows only your own logs without sudo." },
  log: { risk: "private", gives: "read the system's log files.", without: "the system's log files need sudo to read." },
  tty: { risk: "private", gives: "write to other people's terminals.", without: "you can't write to other people's terminals (wall, write)." },
  nopasswdlogin: { risk: "private", gives: "log in without a password, where the login screen uses this group (nothing on this computer does).", without: "a login screen that uses this group asks for your password again (nothing on this computer uses it)." },
  audio: { risk: "plain", gives: "use the sound devices directly, around the desktop's sound server (it can listen to the microphone without the desktop showing it). Not needed with PipeWire.", without: "nothing you'd notice with PipeWire (it handles sound for your login); only programs that open sound devices directly stop." },
  video: { risk: "plain", gives: "use the graphics card and webcams directly. Usually not needed: your login already may.", without: "nothing you'd notice on a normal desktop (your login already may use the graphics card); a few tools that open webcams or the screen directly may stop." },
  kvm: { risk: "plain", gives: "run virtual machines fast (the processor's own help).", without: "virtual machines (virt-manager, QEMU, GNOME Boxes) run much slower, or not at all, without sudo." },
  lp: { risk: "plain", gives: "printers and scanners, the old way (CUPS doesn't need it).", without: "nothing you'd notice: CUPS prints without it." },
  uucp: { risk: "plain", gives: "serial ports: an Arduino, a modem, a USB-to-serial cable.", without: "serial ports (an Arduino, a USB-to-serial cable) need sudo to open." },
  storage: { risk: "plain", gives: "an old group; on this computer it only owns CD and tape drives.", without: "nothing you'd notice on this computer." },
  optical: { risk: "plain", gives: "CD and DVD drives, the old way.", without: "old CD tools may need sudo; KDE's own still work." },
  sys: { risk: "plain", gives: "an old group; Arch keeps it for compatibility.", without: "nothing you'd notice: Arch keeps it for compatibility." },
  network: { risk: "plain", gives: "an old group for network settings; NetworkManager doesn't need it.", without: "nothing you'd notice: NetworkManager doesn't need it." },
  rfkill: { risk: "plain", gives: "switch Wi-Fi and Bluetooth radios on and off.", without: "switching Wi-Fi and Bluetooth radios on and off may ask for your password." },
  users: { risk: "plain", gives: "the group of the people of this computer.", without: "nothing you'd notice on a computer with one person." },
  games: { risk: "plain", gives: "some games' shared score files.", without: "some games can't save their shared score files." },
  vboxusers: { risk: "plain", gives: "VirtualBox: USB devices inside its virtual machines.", without: "VirtualBox can't pass USB devices into its virtual machines." },
};

export const wordsFor = (name: string): GroupWords =>
  GROUP_WORDS[name] ?? { risk: "plain", gives: "a group of this computer: what it gives depends on the programs that use it.", without: "the programs that use this group may stop working for you. Fluff doesn't know this one: if you aren't sure what it is for, keep it." };

/** Why you can't leave this group (then there is no switch for it), or null. */
export function neededWhy(g: Pick<Group, "name" | "primary" | "listed" | "others">): string | null {
  if (g.primary) return "your own group: every file you make belongs to it, so you can't leave it.";
  if (g.name === "wheel" && g.listed && g.others === 0)
    return "you are the only administrator: without it nobody could use sudo, and nobody could put you back. To leave it, first make someone else an administrator.";
  return null;
}

/** Changing wheel always asks an administrator's password (sudo -k: a password typed a moment ago doesn't count). */
export const needsPassword = (name: string): boolean => name === "wheel";

const NAME = /^[a-z_][a-z0-9_-]*\$?$/;

// as root, before anything changes: someone else in wheel, or a usable root password (passwd -S
// says only *whether* there is one: P, L or NP — never the password)
const WHEEL_WAY_BACK = `{ others=$(getent group wheel | cut -d: -f4 | tr ',' '\\n' | grep -vx "$USER" | grep -c .); rootpw=$(sudo passwd -S root | cut -d' ' -f2); [ "$others" -gt 0 ] || [ "$rootpw" = P ] || { echo "Fluff: you are the only one who can use sudo, and root has no password, so out of wheel nobody could put you back. Nothing was changed." >&2; false; }; }`;

/** Out of a group, or into one. Any group of this computer, but never out of your own. */
export function groupCommand(g: Pick<Group, "name" | "primary"> & Partial<Pick<Group, "listed" | "others">>, add: boolean): string {
  if (!NAME.test(g.name)) throw new Error(`not a group name: ${g.name}`);
  if (!add && g.primary) throw new Error("This is your own group: your files are made in it. Fluff never takes you out of it.");
  const why = !add && g.listed !== undefined && g.others !== undefined ? neededWhy({ name: g.name, primary: g.primary, listed: g.listed, others: g.others }) : null;
  if (why) throw new Error(`Fluff can't take you out: ${why}`);
  // the group database's own answer first (a pipe would hide a failed id — and "left" would pass)
  const check = `m=$(id -nG "$USER") && { ${add ? "" : "! "}printf '%s\\n' $m | grep -qx ${g.name} || { echo "Fluff: you are ${add ? "not in" : "still in"} ${g.name}." >&2; false; }; }`;
  const when = g.name === "wheel" ? "sudo reads it at once" : "It counts from your next login: log out and in again";
  return [...(needsPassword(g.name) ? ["sudo -k"] : []), ...(!add && g.name === "wheel" ? [WHEEL_WAY_BACK] : []), `sudo gpasswd ${add ? "-a" : "-d"} "$USER" ${g.name}`, check, `echo "Fluff: done. ${when}."`].join(" && ");
}

/** How it stands, in words. */
export function groupState(g: Group): string {
  if (g.primary) return "your own group";
  if (g.listed && g.thisLogin) return "you are in it";
  if (!g.listed && !g.thisLogin) return "you are not in it";
  return g.listed ? "you are in it from your next login" : "you are out of it from your next login (this login still has it)";
}

const RANK: Record<Risk, number> = { root: 0, admin: 1, private: 2, plain: 3 };
/** Yours first, the riskiest first; then the rest, by name. */
export function sortGroups(gs: Group[]): { mine: Group[]; others: Group[] } {
  const byRisk = (a: Group, b: Group) => RANK[wordsFor(a.name).risk] - RANK[wordsFor(b.name).risk] || a.name.localeCompare(b.name);
  return { mine: gs.filter((g) => g.listed || g.thisLogin).sort(byRisk), others: gs.filter((g) => !g.listed && !g.thisLogin).sort((a, b) => a.name.localeCompare(b.name)) };
}
