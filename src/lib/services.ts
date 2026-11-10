// The Services section: every systemd service, in plain states (services.rs reads them), with
// On / Off / Kill. A killed service reads "Dead". Services the computer needs to boot, log in,
// reach the network or stay safe are protected — Fluff says why instead of offering the button.

import { inv } from "./host";
import { failureSaid, knownFailure, resultWords } from "./known-failures";

export type ServiceState = "running" | "ran once" | "failed" | "dead" | "dormant" | "off" | "never started" | "on demand" | "blocked";

export interface Service {
  name: string;
  description: string;
  user: boolean; // yours (systemctl --user), not the system's
  state: ServiceState;
  enabled: string;
  since: string | null;
  result?: string; // how it last ended (systemd's Result): success, timeout, exit-code, core-dump, start-limit-hit, …
}

export const servicesList = () => inv<Service[]>("services_list");

/** What each state means, in words a new Arch user follows. */
export const STATE_WORDS: Record<ServiceState, string> = {
  running: "running now",
  "ran once": "did its work at startup and finished, as it should",
  failed: "stopped with an error",
  dead: "killed",
  dormant: "switched on, waiting: a timer, a socket or a request starts it",
  off: "stopped, and switched off",
  "never started": "installed with a package, never used — harmless",
  "on demand": "has no switch of its own: other services start it when they need it",
  blocked: "blocked (masked): nothing can start it",
};

const PROTECTED: Array<[RegExp, string]> = [
  [/^systemd-/, "it is part of systemd itself: your computer can't run without it"],
  [/^(dbus|dbus-broker)(\.|-)/, "programs talk to each other through it"],
  [/^polkit\./, "it asks for your password when something needs it"],
  [/^(NetworkManager|systemd-networkd|iwd|wpa_supplicant|connman|dhcpcd)/, "it keeps you on the network"],
  [/^(sddm|gdm|lightdm|ly|greetd|display-manager|plasmalogin)\./, "it is your login screen"],
  [/^accounts-daemon\./, "your login screen uses it"],
  [/^(getty@|user@|user-runtime-dir@|autovt@)/, "it is how you log in"],
  [/^(lvm2-|cryptsetup|blk-availability)/, "it opens your disks"],
  [/^(firewalld|ufw|nftables|iptables|ip6tables)\./, "it is your firewall: Security → Network changes it, with Fluff's advice"],
  [/^tuxcopilot-shadow\./, "it is Tor's Shadow: the Tor section turns it on and off"],
  [/^(pipewire|pipewire-pulse|wireplumber)\./, "it is your sound"],
  [/^(plasma-|xdg-desktop-portal|gnome-session)/, "it is part of your desktop"],
];

/** Why Fluff won't switch this one off or kill it; null: it is yours to decide. */
export function protectedWhy(s: Pick<Service, "name">): string | null {
  return PROTECTED.find(([re]) => re.test(s.name))?.[1] ?? null;
}

const NAME = /^[A-Za-z0-9@:._\\-]+\.service$/;
const ctl = (s: Pick<Service, "name" | "user">) => {
  if (!NAME.test(s.name)) throw new Error(`not a service name: ${s.name}`);
  return `${s.user ? "systemctl --user" : "sudo systemctl"}`;
};
const q = (name: string) => `'${name}'`;
const noSwitch = (s: Pick<Service, "enabled">) => ["static", "indirect", "generated", "transient", ""].includes(s.enabled);

/** On: switched on and started now (a service with no switch is only started). */
export const onCommand = (s: Service) => (noSwitch(s) ? `${ctl(s)} start ${q(s.name)}` : `${ctl(s)} enable --now ${q(s.name)}`);

/** Off: stopped now, and not started at the next boot. */
export const offCommand = (s: Service) => (noSwitch(s) ? `${ctl(s)} stop ${q(s.name)}` : `${ctl(s)} disable --now ${q(s.name)}`);

/** Kill: stopped at once (SIGKILL) — systemd records it, and it reads Dead. */
export const killCommand = (s: Service) => `${ctl(s)} kill --signal=SIGKILL ${q(s.name)}`;

/** Which buttons a service gets. */
export function buttons(s: Service): { on: boolean; off: boolean; kill: boolean } {
  if (s.state === "blocked") return { on: false, off: false, kill: false };
  const guarded = protectedWhy(s) !== null;
  const active = s.state === "running" || s.state === "ran once";
  return {
    on: !active || (s.state === "ran once" ? false : s.enabled === "disabled"),
    off: !guarded && (active || s.state === "dormant" || s.enabled === "enabled"),
    kill: !guarded && s.state === "running",
  };
}

/** Fluff's advice for one service, when there is some. */
export function fluffSays(s: Service): string | null {
  if (s.state === "failed") {
    const k = knownFailure(s);
    if (k?.harmless) return `${failureSaid(s)} Harmless: Fluff's checkup (Troubleshoot) clears the mark.`;
    const r = resultWords(s);
    return `${k ? failureSaid(s) : `${s.name} failed${r ? `: ${r}` : ""}.`} Look at its log first: it says more. Then On tries again, if you need it — or Off, if you don't.`;
  }
  if (s.state === "dead") return `You killed ${s.name}. On starts it again; Off keeps it from starting at the next boot.`;
  return null;
}
