// The look, put on the window: the palette's colours as the stylesheet's variables, and the
// icon drawn at every size on a canvas — for the header, the window, and the menu. Browser
// only (it needs the page); what it applies is decided in palette.ts and look.ts.

import PENGUIN_SVG from "../../src-tauri/icons/icon.svg?raw";
import { inv } from "./host";
import type { Integrity } from "./integrity";
import { familyCss, lookVars } from "./palette";
import { paletteOf, type Look, type LookIcon } from "./look";

let appliedKeys: string[] = [];

/** Colours: set the variables (or remove them, for Arch with usual colours) and the shades. */
export function applyLook(look: Look): void {
  const root = document.documentElement;
  if (!document.getElementById("look-families")) {
    const style = document.createElement("style");
    style.id = "look-families";
    style.textContent = familyCss();
    document.head.appendChild(style);
  }
  const p = paletteOf(look);
  const vars = lookVars(p, look.vision);
  for (const k of appliedKeys) root.style.removeProperty(k);
  appliedKeys = [];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    appliedKeys = Object.keys(vars);
    root.setAttribute("data-palette", p.id);
  } else {
    root.removeAttribute("data-palette");
  }
  root.classList.toggle("dark", !p.light);
  // the window's own controls (dropdown lists, scrollbars, date pickers) follow too: no white
  // boxes in a dark palette
  root.style.colorScheme = p.light ? "light" : "dark";
}

const utf8ToBase64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/** Something an <img> can show: the chosen icon, or Fluff. */
export function iconUrl(icon: LookIcon | null): string {
  if (icon?.png) return icon.png;
  return `data:image/svg+xml;base64,${utf8ToBase64(icon?.svg ?? PENGUIN_SVG)}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("this picture could not be drawn"));
    img.src = src;
  });
}

/** The picture centred in a square of `size`, keeping its proportions. */
function draw(img: HTMLImageElement, size: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const w = img.naturalWidth || size;
  const h = img.naturalHeight || size;
  const k = size / Math.max(w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (size - w * k) / 2, (size - h * k) / 2, w * k, h * k);
  return c;
}

const SIZES = [32, 64, 128, 256, 512];

/** The window's icon now (it shows at once, before Apply). */
export async function setWindowIcon(icon: LookIcon | null): Promise<void> {
  const c = draw(await loadImage(iconUrl(icon)), 256);
  const rgba = c.getContext("2d")!.getImageData(0, 0, 256, 256).data;
  let bin = "";
  for (let i = 0; i < rgba.length; i += 0x8000) bin += String.fromCharCode(...rgba.subarray(i, i + 0x8000));
  await inv("window_icon", { rgba: btoa(bin), size: 256 });
}

/** The menu's icon, at every size, and the copy that survives updates (on Apply). */
export async function setMenuIcon(icon: LookIcon | null): Promise<void> {
  const img = await loadImage(iconUrl(icon));
  const pngs: Array<[number, string]> = SIZES.map((s) => [s, draw(img, s).toDataURL("image/png").split(",")[1]]);
  await inv("menu_icon", { pngs, svg: icon ? (icon.svg ?? null) : PENGUIN_SVG, custom: icon !== null });
}

/** A picture you picked, as an icon: SVGs stay SVGs (sharp at any size), PNGs stay PNGs. */
export async function iconFromFile(name: string, base64: string): Promise<LookIcon> {
  if (/\.svg$/i.test(name)) {
    const bin = atob(base64);
    const svg = new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
    return { name, svg };
  }
  // a PNG: drawn once at 512, so a huge picture does not travel with every change
  const c = draw(await loadImage(`data:image/png;base64,${base64}`), 512);
  return { name, png: c.toDataURL("image/png") };
}

export const decodeText = (base64: string) => new TextDecoder().decode(Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0)));

/** A file you pick, with what its checksum and signature say (see integrity.ts). */
export const openFile = (kind: "look" | "colors" | "picture" | "backup" | "recovery") =>
  inv<{ name: string; base64: string; integrity: Integrity } | null>("open_file", { kind });
export const colorSchemes = () => inv<Array<{ path: string; text: string }>>("color_schemes");
