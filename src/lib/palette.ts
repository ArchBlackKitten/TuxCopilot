// Palettes: how TuxCopilot looks. A palette is a handful of colours — the window, the text,
// the accent, and five meanings the whole app speaks in: good, careful, bad, information and
// special. Every colour class in the interface (emerald for "done", amber for "careful", red
// for "failed", cyan for git…) is drawn from those five, so changing a palette, or the colour
// vision setting, recolours every corner at once.
//
// Palettes come built in, from KDE / Krita colour schemes (the same .colors format; the ones
// installed on this machine are offered directly), or inside a look file. Any palette can
// be written back out as a .colors file for KDE or Krita.

import MANGA_MONOTONE from "./palettes/MangaMonotone.colors?raw";

export interface PaletteColors {
  background: string;
  foreground: string;
  card: string; // panels on the background
  popover: string; // menus, tooltips, dialogs
  primary: string; // the accent: buttons, selection, focus
  primaryForeground: string; // text on the accent
  secondary: string; // quiet buttons
  muted: string; // quiet surfaces
  mutedForeground: string; // quiet text
  accent: string; // hover and selected rows
  border: string;
  sidebar: string;
  term: string; // the terminal panel and logs
  termForeground: string;
  good: string; // done, running, installed
  caution: string; // careful, pending, stopped
  bad: string; // failed, dangerous, removed
  info: string; // links, sources, information
  special: string; // dry runs, flatpaks, extras
  onColor: string; // text on a filled good / bad button
}

export interface Palette {
  id: string;
  name: string;
  from: string; // "built in", "KDE / Krita colour scheme", "a look file"
  light: boolean;
  monochrome: boolean; // greys only: already readable without colour vision
  colors: PaletteColors;
}

export type Vision = "usual" | "red-green" | "blue-yellow";

export const VISIONS: Array<{ id: Vision; name: string; note: string }> = [
  { id: "usual", name: "Usual colours", note: "green for good, amber for careful, red for bad" },
  { id: "red-green", name: "Red-green safe", note: "for protanopia and deuteranopia: blue for good, yellow for careful, orange for bad" },
  { id: "blue-yellow", name: "Blue-yellow safe", note: "for tritanopia: teal for good, pink for careful, red for bad" },
];

// ── colours ──────────────────────────────────────────────────────────────

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as RGB;
}

export const rgbToHex = (c: RGB) => "#" + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");

/** a → b by t (0..1), in plain RGB: enough for borders and tints. */
export const mix = (a: string, b: string, t: number) => {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as RGB);
};

/** WCAG relative luminance and contrast ratio (1–21). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// ── built in ─────────────────────────────────────────────────────────────

const builtin = (id: string, name: string, light: boolean, monochrome: boolean, colors: PaletteColors): Palette => ({
  id, name, from: "built in", light, monochrome, colors,
});

/** Arch: TuxCopilot's own look, Arch blue on deep slate. Its values are the stylesheet's. */
export const ARCH = builtin("arch", "Arch", false, false, {
  background: "#0a0e14", foreground: "#dbe4ee", card: "#10161f", popover: "#111823",
  primary: "#1793d1", primaryForeground: "#06121c", secondary: "#172029", muted: "#141b25",
  mutedForeground: "#7c8b9e", accent: "#16222e", border: "#1d2733", sidebar: "#0c1118",
  term: "#080b10", termForeground: "#9fb0c3",
  good: "#3fb950", caution: "#d29922", bad: "#f85149", info: "#38bdf8", special: "#a371f7", onColor: "#ffffff",
});

