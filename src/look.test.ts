// The look and look files: a look exported and imported again is the same look, damaged or
// dangerous files are refused with a reason, and palettes join and leave your imported ones.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_LOOK, cleanIcon, cleanLook, fromLookFile, paletteOf, sameIcon, toLookFile, withPalette, withLookFile, withoutPalette, type Look } from "@/lib/look";
import { builtIns, fromKde } from "@/lib/palette";

const SVG = readFileSync(join(__dirname, "../Arts/Icon/Penguin.svg"), "utf8");
const krita = fromKde(readFileSync(join(__dirname, "test-fixtures/KritaDark.colors"), "utf8"))!;

describe("look files", () => {
  it("export, import: the same colours, colour vision and icon", () => {
    const mine: Look = { ...withPalette(DEFAULT_LOOK, krita), vision: "red-green", icon: { name: "Penguin.svg", svg: SVG } };
    const p = fromLookFile(toLookFile(mine, "Night owl"));
    if (typeof p === "string") throw new Error(p);
    expect(p.name).toBe("Night owl");
    expect(p.palette.colors).toEqual(krita.colors);
    expect(p.palette.id).toBe(`look-${krita.id}`); // a look file's palette is its own
    const theirs = withLookFile(DEFAULT_LOOK, p);
    expect(paletteOf(theirs).colors).toEqual(krita.colors);
    expect(theirs.vision).toBe("red-green");
    expect(sameIcon(theirs.icon, mine.icon)).toBe(true);
  });

  it("a look file wearing a built-in palette unchanged keeps it built in", () => {
    const night = builtIns().find((b) => b.id === "night")!;
    const p = fromLookFile(toLookFile({ ...DEFAULT_LOOK, palette: "night" }, "x"));
    if (typeof p === "string") throw new Error(p);
    expect(p.palette.id).toBe("night");
    expect(withLookFile(DEFAULT_LOOK, p).imported).toEqual([]);
    expect(paletteOf(withLookFile(DEFAULT_LOOK, p))).toEqual(night);
  });

  it("refused, each with the reason", () => {
    expect(fromLookFile("not json")).toMatch(/not a look file/);
    expect(fromLookFile('{"hello":1}')).toMatch(/not a look file/);
    expect(fromLookFile('{"tuxcopilot":"look","version":2}')).toMatch(/newer TuxCopilot/);
    expect(fromLookFile('{"tuxcopilot":"penguin","version":1}')).toMatch(/not a look file/); // Fluff's belongings are all of TuxCopilot, not a look
    const good = JSON.parse(toLookFile(DEFAULT_LOOK, "x"));
    expect(fromLookFile(JSON.stringify({ ...good, palette: { ...good.palette, colors: { ...good.palette.colors, background: "red; }" } } }))).toMatch(/colours are damaged/);
    for (const svg of [
      '<svg onload="alert(1)"></svg>',
      "<svg><script>alert(1)</script></svg>",
      '<svg><image href="https://example.com/x.png"/></svg>',
      '<svg><a xlink:href="javascript:alert(1)"/></svg>',
    ]) expect(fromLookFile(JSON.stringify({ ...good, icon: { name: "x", svg } })), svg).toMatch(/icon was refused/);
  });
});

describe("the look", () => {
  it("icons: an SVG or a PNG data URL, nothing else", () => {
    expect(cleanIcon({ name: "p", svg: SVG })?.svg).toBe(SVG);
    expect(cleanIcon({ name: "p", png: "data:image/png;base64,iVBORw0KGgo=" })).not.toBeNull();
    expect(cleanIcon({ name: "p", png: "data:text/html;base64,PGh0bWw+" })).toBeNull();
    expect(cleanIcon({ name: "p", svg: "<html></html>" })).toBeNull();
  });

  it("whatever the database holds, a usable look comes out", () => {
    expect(cleanLook(null)).toEqual(DEFAULT_LOOK);
    expect(cleanLook({ palette: "night", vision: "bogus", imported: [{ id: "x" }], icon: { svg: 1 } })).toEqual({ ...DEFAULT_LOOK, palette: "night" });
    expect(paletteOf({ ...DEFAULT_LOOK, palette: "gone" }).id).toBe("arch");
  });

  it("palettes join your imported ones, replace their namesake, and leave", () => {
    let l = withPalette(DEFAULT_LOOK, krita);
    l = withPalette(l, { ...krita, name: "Krita Dark again" });
    expect(l.imported.map((p) => p.name)).toEqual(["Krita Dark again"]);
    expect(l.palette).toBe(krita.id);
    l = withoutPalette(l, krita.id);
    expect(l).toEqual(DEFAULT_LOOK);
  });
});
