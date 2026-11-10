// Fluff's brain (Settings) and Ask Fluff: a local model, through Ollama on this computer
// (brain.rs). Off until you choose a model; the choice waits for Apply like every setting.
// What Fluff is told before you ask: who it is, who it talks to, and the rules TuxCopilot
// keeps (-Sy, never sudo yay, partial upgrades, nothing run for you).

import { inv } from "./host";

export interface Brain {
  on: boolean;
  model: string | null;
}

export const NO_BRAIN: Brain = { on: false, model: null };
export const BRAIN_KEY = "fluff.brain";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** The computer Fluff helps with (the OS and the desktop both matter). */
export interface Machine {
  os: string; // CachyOS, Arch Linux, EndeavourOS…
  desktop: string | null; // the one in use now: KDE, Hyprland, GNOME…
  sessionType: string | null; // wayland | x11
  installedDesktops: string[];
}

/** The computer, said for a model: the OS, the desktop in use (and Wayland or X11), the others installed. */
export function machineLine(m: Machine): string {
  // XDG_CURRENT_DESKTOP says "KDE" where the session is called "Plasma"; "ubuntu:GNOME" lists several
  const inUse = (m.desktop ?? "").toLowerCase().split(":").map((d) => (d === "kde" ? "plasma" : d)).filter(Boolean);
  const others = m.installedDesktops.filter((d) => !inUse.some((u) => d.toLowerCase().includes(u)));
  return [
    `OS: ${m.os}`,
    m.desktop ? `desktop in use: ${m.desktop}${m.sessionType ? ` (${m.sessionType})` : ""}` : "",
    others.length ? `also installed: ${others.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/** What the model is told first. `machine`: the computer it is helping with. */
export function fluffPrompt(machine: Machine | null): string {
  return [
    "You are Fluff, the penguin chick inside TuxCopilot, an app that helps people who just installed Arch Linux.",
    "Fluff is a baby penguin: friendly, a little cute, but exact. Short answers, plain words, no jargon without saying what it means.",
    machine ? `The computer you are helping with — ${machineLine(machine)}.` : "",
    machine
      ? `- Answer for that OS (its packages, repositories and tools) and for the desktop in use: Hyprland is not KDE Plasma is not GNOME (hyprland.conf and hyprctl; System Settings and kwriteconfig6; gsettings), and Wayland is not X11 (xrandr is X11 only). If an answer differs between them, say which one it is for.`
      : "",
    "Rules you always keep:",
    "- Give commands in ``` code blocks, one command per line, so TuxCopilot can explain or copy them.",
    "- Installing is always `sudo pacman -Syu --needed <package>` (AUR: `yay -Syu --needed <package>`). Never put sudo before yay.",
    "- A full update is `sudo pacman -Syu`. Never suggest updating only one package with its lists refreshed (a partial upgrade).",
    "- Say what a command changes before it changes anything, and warn about anything that deletes or cannot be undone.",
    "- You don't run anything: the person decides. If you are not sure, say so and point to the Arch wiki page.",
    "- TuxCopilot has sections that may help: Apps, Updates, Services, Troubleshoot (Fluff's checkup), Commands (explains any command), Ports, Tor, Docker, Ollama.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Fluff's answer to the conversation so far. */
export const askFluff = (model: string, machine: Machine | null, chat: ChatMessage[]) =>
  inv<string>("ask_fluff", { model, messages: [{ role: "system", content: fluffPrompt(machine) }, ...chat] });

/** The commands in an answer: each line of its ``` code blocks (comments and prompts left out). */
export function answerCommands(answer: string): string[] {
  const out: string[] = [];
  for (const [, block] of answer.matchAll(/```[a-z]*\n?([\s\S]*?)```/g))
    for (const raw of block.split("\n")) {
      const l = raw.trim().replace(/^\$\s+/, "");
      if (l && !l.startsWith("#")) out.push(l);
    }
  return out;
}
