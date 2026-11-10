// Every app is listed once: `pacman -Qe` lists AUR packages too, `-Qem` names them as AUR.
// (A bug once showed AUR apps twice in Home's disk widget.)
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/host", () => ({
  errText: (e: unknown) => String(e),
  execRaw: async () => null,
  execOut: async (cmd: string, args: string[]) => {
    if (cmd === "pacman" && args[0] === "-Qe") return "vlc 3.0-1\nvisual-studio-code-bin 1.2-1\nrustdesk-bin 1.4-1\n";
    if (cmd === "pacman" && args[0] === "-Qem") return "visual-studio-code-bin 1.2-1\nrustdesk-bin 1.4-1\n";
    return null;
  },
  inv: async (cmd: string) => {
    if (cmd === "desktop_apps") return [{ package: "vlc" }, { package: "visual-studio-code-bin" }, { package: "rustdesk-bin" }];
    if (cmd === "system_profile") return null;
    return null;
  },
  readText: async () => null,
  readDir: async () => [],
  httpGet: async () => null,
  openExternal: async () => {},
  saveTextFile: async () => null,
}));

const { detectInstalledApps } = await import("@/lib/apps-detect");

describe("installed apps", () => {
  it("each once; AUR ones as AUR", async () => {
    const d = await detectInstalledApps(true);
    expect(d.apps.map((a) => `${a.name}:${a.kind}`).sort()).toEqual(["rustdesk-bin:aur", "visual-studio-code-bin:aur", "vlc:pacman"]);
  });
});