const BUILT_IN: Palette[] = [
  ARCH,
  builtin("night", "Night", false, false, {
    // warm and dim, with no bright blue: for the evening
    background: "#14120f", foreground: "#d9cfbf", card: "#1b1814", popover: "#201c17",
    primary: "#d8a657", primaryForeground: "#1a1408", secondary: "#241f19", muted: "#1e1a15",
    mutedForeground: "#948a78", accent: "#2a241c", border: "#2e2820", sidebar: "#100e0c",
    term: "#0e0c0a", termForeground: "#c2b8a6",
    good: "#a9b665", caution: "#e0a458", bad: "#ea6962", info: "#7daea3", special: "#d3869b", onColor: "#14120f",
  }),
  builtin("sunny", "Sunny", true, false, {
    // light and warm, for daylight and bright rooms
    background: "#faf7f0", foreground: "#23221e", card: "#ffffff", popover: "#ffffff",
    primary: "#0f6fae", primaryForeground: "#ffffff", secondary: "#efeadf", muted: "#f2ede3",
    mutedForeground: "#5f5a4e", accent: "#e8e2d4", border: "#ddd6c6", sidebar: "#f3efe5",
    term: "#f1ece1", termForeground: "#2f2d27",
    good: "#1a7f37", caution: "#8a5a00", bad: "#c2202b", info: "#0b62c4", special: "#7a3fd1", onColor: "#ffffff",
  }),
  builtin("monochrome", "Monochrome", false, true, {
    background: "#161616", foreground: "#e8e8e8", card: "#1d1d1d", popover: "#222222",
    primary: "#d4d4d4", primaryForeground: "#121212", secondary: "#262626", muted: "#1f1f1f",
    mutedForeground: "#9a9a9a", accent: "#2a2a2a", border: "#2e2e2e", sidebar: "#121212",
    term: "#0f0f0f", termForeground: "#c8c8c8",
    good: "#d9d9d9", caution: "#a6a6a6", bad: "#ffffff", info: "#bdbdbd", special: "#8f8f8f", onColor: "#121212",
  }),
  builtin("true-black", "True black", false, true, {
    // pure black, greys only: for OLED screens and the darkest rooms
    background: "#000000", foreground: "#f0f0f0", card: "#0a0a0a", popover: "#111111",
    primary: "#e6e6e6", primaryForeground: "#000000", secondary: "#141414", muted: "#0d0d0d",
    mutedForeground: "#8f8f8f", accent: "#1a1a1a", border: "#1f1f1f", sidebar: "#000000",
    term: "#000000", termForeground: "#cfcfcf",
    good: "#dcdcdc", caution: "#a3a3a3", bad: "#ffffff", info: "#bababa", special: "#878787", onColor: "#000000",
  }),
];

export function builtIns(): Palette[] {
  const manga = fromKde(MANGA_MONOTONE, "manga-monotone");
  return manga ? [...BUILT_IN, { ...manga, from: "built in (a KDE colour scheme)" }] : BUILT_IN;
}

// ── colour vision ────────────────────────────────────────────────────────

// Okabe & Ito's colour-blind-safe set for red-green; red against teal for blue-yellow. Each in a
// dark-background and a light-background version, so the text stays readable either way.
const SAFE: Record<Exclude<Vision, "usual">, { dark: Partial<PaletteColors>; light: Partial<PaletteColors> }> = {
  "red-green": {
    dark: { good: "#56b4e9", caution: "#f0e442", bad: "#ff8c42", info: "#cc79a7", special: "#d0d0d0" },
    light: { good: "#0063a0", caution: "#7a6a00", bad: "#b84a00", info: "#9c3f78", special: "#555555" },
  },
  "blue-yellow": {
    dark: { good: "#3fd0c9", caution: "#ff9ccf", bad: "#ff6b6b", info: "#c8c8c8", special: "#e5e5e5" },
    light: { good: "#00796f", caution: "#b0306f", bad: "#c62828", info: "#4d4d4d", special: "#2b2b2b" },
  },
};

/** The palette's five meanings, as someone with this colour vision tells them apart best. */
export function forVision(p: Palette, vision: Vision): PaletteColors {
  if (vision === "usual" || p.monochrome) return p.colors; // greys need no colour vision
  return { ...p.colors, ...SAFE[vision][p.light ? "light" : "dark"] };
}

// ── into the interface ───────────────────────────────────────────────────

/** The stylesheet's own variables (globals.css), from a palette. */
export function cssVars(c: PaletteColors): Record<string, string> {
  const soft = (hex: string, alpha: string) => `${hex}${alpha}`;
  return {
    "--background": c.background, "--foreground": c.foreground,
    "--card": c.card, "--card-foreground": c.foreground,
    "--popover": c.popover, "--popover-foreground": c.foreground,
    "--primary": c.primary, "--primary-foreground": c.primaryForeground,
    "--secondary": c.secondary, "--secondary-foreground": c.foreground,
    "--muted": c.muted, "--muted-foreground": c.mutedForeground,
    "--accent": c.accent, "--accent-foreground": c.foreground,
    "--destructive": c.bad, "--border": c.border, "--input": c.border, "--ring": c.primary,
    "--chart-1": c.primary, "--chart-2": c.good, "--chart-3": c.caution, "--chart-4": c.special, "--chart-5": c.bad,
    "--sidebar": c.sidebar, "--sidebar-foreground": c.foreground,
    "--sidebar-primary": c.primary, "--sidebar-primary-foreground": c.primaryForeground,
    "--sidebar-accent": c.accent, "--sidebar-accent-foreground": c.foreground,
    "--sidebar-border": c.border, "--sidebar-ring": c.primary,
    "--arch": c.primary, "--arch-soft": soft(c.primary, "1f"),
    "--ok": c.good, "--warn": c.caution, "--bad": c.bad, "--info": c.info, "--dry": c.special,
    "--term": c.term, "--term-foreground": c.termForeground, "--code": mix(c.term, c.background, 0.5),
    "--selection": soft(c.primary, "55"), "--scrollbar": mix(c.border, c.foreground, 0.12), "--on-color": c.onColor,
  };
}

