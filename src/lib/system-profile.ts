// The system learned from this machine (src-tauri/src/system.rs): which OS it is, its
// desktops, kernels, bootloader and login screen, and every core package with the reason it
// is core. Loading it hands the core list to protected.ts.

import { inv } from "./host";
import { setCoreSystem } from "./protected";

export interface SystemProfile {
  osId: string;
  osName: string;
  osChosen: boolean; // picked in Settings rather than detected
  detectedOsId: string;
  detectedOsName: string;
  osOptions: Array<{ id: string; name: string }>;
  desktop: string | null; // the desktop in use now (XDG_CURRENT_DESKTOP: KDE, Hyprland, GNOME…)
  sessionType: string | null; // wayland | x11 | tty
  sessions: string[]; // every desktop installed (you can log into)
  kernels: string[];
  bootloaders: string[];
  loginScreen: string | null;
  shell: string | null;
  core: Array<{ package: string; reason: string }>;
  detectedAt: string;
}

let current: SystemProfile | null = null;
let pending: Promise<SystemProfile | null> | null = null;

function adopt(p: SystemProfile): SystemProfile {
  current = p;
  setCoreSystem(p.core);
  return p;
}

/** The profile, learned once and reused; `refresh` re-reads the machine. null if pacman is unreadable. */
export async function loadSystemProfile(refresh = false): Promise<SystemProfile | null> {
  if (current && !refresh) return current;
  if (pending && !refresh) return pending;
  pending = inv<SystemProfile>("system_profile", { refresh })
    .then(adopt)
    .catch(() => null)
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Settings: pick the OS by hand, or null to go back to detecting it. */
export async function setOsChoice(id: string | null): Promise<SystemProfile> {
  return adopt(await inv<SystemProfile>("os_choice_set", { id }));
}
