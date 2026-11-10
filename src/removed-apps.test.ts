// An app removed from the machine drops out of both lists, even with usage history; and
// the app list is read again after a removal instead of staying cached.
import { describe, expect, it, vi } from "vitest";

let installed = ["vlc", "dolphin"];
let calls = 0;
const settings = new Map<string, string>();
let noMenu: string[] = []; // still installed, but their menu entry went away

vi.mock("@/lib/host", () => ({
  errText: (e: unknown) => String(e),
  execRaw: async () => null,
  execOut: async (cmd: string, args: string[]) => {
    if (cmd === "pacman" && args[0] === "-Qe") {
      calls++;
      return installed.map((p) => `${p} 1.0-1`).join("\n");
    }
    if (cmd === "pacman" && args[0] === "-Qem") return "";
    if (cmd === "pacman" && args[0] === "-Qq") return installed.join("\n");
    return null; // no flatpak, no snap
  },
  readText: async () => null,
  readDir: async () => [],
  httpGet: async () => null,
  openExternal: async () => {},
  saveTextFile: async () => null,
  inv: async (cmd: string, args: Record<string, string> = {}) => {
    switch (cmd) {
      case "setting_get":
        return settings.get(args.key) ?? null;
      case "setting_set":
        settings.set(args.key, args.value);
        return null;
      case "desktop_apps":
        return installed.filter((p) => !noMenu.includes(p)).map((p) => ({ package: p }));
      case "usage_rows":
        return [
          { day: "2026-10-26", month: "2026-10", app: "discord", source: "pacman", seconds: 600, sessions: 2 },
          { day: "2026-10-26", month: "2026-10", app: "dolphin", source: "pacman", seconds: 60, sessions: 1 },
          { day: "2026-09-02", month: "2026-09", app: "discord", source: "pacman", seconds: 60, sessions: 1 },
        ];
      case "tracker_status":
        return { running: true, intervalSec: 30, startedAt: null, lastSampleAt: null, samples: 0, lastError: null, nowRunning: [], liveApps: [] };
      default:
        return null;
    }
  },
}));

const { usageSnapshot, machineChanged, removedAppsLog } = await import("@/lib/api");
const { parseSnapList, parseSnapVersion } = await import("@/lib/apps-detect");
const { flatpakCommand, snapCommand, composeSteps } = await import("@/lib/composer");

describe("removed apps", () => {
  it("are not ranked and not offered as unused, but are named", async () => {
    const snap = await usageSnapshot("2026-10");
    expect(snap.ranking.map((r) => r.app)).toEqual(["dolphin"]);
    expect(snap.unused.map((r) => r.app)).toEqual(["vlc"]);
    expect(snap.removed).toEqual(["discord"]);
  });

  it("a removal is seen at once: the cached list is read again", async () => {
    await usageSnapshot("2026-10");
    const before = calls;
    installed = ["dolphin"]; // vlc removed
    await machineChanged();
    const snap = await usageSnapshot("2026-10");
    expect(calls).toBe(before + 1);
    expect(snap.unused.map((r) => r.app)).toEqual([]);
    expect(snap.removed).toEqual(["discord"]);
  });
});

describe("snap list", () => {
  it("lists apps, never bases, snapd or shared runtimes", () => {
    const out = [
      "Name               Version   Rev    Tracking       Publisher   Notes",
      "core22             20240111  1122   latest/stable  canonical✓  base",
      "firefox            131.0     5000   latest/stable  mozilla✓    -",
      "gtk-common-themes  0.1-81    1535   latest/stable  canonical✓  -",
      "snapd              2.63      21759  latest/stable  canonical✓  snapd",
      "gnome-42-2204      0+git     176    latest/stable  canonical✓  -",
      "code               1.94      172    latest/stable  vscode✓     classic",
    ].join("\n");
    expect(parseSnapList(out).map((a) => a.name)).toEqual(["firefox", "code"]);
  });
});

describe("the removal log (History)", () => {
  it("logs each app once when it leaves, and marks it when it comes back", async () => {
    // after the tests above: discord (history) and vlc (seen before) are gone
    const log = await removedAppsLog();
    expect(log.map((e) => e.app).sort()).toEqual(["discord", "vlc"]);
    await usageSnapshot("2026-10"); // looking again does not log them twice
    expect((await removedAppsLog()).length).toBe(2);

    installed = ["dolphin", "vlc"]; // vlc reinstalled
    await machineChanged();
    expect((await removedAppsLog()).find((e) => e.app === "vlc")?.back).toBe(true);

    installed = ["dolphin"]; // and removed again: a new entry
    await machineChanged();
    expect((await removedAppsLog()).filter((e) => e.app === "vlc").length).toBe(2);
  });

  it("an app that only lost its menu entry is not logged as removed", async () => {
    // still a package (pacman -Qq has it) but no longer in the app list
    const before = (await removedAppsLog()).length;
    noMenu = ["dolphin"];
    await machineChanged();
    const snap = await usageSnapshot("2026-10");
    expect(snap.removed).not.toContain("dolphin");
    expect((await removedAppsLog()).length).toBe(before);
    noMenu = [];
  });
});

describe("snapd state", () => {
  it("a stopped snapd is told apart from a running one (snap list would hang)", () => {
    expect(parseSnapVersion("snap    2.78-1\nsnapd   unavailable\nseries  -\n")).toBe("stopped");
    expect(parseSnapVersion("snap    2.78-1\nsnapd   2.78-1\nseries  16\narch    7.3\n")).toBe("running");
  });
});

describe("Play for flatpaks and snaps", () => {
  const node = (id: string, source: "flatpak" | "snap", content: string) => ({
    id, name: id, category: "download" as const, source, content, enabled: true, order: 0, parentId: null, children: [],
  });

  it("flatpaks: one user install from Flathub, Flathub added first", () => {
    const { steps } = composeSteps([node("a", "flatpak", "org.gimp.GIMP"), node("b", "flatpak", "org.kde.krita")], { scope: "all", needed: true });
    expect(steps.map((s) => s.command)).toEqual([flatpakCommand(["org.gimp.GIMP", "org.kde.krita"])]);
    expect(steps[0].command).toMatch(/^flatpak remote-add --user --if-not-exists flathub .* && flatpak install --user -y --noninteractive flathub org\.gimp\.GIMP org\.kde\.krita$/);
  });

  it("snaps: one step each, --classic carried from the item", () => {
    const { steps } = composeSteps([node("a", "snap", "code --classic"), node("b", "snap", "spotify")], { scope: "all", needed: true });
    expect(steps.map((s) => s.command)).toEqual([snapCommand("code", true), snapCommand("spotify", false)]);
    expect(steps[0].command).toBe("sudo snap install --classic code");
  });
});
