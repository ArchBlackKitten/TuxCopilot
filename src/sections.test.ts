// The sections in your order, dragged by their ≡ handle. Kept with your look; Apply saves it.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/host", () => ({
  errText: (e: unknown) => String(e),
  inv: async () => null,
  execRaw: async () => null,
  execOut: async () => null,
  readText: async () => null,
  readDir: async () => [],
  httpGet: async () => null,
  openExternal: async () => {},
  saveTextFile: async () => null,
}));

const { dropIndex, isOwnOrder, moveSection, orderedSections, orderLabel } = await import("@/lib/sections");
const { cleanLook, DEFAULT_LOOK } = await import("@/lib/look");
const { useArch } = await import("@/components/arch/store");
const { EMPTY_HISTORY } = await import("@/lib/changes");

const NAV = ["home", "apps", "tor", "settings"].map((id) => ({ id }));
const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id);

describe("the sections in your order", () => {
  it("your order; none saved is TuxCopilot's own", () => {
    expect(ids(orderedSections(NAV, []))).toEqual(["home", "apps", "tor", "settings"]);
    expect(ids(orderedSections(NAV, ["tor", "home", "settings", "apps"]))).toEqual(["tor", "home", "settings", "apps"]);
  });

  it("a section added later appears after the one before it, not lost; one that is gone is left out", () => {
    expect(ids(orderedSections(NAV, ["settings", "home", "tor"]))).toEqual(["settings", "home", "apps", "tor"]); // apps came after home
    expect(ids(orderedSections(NAV, ["tor", "gone", "apps", "home", "settings"]))).toEqual(["tor", "apps", "home", "settings"]);
    // only settings placed: the others come back around it in their own order (each after the one before it)
    expect(ids(orderedSections(NAV, ["settings"]))).toEqual(["home", "apps", "tor", "settings"]);
    expect(ids(orderedSections(NAV, ["apps", "home"]))).toEqual(["apps", "home", "tor", "settings"]);
  });

  it("moving one, and where a drag lands", () => {
    expect(moveSection(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveSection(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveSection(["a", "b"], 0, 5)).toEqual(["a", "b"]); // nowhere: unchanged
    expect(dropIndex([10, 30, 50], 5)).toBe(0);
    expect(dropIndex([10, 30, 50], 31)).toBe(2);
    expect(dropIndex([10, 30, 50], 99)).toBe(2); // below the last: the last place
  });

  it("TuxCopilot's own order, however it was said, is nothing to keep", () => {
    expect(isOwnOrder(NAV, [])).toBe(true);
    expect(isOwnOrder(NAV, ["home", "apps", "tor", "settings"])).toBe(true);
    expect(isOwnOrder(NAV, ["apps", "home"])).toBe(false);
  });

  it("the order is kept with your look, cleaned: only plain ids, no repeats", () => {
    expect(DEFAULT_LOOK.order).toEqual([]);
    expect(cleanLook({ order: ["tor", "tor", "home", 3, "Bad Id", "../x", "x".repeat(31)] }).order).toEqual(["tor", "home"]);
    expect(cleanLook({ palette: "arch" }).order).toEqual([]);
  });

  it("the label keeps what a waiting look change said, in both directions", () => {
    expect(orderLabel(null, false)).toBe("Sections in your order");
    expect(orderLabel("Palette: Nord", false)).toBe("Palette: Nord · sections in your order");
    expect(orderLabel("Palette: Nord · sections in your order", true)).toBe("Palette: Nord · sections in TuxCopilot's own order");
    expect(orderLabel("Sections in your order", false)).toBe("Sections in your order");
    useArch.setState({ history: EMPTY_HISTORY, savedLook: DEFAULT_LOOK, look: DEFAULT_LOOK });
    useArch.getState().setLook({ ...DEFAULT_LOOK, order: ["tor", "home"], palette: "nord" }, "Palette: Nord");
    expect(useArch.getState().history.pending.map((c) => c.label)).toEqual(["Palette: Nord · sections in your order"]);
    useArch.setState({ history: EMPTY_HISTORY });
    useArch.getState().setLook({ ...DEFAULT_LOOK, palette: "nord" }, "Palette: Nord");
    expect(useArch.getState().history.pending.map((c) => c.label)).toEqual(["Palette: Nord"]);
  });

  it("whatever is saved, every section is shown, once", () => {
    for (const order of [[], ["settings"], ["tor", "tor", "x", "home"], ["settings", "tor", "apps", "home"]]) {
      expect(ids(orderedSections(NAV, order)).sort(), order.join(",")).toEqual(["apps", "home", "settings", "tor"]);
    }
  });
});