/** The variables a look sets — null for Arch with usual colours: the stylesheet itself shows. */
export function lookVars(p: Palette, vision: Vision): Record<string, string> | null {
  return p.id === ARCH.id && vision === "usual" ? null : cssVars(forVision(p, vision));
}

/** Which of the five meanings each Tailwind colour family speaks. */
export const FAMILIES: Record<string, keyof PaletteColors> = {
  emerald: "good", green: "good", teal: "good", lime: "good",
  amber: "caution", yellow: "caution", orange: "caution",
  red: "bad", rose: "bad",
  sky: "info", blue: "info", cyan: "info",
  violet: "special", purple: "special", indigo: "special", fuchsia: "special", pink: "special",
  zinc: "mutedForeground", gray: "mutedForeground", slate: "mutedForeground", neutral: "mutedForeground", stone: "mutedForeground",
};

const VAR: Partial<Record<keyof PaletteColors, string>> = {
  good: "--ok", caution: "--warn", bad: "--bad", info: "--info", special: "--dry", mutedForeground: "--muted-foreground",
};

/**
 * Every shade of those families drawn from its meaning: lighter shades lean towards the text
 * colour and darker ones towards the background, so they stay readable on light palettes too.
 * Used whenever the look is not Arch with usual colours (then Tailwind's own shades stay).
 */
export function familyCss(): string {
  const lean: Record<number, string> = {
    50: "18% var(--base), var(--foreground)", 100: "30% var(--base), var(--foreground)", 200: "50% var(--base), var(--foreground)",
    300: "75% var(--base), var(--foreground)", 400: "100% var(--base), var(--foreground)", 500: "85% var(--base), var(--background)",
    600: "70% var(--base), var(--background)", 700: "55% var(--base), var(--background)", 800: "40% var(--base), var(--background)",
    900: "28% var(--base), var(--background)", 950: "18% var(--base), var(--background)",
  };
  const lines: string[] = [];
  for (const [family, meaning] of Object.entries(FAMILIES)) {
    for (const [shade, how] of Object.entries(lean)) {
      const value = shade === "400" ? `var(${VAR[meaning]})` : `color-mix(in oklab, ${how.replace("var(--base)", `var(${VAR[meaning]})`)})`;
      lines.push(`  --color-${family}-${shade}: ${value};`);
    }
  }
  lines.push("  --color-white: var(--on-color);");
  return `:root[data-palette] {\n${lines.join("\n")}\n}\n`;
}

// ── KDE / Krita colour schemes (.colors) ─────────────────────────────────

/** [Section] → key → value, as KDE writes it. */
export function parseIni(text: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  let cur: Map<string, string> | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) {
      cur = out.get(sec[1]) ?? new Map();
      out.set(sec[1], cur);
    } else if (cur && line && !line.startsWith("#") && !line.startsWith(";") && line.includes("=")) {
      const at = line.indexOf("=");
      cur.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
    }
  }
  return out;
}

