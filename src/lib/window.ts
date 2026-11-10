// The size TuxCopilot opens at (window.rs): pocket, roomy, the size it had when closed, or your own.

import { inv } from "./host";

export type WindowMode = "pocket" | "roomy" | "last" | "custom";

export interface WindowPref {
  mode: WindowMode;
  width: number; // for "custom"
  height: number;
}

export const DEFAULT_WINDOW: WindowPref = { mode: "pocket", width: 900, height: 640 };

export const WINDOW_MODES: Array<{ id: WindowMode; label: string; note: string }> = [
  { id: "pocket", label: "Pocket", note: "900 × 640 — small, out of the way" },
  { id: "roomy", label: "Roomy", note: "1280 × 860 — room for everything" },
  { id: "last", label: "As I left it", note: "the size it had when you closed it" },
  { id: "custom", label: "My own size", note: "width × height, as you set them" },
];

export async function getWindowPref(): Promise<WindowPref> {
  try {
    const p = await inv<WindowPref>("window_pref_get");
    return { mode: p.mode, width: p.width, height: p.height };
  } catch {
    return DEFAULT_WINDOW;
  }
}

export const saveWindowPref = (pref: WindowPref) => inv("window_pref_set", { pref: { ...pref, last: null } });
