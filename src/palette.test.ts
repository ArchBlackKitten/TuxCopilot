// Palettes: the built-in ones readable under every colour vision, KDE / Krita colour schemes
// (Manga Monotone, and two as KDE ships them) read in and written back, and the Arch palette
// identical to the stylesheet, so choosing nothing changes nothing.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ARCH, FAMILIES, VISIONS, builtIns, lookVars, contrast, cssVars, familyCss, forVision, fromKde, hexToRgb, readability, toKde,
} from "@/lib/palette";

const fixture = (f: string) => readFileSync(join(__dirname, "test-fixtures", f), "utf8");
const MANGA = readFileSync(join(__dirname, "lib/palettes/MangaMonotone.colors"), "utf8");

describe("built-in palettes", () => {
  it("Monochrome, Night, Sunny, True black and Manga Monotone are there, beside Arch", () => {
    expect(builtIns().map((p) => p.name)).toEqual(["Arch", "Night", "Sunny", "Monochrome", "True black", "Manga Monotone"]);
    expect(builtIns().find((p) => p.id === "true-black")!.colors.background).toBe("#000000");
  });

  it("every one is readable under every colour vision", () => {
    for (const p of builtIns()) for (const v of VISIONS) expect(readability(forVision(p, v.id)), `${p.name}, ${v.name}`).toEqual([]);
  });

  it("Arch is the stylesheet's own colours; choosing it with usual colours applies nothing", () => {
    const css = readFileSync(join(__dirname, "globals.css"), "utf8");
    const root = css.slice(css.indexOf(":root,"), css.indexOf("@layer base"));
    // tints the stylesheet fine-tunes by hand; the stylesheet's own value shows for Arch
    const tuned = ["--secondary-foreground", "--accent-foreground", "--destructive", "--chart-2", "--chart-5", "--sidebar-accent", "--sidebar-border", "--code", "--scrollbar"];
    for (const [k, v] of Object.entries(cssVars(ARCH.colors))) {
      const m = root.match(new RegExp(`\\s${k}:\\s*([^;]+);`));
      expect(m, k).not.toBeNull();
      if (!tuned.includes(k)) expect(m![1].trim(), k).toBe(v);
    }
    expect(lookVars(ARCH, "usual")).toBeNull();
    expect(lookVars(ARCH, "red-green")?.["--ok"]).toBe("#56b4e9");
    expect(lookVars(builtIns()[1], "usual")?.["--background"]).toBe("#14120f");
  });
});

describe("colour vision", () => {
  const hue = (hex: string) => {
    const [r, g, b] = hexToRgb(hex);
    return g > r && g > b ? "green" : b > r ? "blue" : "red";
  };

  it("red-green safe: good is blue, never green; bad stays apart from good", () => {
    for (const p of builtIns().filter((x) => !x.monochrome)) {
      const c = forVision(p, "red-green");
      expect(hue(c.good), p.name).toBe("blue");
      expect(c.bad).not.toBe(c.good);
    }
  });

  it("blue-yellow safe: good and bad are teal and red", () => {
    const c = forVision(builtIns().find((p) => p.id === "night")!, "blue-yellow");
    expect([hue(c.good), hue(c.bad)]).toEqual(["green", "red"]);
  });

  it("greys need no colour vision: monochrome palettes stay as they are", () => {
    const mono = builtIns().find((p) => p.id === "monochrome")!;
    expect(forVision(mono, "red-green")).toBe(mono.colors);
  });

  it("every colour family the app uses speaks one of the five meanings, at every shade", () => {
    const css = familyCss();
    for (const f of ["emerald", "amber", "red", "sky", "violet", "orange", "cyan", "indigo", "rose", "zinc"]) {
      expect(FAMILIES[f], f).toBeDefined();
      for (const s of [50, 200, 300, 400, 500, 600]) expect(css).toContain(`--color-${f}-${s}:`);
    }
    expect(css).toContain("--color-emerald-400: var(--ok);");
    expect(css).toContain("--color-red-300: color-mix(in oklab, 75% var(--bad), var(--foreground));");
  });
});

describe("KDE / Krita colour schemes", () => {
  it("Manga Monotone: greys only, its panels apart from its window", () => {
    const p = fromKde(MANGA)!;
    expect(p).toMatchObject({ name: "Manga Monotone", light: false, monochrome: true });
    expect(p.colors).toMatchObject({ background: "#141413", foreground: "#ebe9e1", card: "#191918", primary: "#64645f", good: "#bebeb9", bad: "#8c8c87" });
    expect(readability(p.colors)).toEqual([]);
  });

  it("Krita Dark and Breeze Light, as KDE ships them", () => {
    const krita = fromKde(fixture("KritaDark.colors"))!;
    expect(krita).toMatchObject({ light: false, monochrome: false });
    const breeze = fromKde(fixture("BreezeLight.colors"))!;
    expect(breeze).toMatchObject({ name: "Breeze Light", light: true });
    expect(contrast(breeze.colors.foreground, breeze.colors.background)).toBeGreaterThan(7);
  });

  it("not a colour scheme: nothing", () => {
    expect(fromKde("hello")).toBeNull();
    expect(fromKde("[Colors:Window]\nBackgroundNormal=1,2,3\n")).toBeNull();
  });

  it("written out for KDE or Krita, and read back the same", () => {
    for (const p of builtIns()) {
      const back = fromKde(toKde(p))!;
      for (const k of ["background", "foreground", "primary", "good", "bad", "caution", "info", "special"] as const) expect(back.colors[k], `${p.name} ${k}`).toBe(p.colors[k]);
      expect(back.name).toBe(p.name);
    }
    expect(fromKde(toKde(ARCH, "red-green"))!).toMatchObject({ name: "Arch (red-green safe)" });
  });
});
