// On CachyOS, its own mirror tool, never reflector.
// cachyos-rate-mirrors ranks Arch's list (CachyOS's own fast Arch mirror first) and CachyOS's, and
// keeps a copy of each; reflector would rewrite Arch's alone and drop that mirror.
import { describe, expect, it } from "vitest";
import { CACHYOS_MIRRORS_NOW, CACHYOS_MIRRORS_WEEKLY, MIRRORS_NOW, MIRRORS_WEEKLY, mirrorsStep, REFLECTOR_TIMER_OFF, type UpdatesFacts } from "@/lib/updates";

const arch: UpdatesFacts = { repo: [], repoError: null, aur: [], lastUpgrade: null, btrfs: true, snapperRoot: true, snapPac: true, limineSnapper: false, mirrorlistDays: 3, reflector: true, reflectorTimer: true };
const cachy: UpdatesFacts = { ...arch, reflectorTimer: false, cachyosMirrors: true, cachyosMirrorsTimer: true };

describe("mirrors: the right tool for the system", () => {
  it("CachyOS (its timer on, reflector's off): fresh, nothing to press", () => {
    const s = mirrorsStep(cachy);
    expect(s).toMatchObject({ level: "ok", title: "Your mirror list is fresh (3 days old)" });
    expect(s.detail).toMatch(/cachyos-rate-mirrors keeps them fresh by itself/);
    expect(s.fix).toBeUndefined();
  });

  it("CachyOS, old: Fresh mirrors now is CachyOS's own tool, never reflector", () => {
    const s = mirrorsStep({ ...cachy, mirrorlistDays: 60 });
    expect(s.level).toBe("warn");
    expect(s.fix).toEqual({ label: "Fresh mirrors now", command: CACHYOS_MIRRORS_NOW });
    expect(JSON.stringify(s)).not.toContain("reflector --");
  });

  it("CachyOS, its timer off: Every week switches CachyOS's on, not reflector's", () => {
    expect(mirrorsStep({ ...cachy, cachyosMirrorsTimer: false }).fix).toEqual({ label: "Every week", command: CACHYOS_MIRRORS_WEEKLY });
  });

  it("CachyOS with reflector's timer on too: two tools fighting, and reflector's is the one to switch off", () => {
    const s = mirrorsStep({ ...cachy, reflectorTimer: true });
    expect(s).toMatchObject({ level: "warn", title: "Two tools rewrite your mirror list" });
    expect(s.fix?.command).toBe(REFLECTOR_TIMER_OFF);
  });

  it("plain Arch: reflector, as before", () => {
    expect(mirrorsStep({ ...arch, mirrorlistDays: 60 }).fix?.command).toBe(MIRRORS_NOW);
    expect(mirrorsStep({ ...arch, reflectorTimer: false }).fix?.command).toBe(MIRRORS_WEEKLY);
    expect(mirrorsStep({ ...arch, cachyosMirrors: false, mirrorlistDays: 60 }).fix?.command).toBe(MIRRORS_NOW);
  });

  it("the commands", () => {
    expect(CACHYOS_MIRRORS_NOW).toBe("sudo cachyos-rate-mirrors");
    expect(CACHYOS_MIRRORS_WEEKLY).toBe("sudo systemctl enable --now cachyos-rate-mirrors.timer");
    expect(REFLECTOR_TIMER_OFF).toBe("sudo systemctl disable --now reflector.timer");
  });
});
