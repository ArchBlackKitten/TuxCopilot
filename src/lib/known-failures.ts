// Fluff knows common failures. A failed service is said in plain words: what it is, why it usually
// fails, whether that is harmless, and what to do. For example drkonqi-coredump-pickup.service,
// KDE's crash reporter, stopped at its 30-minute limit ("Failed with result 'timeout'") — nothing
// broken.
// Unknown services still get systemd's own reason (Result=) in words.

import type { Service } from "./services";

export interface Known {
  unit: RegExp;
  label: string;
  what: string; // what the service is
  why: string; // why it usually fails
  harmless: boolean; // nothing else is affected: clearing the mark is enough
  look?: { label: string; command: string }; // a command that only reads, to see more
  where?: string; // the section of TuxCopilot that checks it
}

export const KNOWN: Known[] = [
  {
    unit: /^drkonqi-coredump-pickup\.service$/,
    label: "KDE's crash reporter",
    what: "DrKonqi, KDE's crash reporter, looking through the crashes saved since you logged in, to offer a report for each.",
    why: "It ran out of its 30 minutes, which is a known KDE fault. Nothing else is affected; it tries again at your next login.",
    harmless: true,
    look: { label: "Which programs crashed", command: "coredumpctl list" },
  },
  {
    unit: /^drkonqi-sentry-postman\.(service|path)$/,
    label: "KDE's crash-report sender",
    what: "Sends the crash reports you agreed to send to KDE.",
    why: "Usually no internet at that moment. It tries again later.",
    harmless: true,
  },
  {
    unit: /^systemd-networkd-wait-online\.service$/,
    label: "Waiting for the network (systemd-networkd)",
    what: "Holds the start until systemd-networkd says the network is up.",
    why: "It fails when systemd-networkd isn't what runs your network (on KDE, NetworkManager usually is), or when no cable or Wi-Fi was there at start. It only slowed the start.",
    harmless: true,
  },
  {
    unit: /^NetworkManager-wait-online\.service$/,
    label: "Waiting for the network (NetworkManager)",
    what: "Holds the start until NetworkManager is connected.",
    why: "No connection came in time (a slow Wi-Fi, or none). Harmless, unless something needs the network while starting, like a disk on another computer.",
    harmless: true,
  },
  {
    unit: /^systemd-modules-load\.service$/,
    label: "Loading kernel modules",
    what: "Loads the kernel modules (drivers) listed in /etc/modules-load.d at start.",
    why: "One couldn't load. Most often the kernel was updated and the computer wasn't restarted yet — restart. Or it is for hardware this computer doesn't have.",
    harmless: false,
    look: { label: "Which module", command: "journalctl -b -u systemd-modules-load.service" },
  },
  {
    unit: /^reflector\.service$/,
    label: "Ranking download servers (reflector)",
    what: "Picks the fastest Arch download servers and writes your server list.",
    why: "Usually no internet at that moment. Your old list stays in use, so updates still work.",
    harmless: true,
  },
  {
    unit: /^man-db\.service$/,
    label: "The manual's index",
    what: "Rebuilds the index of the manual pages (what man -k searches).",
    why: "It tries again every day; reading manual pages still works.",
    harmless: true,
  },
  {
    unit: /^pkgfile-update\.service$/,
    label: "pkgfile's list",
    what: "Downloads the list of which package has which file (pkgfile).",
    why: "Usually no internet at that moment. It tries again later.",
    harmless: true,
  },
  {
    unit: /^bluetooth\.service$/,
    label: "Bluetooth",
    what: "Bluetooth: wireless headphones, mice, keyboards.",
    why: "Usually there is no Bluetooth hardware, or it is switched off (airplane mode). If you don't use Bluetooth, Off is right.",
    harmless: false,
  },
  {
    unit: /^firewalld\.service$/,
    label: "The firewall",
    what: "firewalld, your firewall.",
    why: "Often another firewall is switched on too (ufw, iptables or nftables). Until it starts, its rules aren't protecting you.",
    harmless: false,
    where: "Security → Network",
  },
  {
    unit: /^tor\.service$/,
    label: "Tor",
    what: "Tor, which hides where your connections come from.",
    why: "Most often a line in torrc that Tor doesn't accept.",
    harmless: false,
    where: "Tor",
  },
  {
    unit: /^xdg-desktop-portal-(hyprland|wlr|gnome|cosmic|xapp|lxqt)\.service$/,
    label: "Another desktop's portal",
    what: "A portal (what apps use for file windows and screen sharing) made for another desktop.",
    why: "It only starts inside its own desktop, not in KDE. Harmless while you use KDE: KDE's own portal does the work.",
    harmless: true,
  },
  {
    unit: /^snapper-(timeline|cleanup)\.service$/,
    label: "snapper's timed snapshots",
    what: "snapper's snapshots every hour, and the clean-up of old ones.",
    why: "Usually snapper has no settings for this disk yet, or the disk isn't Btrfs.",
    harmless: false,
    look: { label: "snapper's settings", command: "snapper list-configs" },
  },
];

/** systemd's reason (Result=), in words. */
export const RESULT_WORDS: Record<string, string> = {
  timeout: "it ran longer than systemd allows it, so systemd stopped it",
  "exit-code": "it ended with an error",
  "core-dump": "it crashed",
  signal: "it was killed",
  "start-limit-hit": "it failed several times in a row, so systemd stopped trying",
  "oom-kill": "the computer ran out of memory, and it was stopped to free some",
  resources: "systemd couldn't prepare what it needs to start (a file, a folder or a user)",
  watchdog: "it stopped answering, so systemd stopped it",
  protocol: "it didn't tell systemd it had started properly",
};

export const knownFailure = (s: Pick<Service, "name">): Known | null => KNOWN.find((k) => k.unit.test(s.name)) ?? null;

/** Why it stopped, as systemd recorded it ("" when there is nothing to say). */
export const resultWords = (s: Pick<Service, "result">): string => RESULT_WORDS[s.result ?? ""] ?? "";

/** One service's failure, in plain words. */
export function failureSaid(s: Pick<Service, "name" | "result">): string {
  const k = knownFailure(s);
  const r = resultWords(s);
  if (k) return `${k.what} ${k.why}`;
  return `${s.name} failed${r ? `: ${r}` : ""}.`;
}

/** The failed mark goes (it comes back only if the service fails again). Yours need no password. */
export const clearMarkCommand = (s: Pick<Service, "name" | "user">): string => {
  if (!/^[\w@.:-]+\.service$/.test(s.name)) throw new Error(`not a service name Fluff knows: ${s.name}`);
  return s.user ? `systemctl --user reset-failed ${s.name}` : `sudo systemctl reset-failed ${s.name}`;
};