/** A KDE colour scheme as a palette (null when it holds no usable colours). */
export function fromKde(text: string, id?: string): Palette | null {
  const ini = parseIni(text);
  const get = (section: string, key: string, fallback?: string): string | undefined => {
    const v = ini.get(`Colors:${section}`)?.get(key);
    const m = v?.match(/^(\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})/);
    return m ? rgbToHex([+m[1], +m[2], +m[3]]) : fallback;
  };
  const bg = get("Window", "BackgroundNormal");
  const fg = get("Window", "ForegroundNormal");
  if (!bg || !fg) return null;
  const view = get("View", "BackgroundNormal", bg)!;
  const viewAlt = get("View", "BackgroundAlternate", mix(view, fg, 0.04))!;
  const light = luminance(bg) > 0.4;
  const sel = get("Selection", "BackgroundNormal", mix(bg, fg, 0.3))!;
  const fgOf = (key: string, fallback: string) => get("View", key, get("Window", key, fallback))!;
  const good = fgOf("ForegroundPositive", light ? "#1a7f37" : "#3fb950");
  const bad = fgOf("ForegroundNegative", light ? "#c2202b" : "#f85149");
  const grey = Math.max(...[good, bad].map((c) => saturation(c))) < 0.08;
  const name = ini.get("General")?.get("Name") ?? ini.get("General")?.get("ColorScheme") ?? "Imported scheme";
  return {
    id: id ?? `kde-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    name,
    from: "KDE / Krita colour scheme",
    light,
    monochrome: grey,
    colors: {
      background: bg,
      foreground: fg,
      // panels must stand apart from the window even when the scheme draws both alike
      card: view === bg ? viewAlt : view,
      popover: get("Tooltip", "BackgroundNormal", viewAlt)!,
      primary: sel,
      primaryForeground: get("Selection", "ForegroundNormal", contrast(sel, "#ffffff") > contrast(sel, "#000000") ? "#ffffff" : "#000000")!,
      secondary: get("Button", "BackgroundAlternate", mix(bg, fg, 0.06))!,
      muted: viewAlt,
      mutedForeground: get("View", "ForegroundInactive", mix(fg, bg, 0.45))!,
      accent: get("Button", "BackgroundAlternate", mix(bg, fg, 0.08))!,
      border: mix(bg, fg, light ? 0.14 : 0.12),
      sidebar: get("Complementary", "BackgroundNormal", mix(bg, light ? "#ffffff" : "#000000", 0.25))!,
      term: mix(bg, light ? "#ffffff" : "#000000", 0.35),
      termForeground: mix(fg, bg, 0.15),
      good,
      caution: fgOf("ForegroundNeutral", light ? "#8a5a00" : "#d29922"),
      bad,
      info: fgOf("ForegroundLink", light ? "#0b62c4" : "#38bdf8"),
      special: fgOf("ForegroundVisited", light ? "#7a3fd1" : "#a371f7"),
      onColor: light ? "#ffffff" : contrast(good, "#000000") > contrast(good, "#ffffff") ? "#000000" : "#ffffff",
    },
  };
}

function saturation(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/** A palette as a KDE colour scheme: KDE Plasma and Krita can use it. */
export function toKde(p: Palette, vision: Vision = "usual"): string {
  const c = forVision(p, vision);
  const rgb = (hex: string) => hexToRgb(hex).join(",");
  const set = (bg: string, alt: string, fg = c.foreground) =>
    [
      `BackgroundAlternate=${rgb(alt)}`, `BackgroundNormal=${rgb(bg)}`,
      `DecorationFocus=${rgb(c.primary)}`, `DecorationHover=${rgb(mix(c.primary, c.foreground, 0.3))}`,
      `ForegroundActive=${rgb(c.primary)}`, `ForegroundInactive=${rgb(c.mutedForeground)}`,
      `ForegroundLink=${rgb(c.info)}`, `ForegroundNegative=${rgb(c.bad)}`, `ForegroundNeutral=${rgb(c.caution)}`,
      `ForegroundNormal=${rgb(fg)}`, `ForegroundPositive=${rgb(c.good)}`, `ForegroundVisited=${rgb(c.special)}`,
    ].join("\n");
  const name = vision === "usual" ? p.name : `${p.name} (${VISIONS.find((v) => v.id === vision)!.name.toLowerCase()})`;
  return [
    "[Colors:Button]", set(c.secondary, c.accent), "",
    "[Colors:Complementary]", set(c.sidebar, c.card), "",
    "[Colors:Selection]", set(c.primary, mix(c.primary, c.background, 0.2), c.primaryForeground), "",
    "[Colors:Tooltip]", set(c.popover, c.card), "",
    "[Colors:View]", set(c.card, c.muted), "",
    "[Colors:Window]", set(c.background, c.muted), "",
    "[General]", `ColorScheme=${name.replace(/[^A-Za-z0-9]+/g, "")}`, `Name=${name}`, "",
    "[WM]",
    `activeBackground=${rgb(c.sidebar)}`, `activeBlend=${rgb(c.foreground)}`, `activeForeground=${rgb(c.foreground)}`,
    `inactiveBackground=${rgb(c.background)}`, `inactiveBlend=${rgb(c.mutedForeground)}`, `inactiveForeground=${rgb(c.mutedForeground)}`,
    "",
  ].join("\n");
}

// ── checking a palette before it is used ─────────────────────────────────

/** What would be hard to read; a palette from a file is used anyway, but you are told. */
export function readability(c: PaletteColors): string[] {
  const out: string[] = [];
  if (contrast(c.foreground, c.background) < 4.5) out.push("its text is faint against its background");
  if (contrast(c.mutedForeground, c.background) < 3) out.push("its quiet text is hard to read");
  if (contrast(c.primaryForeground, c.primary) < 3) out.push("text on its accent colour is hard to read");
  for (const k of ["good", "caution", "bad"] as const) if (contrast(c[k], c.background) < 3) out.push(`its “${k}” colour is faint`);
  return out;
}
