// The guide: a pop-up that walks the whole app, the next thing
// to press glowing; No guide · Guide me · Skip this step; it asks home / work / public for each
// network, and about games — a laptop is read, never asked.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gamesWords, glowFor, GUIDE, isThere, kindOf, laptopWords, next, ZONE_FOR } from "@/lib/guide";
import { PARTS as ACCOUNTS } from "@/lib/level-accounts";
import { SETTINGS } from "@/lib/hardening";

const src = (p: string) => readFileSync(p, "utf8");
const nav = [...src("src/App.tsx").matchAll(/\{ id: "([a-z]+)", label: "[^"]+", icon:/g)].map((m) => m[1]);

describe("the whole app, one step at a time", () => {
  it("every section of the side menu has its step, in the menu's order; Dry Run first, Apply last", () => {
    expect(nav.length).toBe(16);
    const sections = [...new Set(GUIDE.map((s) => s.view))];
    expect(sections).toEqual(nav);
    expect(GUIDE[0].id).toBe("dryrun");
    expect(GUIDE.at(-1)!.id).toBe("apply");
    expect(new Set(GUIDE.map((s) => s.id)).size).toBe(GUIDE.length);
  });

  it("everything that glows is on the screen to glow", () => {
    const all = [
      "src/App.tsx", "src/components/arch/changes-bar.tsx", "src/components/arch/level-sections.tsx", "src/components/arch/level-cards.tsx",
      "src/components/arch/boot-panel.tsx", "src/components/arch/report-panel.tsx", "src/components/arch/settings-view.tsx",
    ].map(src).join("\n");
    for (const s of GUIDE.filter((x) => x.glow)) expect(all, s.id).toContain(`data-guide="${s.glow}"`);
    expect(src("src/components/arch/section-nav.tsx")).toContain("data-guide={`nav-${id}`}");
    expect(src("src/App.tsx")).toContain("data-guide={`nav-${id}`}"); // the narrow window's row of icons too (the visible one glows)
    expect(src("src/components/arch/guide.tsx")).toContain("(e as HTMLElement).offsetParent !== null");
    expect(src("src/components/arch/security-view.tsx")).toContain("data-guide={`tab-${id}`}");
  });

  it("the glow points at what to press next: the section's button, Security's tab, then what to look at", () => {
    const net = GUIDE.find((s) => s.id === "networks")!;
    expect(glowFor(net, "home", "glance")).toBe("nav-security");
    expect(glowFor(net, "security", "glance")).toBe("tab-network");
    expect(glowFor(net, "security", "network")).toBe("levels");
    expect(glowFor(GUIDE.find((s) => s.id === "ports")!, "ports", "glance")).toBeNull(); // the section itself
  });

  it("Next does what the glow points at, then moves on; Done at the end", () => {
    const i = GUIDE.findIndex((s) => s.id === "networks");
    expect(next(i, "home", "glance")).toEqual({ go: GUIDE[i] });
    expect(next(i, "security", "glance")).toEqual({ go: GUIDE[i] }); // still the wrong tab
    expect(next(i, "security", "network")).toEqual({ step: i + 1 });
    expect(next(GUIDE.length - 1, "settings", "glance")).toEqual({ end: true });
    expect(isThere(GUIDE[0], "home", "system")).toBe(true); // a step without a tab doesn't care which
  });
});

describe("what it asks, and what it reads", () => {
  it("networks: home and work their own zone; public back to the default (not home, not touched = public)", () => {
    expect(ZONE_FOR).toEqual({ home: "home", work: "work", public: "" });
    expect([kindOf(""), kindOf("public"), kindOf("home"), kindOf("work"), kindOf("trusted")]).toEqual(["public", "public", "home", "work", null]);
    const g = src("src/components/arch/guide.tsx");
    expect(g).toContain("networkZoneCommand(n, ZONE_FOR[k])"); // runs like any change: "Are you sure?" first
    expect(g).toContain("choosableNetworks(f)"); // Wi-Fi and cable only: VPNs are left as they are
  });

  it("games: Secured over Hardened, because of what Hardened's kernel costs games", () => {
    const ptrace = SETTINGS.find((x) => x.key === "kernel.yama.ptrace_scope")!;
    expect(ptrace.cost).toMatch(/anti-cheat/);
    expect(gamesWords(true)).toBe(`You play games: Fluff recommends Secured, not Hardened. ${ptrace.cost}`); // only what costs games
    expect(gamesWords(false)).toBe("No games: any level suits this computer.");
  });

  it("a laptop is read, never asked — and what it says is what Good security sets", () => {
    expect(ACCOUNTS.good).toMatchObject({ lock: "5:0", lid: "locks" });
    expect(laptopWords(true)).toMatch(/close the lid and after five minutes away, and asks your password at once/);
    expect(src("src/components/arch/guide.tsx")).toContain("screenLock().then((s) => setLaptop(s.laptop)");
  });
});

describe("offered at the first start, any time from Settings", () => {
  it("after a fresh start: Guide me or No guide; moving Fluff in skips it", () => {
    const w = src("src/components/arch/welcome-dialog.tsx");
    expect(w).toContain("if (!thenImport && !offer) return setOffer(true);");
    expect(w).toMatch(/No guide[^]*Guide me/);
    expect(src("src/components/arch/settings-view.tsx")).toContain("Show me around");
    expect(src("src/App.tsx")).toContain("<Guide />");
  });

  it("the card: Next, Skip this step, No guide; the glow pulses, or only glows without motion", () => {
    const g = src("src/components/arch/guide.tsx");
    for (const w of ["Skip this step", "No guide", '"Done" : "Next"']) expect(g).toContain(w);
    const css = src("src/globals.css");
    expect(css).toMatch(/\.guide-glow \{[^}]*animation: guide-pulse/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.guide-glow \{\s*animation: none;/);
  });
});
