// The look (Settings → Look): which palette, which colour vision, the palettes you imported,
// and the app's icon. Like every setting it waits for Apply — but the window shows it as soon
// as you choose, so you see it before you keep it.
//
// A look file is all of it in one file (.tuxlook, plain JSON): export yours, import someone
// else's, and the whole look — colours and icon — changes at once. (A penguin is more: the
// whole of TuxCopilot, sealed, to move it to another computer — penguin.rs.)

import { inv } from "./host";
import { ARCH, builtIns, type Palette, type PaletteColors, type Vision } from "./palette";

export interface LookIcon {
  name: string;
  svg?: string; // the picture itself, when it is an SVG
  png?: string; // data:image/png;base64,… otherwise
}

export interface Look {
  palette: string; // a palette's id
  vision: Vision;
  imported: Palette[];
  icon: LookIcon | null; // null: the penguin TuxCopilot comes with
  order: string[]; // the sections in your order, by id (empty: TuxCopilot's own order; sections.ts)
}

export const DEFAULT_LOOK: Look = { palette: ARCH.id, vision: "usual", imported: [], icon: null, order: [] };

export const allPalettes = (look: Look): Palette[] => [...builtIns(), ...look.imported];

export const paletteOf = (look: Look): Palette => allPalettes(look).find((p) => p.id === look.palette) ?? ARCH;

// ── checking what comes in (a setting, a file someone gave you) ─────────

const KEYS: Array<keyof PaletteColors> = [
  "background", "foreground", "card", "popover", "primary", "primaryForeground", "secondary", "muted", "mutedForeground",
  "accent", "border", "sidebar", "term", "termForeground", "good", "caution", "bad", "info", "special", "onColor",
];
const HEX = /^#[0-9a-fA-F]{6}$/;
const VISION_IDS: Vision[] = ["usual", "red-green", "blue-yellow"];

export function cleanPalette(x: unknown): Palette | null {
  if (!x || typeof x !== "object") return null;
  const p = x as Record<string, unknown>;
  const c = p.colors as Record<string, unknown> | undefined;
  if (!c || typeof p.id !== "string" || typeof p.name !== "string") return null;
  if (!KEYS.every((k) => typeof c[k] === "string" && HEX.test(c[k] as string))) return null;
  const id = p.id.replace(/[^a-z0-9-]/gi, "").slice(0, 60);
  if (!id) return null;
  return {
    id,
    name: p.name.replace(/[\u0000-\u001f]/g, "").slice(0, 60) || "Unnamed",
    from: typeof p.from === "string" ? p.from.slice(0, 60) : "imported",
    light: p.light === true,
    monochrome: p.monochrome === true,
    colors: Object.fromEntries(KEYS.map((k) => [k, (c[k] as string).toLowerCase()])) as unknown as PaletteColors,
  };
}

const MAX_ICON = 3 * 1024 * 1024;

/** An icon: an SVG with nothing that runs or reaches out, or a PNG. */
export function cleanIcon(x: unknown): LookIcon | null {
  if (!x || typeof x !== "object") return null;
  const i = x as Record<string, unknown>;
  const name = typeof i.name === "string" ? i.name.slice(0, 80) : "icon";
  if (typeof i.svg === "string") {
    const s = i.svg;
    if (s.length > MAX_ICON || !/<svg[\s>]/i.test(s)) return null;
    // the desktop draws it too: no scripts, no event handlers, nothing fetched from elsewhere
    if (/<script|<foreignObject|\son\w+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|javascript:|\/\/)/i.test(s)) return null;
    return { name, svg: s };
  }
  if (typeof i.png === "string") {
    if (i.png.length > MAX_ICON * 1.4 || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(i.png)) return null;
    return { name, png: i.png };
  }
  return null;
}

export function cleanLook(x: unknown): Look {
  if (!x || typeof x !== "object") return { ...DEFAULT_LOOK };
  const l = x as Record<string, unknown>;
  const imported = Array.isArray(l.imported) ? l.imported.map(cleanPalette).filter((p): p is Palette => p !== null) : [];
  return {
    palette: typeof l.palette === "string" ? l.palette : ARCH.id,
    vision: VISION_IDS.includes(l.vision as Vision) ? (l.vision as Vision) : "usual",
    imported,
    icon: l.icon == null ? null : cleanIcon(l.icon),
    order: Array.isArray(l.order) ? [...new Set(l.order.filter((id): id is string => typeof id === "string" && /^[a-z]{1,30}$/.test(id)))].slice(0, 60) : [],
  };
}

// ── kept in the app's database ───────────────────────────────────────────

export async function getLook(): Promise<Look> {
  try {
    const raw = await inv<string | null>("setting_get", { key: "look" });
    return cleanLook(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_LOOK };
  }
}

export const saveLook = (look: Look) => inv("setting_set", { key: "look", value: JSON.stringify(look) });

// ── changing it ──────────────────────────────────────────────────────────

/** A palette joins your imported ones (one with the same id is replaced) and is chosen. */
export function withPalette(look: Look, p: Palette): Look {
  const builtIn = builtIns().some((b) => b.id === p.id);
  const imported = builtIn ? look.imported : [...look.imported.filter((x) => x.id !== p.id), p];
  return { ...look, imported, palette: p.id };
}

export function withoutPalette(look: Look, id: string): Look {
  return { ...look, imported: look.imported.filter((p) => p.id !== id), palette: look.palette === id ? ARCH.id : look.palette };
}

// ── look files ───────────────────────────────────────────────────────────

export interface LookFile {
  name: string;
  palette: Palette;
  vision: Vision;
  icon: LookIcon | null;
}

export function toLookFile(look: Look, name: string): string {
  return JSON.stringify(
    { tuxcopilot: "look", version: 1, name: name.slice(0, 60), palette: paletteOf(look), vision: look.vision, icon: look.icon },
    null,
    2,
  );
}

/** A look file, checked; a sentence saying what is wrong otherwise. */
export function fromLookFile(text: string): LookFile | string {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text);
  } catch {
    return "This is not a look file (it is not JSON).";
  }
  if (j?.tuxcopilot !== "look") return "This is not a look file.";
  if (j.version !== 1) return "This look was made by a newer TuxCopilot. Update TuxCopilot, then import it again.";
  const palette = cleanPalette(j.palette);
  if (!palette) return "This look's colours are damaged.";
  const icon = j.icon == null ? null : cleanIcon(j.icon);
  if (j.icon != null && !icon) return "This look's icon was refused: it must be a PNG, or an SVG with no scripts and nothing fetched from the internet.";
  const name = typeof j.name === "string" && j.name.trim() ? j.name.slice(0, 60) : palette.name;
  // its palette is its own, so it never replaces a built-in one of the same name
  const own = builtIns().some((b) => b.id === palette.id) && JSON.stringify(builtIns().find((b) => b.id === palette.id)!.colors) === JSON.stringify(palette.colors);
  return {
    name,
    palette: own ? palette : { ...palette, id: palette.id.startsWith("look-") ? palette.id : `look-${palette.id}`, from: `the look “${name}”` },
    vision: VISION_IDS.includes(j.vision as Vision) ? (j.vision as Vision) : "usual",
    icon,
  };
}

/** Everything a look file holds, in one change. */
export const withLookFile = (look: Look, p: LookFile): Look => ({ ...withPalette(look, p.palette), vision: p.vision, icon: p.icon });

export const sameIcon = (a: LookIcon | null, b: LookIcon | null) => (a?.svg ?? a?.png ?? null) === (b?.svg ?? b?.png ?? null);
