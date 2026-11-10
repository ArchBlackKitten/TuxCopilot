// The guide: a pop-up you can skip (No guide / Guide me / Skip this step), where the next thing to
// press glows and pulses. A small card walks the whole app, one step per section of the
// side menu, plus Dry Run and Apply. On each step the thing to press next glows: the section's button
// in the side menu while you are elsewhere, then, once you are there, what is worth seeing on it.
// "Next" does what the glow points at. It asks only what Fluff can't know by itself (a network
// can't tell Fluff whether it is home, work or public): each network you are on is home, work or public, and whether you play
// games. A laptop is read, never asked.

import type { SecurityTab, View } from "@/components/arch/store";
import { SETTINGS } from "./hardening";

export type Ask = "networks" | "games" | "laptop";

export interface GuideStep {
  id: string;
  view: View;
  tab?: Exclude<SecurityTab, "glance"> | "glance"; // Security's sub-section
  glow?: string; // what to look at once there (data-guide="…"); none: the section itself
  title: string;
  words: string;
  ask?: Ask;
}

export const GUIDE: GuideStep[] = [
  { id: "dryrun", view: "home", glow: "dryrun", title: "Dry Run first", words: "This switch says Dry Run: while it is on, Fluff only shows what it would run and changes nothing. Switch it to LIVE when you want things done for real. Every real change asks \"Are you sure?\" first." },
  { id: "home", view: "home", title: "Home", words: "Your own lists of commands, in sections, each with Play and Stop. Fluff can read a list you paste in and sort it for you." },
  { id: "commands", view: "commands", title: "Commands", words: "The commands Arch people use, explained in plain words — what each does and what it needs — with the rare ones you saved." },
  { id: "apps", view: "apps", title: "Apps", words: "Everything installed — from Arch's repos, the AUR, Flatpak or GitHub — what each is for, and how to remove one safely." },
  { id: "updates", view: "updates", glow: "way-back", title: "Updates", words: "Updating, the safe way: the Arch news first (when it asks for work by hand, the update waits until you read it), a snapshot before, fresh mirrors. Below: firmware, and a way back if an update ever stops the computer from starting." },
  { id: "appmanager", view: "appmanager", title: "App Manager", words: "Which apps you really use, month by month, so the ones you never open can go." },
  { id: "security", view: "security", tab: "glance", glow: "levels", title: "Security", words: "Every protection at a glance. Each sub-section — Network, Devices, Accounts & login, System — has four cards: As it comes, Good security, Secured, Hardened. Fluff recommends Good security, and As it comes is always the way back." },
  { id: "networks", view: "security", tab: "network", glow: "levels", title: "Your networks", ask: "networks", words: "The firewall decides what may come in from each network. Fluff can't tell your home from a café, so tell it: a network you don't call home or work is treated as public — the safest." },
  { id: "accounts", view: "security", tab: "accounts", glow: "levels", title: "Accounts & login", ask: "laptop", words: "The screen lock, the groups that hand out root, and wrong passwords — who tried, and where." },
  { id: "system", view: "security", tab: "system", glow: "levels", title: "System", ask: "games", words: "The kernel's own protections, a weekly checkup, and fingerprints of your system files, so a change by someone else shows." },
  { id: "ports", view: "ports", title: "Ports", words: "Which program listens on which port of this computer, and whether a port is free." },
  { id: "services", view: "services", title: "Services", words: "What runs in the background — running, failed or asleep — with On, Off and Kill." },
  { id: "troubleshoot", view: "troubleshoot", glow: "report", title: "Troubleshoot", words: "Fluff's checkup: what failed, the errors since this start, settings files waiting after updates. At the bottom, a report to give whoever helps you — never a secret." },
  { id: "git", view: "git", title: "Git", words: "The git folders on this computer: how big, used or not, update or remove." },
  { id: "docker", view: "docker", title: "Docker", words: "Your Docker apps: open, start, stop, update, read their logs." },
  { id: "tor", view: "tor", title: "Tor", words: "The Tor service: connected or not, bridges, and what to try when it won't connect." },
  { id: "ollama", view: "ollama", title: "Ollama", words: "Language models that run on this computer, and which ones it can run well." },
  { id: "history", view: "history", title: "History", words: "Everything Fluff ran, newest first, with what it printed. A change to the system carries its snapshots, with \"What it changed\" and \"Undo this change\"." },
  { id: "feedback", view: "feedback", title: "Feedback", words: "Fluff is new at this: when it gets something wrong, tell its creator here. You read everything before it goes, and only you send it." },
  { id: "settings", view: "settings", glow: "guide-again", title: "Settings", words: "TuxCopilot's own settings: its look, its lock, moving Fluff to another computer — and this guide again, whenever you like." },
  { id: "apply", view: "settings", glow: "changes", title: "Apply", words: "Every change you make waits up here, with Undo and Redo, until you press Apply. That's the whole tour — Fluff is around if you need it." },
];

/** You are where the step is: its section, and for Security its sub-section. */
export const isThere = (s: GuideStep, view: View, tab: SecurityTab) => view === s.view && (!s.tab || tab === s.tab);

/** What glows: the step's section button while you are elsewhere; once there, what to look at (if any). */
export function glowFor(s: GuideStep, view: View, tab: SecurityTab): string | null {
  if (view !== s.view) return `nav-${s.view}`;
  if (s.tab && tab !== s.tab) return `tab-${s.tab}`;
  return s.glow ?? null;
}

/** "Next": takes you where the glow points (to the step's place), or on to the next step, or ends. */
export function next(step: number, view: View, tab: SecurityTab): { go: GuideStep } | { step: number } | { end: true } {
  const s = GUIDE[step];
  if (s && !isThere(s, view, tab)) return { go: s };
  return step + 1 < GUIDE.length ? { step: step + 1 } : { end: true };
}

/** A network you call home or work gets that zone; public goes back to the default (your level's). */
export const ZONE_FOR = { home: "home", work: "work", public: "" } as const;
export type NetworkKind = keyof typeof ZONE_FOR;
export const kindOf = (zone: string): NetworkKind | null => (zone === "" || zone === "public" ? "public" : zone === "home" || zone === "work" ? zone : null);

/** What the games answer changes: the strict kernel settings that stop games, said. */
export function gamesWords(plays: boolean): string {
  const costs = SETTINGS.filter((s) => s.strict !== s.recommended && /game/i.test(s.cost)).map((s) => s.cost);
  if (!plays) return "No games: any level suits this computer.";
  return costs.length ? `You play games: Fluff recommends Secured, not Hardened. ${costs.join(" ")}` : "You play games: every level suits them.";
}

export const laptopWords = (laptop: boolean) =>
  laptop
    ? "This is a laptop: Fluff recommends it locks when you close the lid and after five minutes away, and asks your password at once — Good security sets that."
    : "This is a desktop: Fluff recommends it locks after five minutes away, and asks your password at once — Good security sets that.";
