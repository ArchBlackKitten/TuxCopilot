// "Fully unused": system apps are listed — flagged System, after the removable ones — and still
// refused; packages with no menu entry (the kernel…) are never listed.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/host", () => ({
  errText: (e: unknown) => String(e),
  execRaw: async () => null,
  execOut: async (cmd: string, args: string[]) => {
    if (cmd === "pacman" && args[0] === "-Qe") return "vlc 3.0-1\ncosmic-settings 1.0-1\nlinux-cachyos 7.3-1\n";
    if (cmd === "pacman" && args[0] === "-Qem") return "";
    return null; // no flatpak
  },
  readText: async () => null,
  readDir: async () => [],
  httpGet: async () => null,
  openExternal: async () => {},
  saveTextFile: async () => null,
  inv: async (cmd: string) => {
    switch (cmd) {
      case "desktop_apps":
        return [{ package: "vlc" }, { package: "cosmic-settings" }];
      case "system_profile":
        return {
          osId: "cachyos", osName: "CachyOS", osChosen: false, detectedOsId: "cachyos", detectedOsName: "CachyOS",
          osOptions: [], desktop: "KDE", sessions: [], kernels: ["linux-cachyos"], bootloaders: [], loginScreen: null,
          shell: null, detectedAt: "",
          core: [
            { package: "cosmic-settings", reason: "part of the COSMIC desktop" },
            { package: "linux-cachyos", reason: "your kernel" },
          ],
        };
      case "usage_rows":
        return [];
      case "tracker_status":
        return { running: true, intervalSec: 30, startedAt: null, lastSampleAt: null, samples: 0, lastError: null, nowRunning: [], liveApps: [] };
      default:
        return null;
    }
  },
}));

const { usageSnapshot, eliminationPlans } = await import("@/lib/api");

describe("System flag", () => {
  it("lists system apps flagged, after the removable ones, and never the kernel", async () => {
    const snap = await usageSnapshot();
    expect(snap.unused.map((u) => [u.app, u.system])).toEqual([
      ["vlc", null],
      ["cosmic-settings", "part of the COSMIC desktop"],
    ]);
  });

  it("a flagged app is still refused", () => {
    expect(eliminationPlans("cosmic-settings", "pacman")).toMatchObject({ plans: [], protectedReason: "part of the COSMIC desktop" });
    expect(eliminationPlans("vlc", "pacman").plans).toHaveLength(3);
  });
});
