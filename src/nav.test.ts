// Back / Up / Forward: you never lose the page you were on.
import { describe, expect, it } from "vitest";
import { useArch } from "@/components/arch/store";

const at = () => {
  const s = useArch.getState();
  return `${s.view}${s.appPage ? `/${s.appPage.app}` : ""}${s.commandPage ? `/${s.commandPage}` : ""}`;
};

describe("going back and forth", () => {
  it("Back retraces your steps, Forward goes again, a new step forgets the way forward", () => {
    const s = () => useArch.getState();
    s().setView("home");
    s().setView("apps");
    s().openAppPage("krita", "pacman");
    s().openCommand("mkdir");
    s().openCommand("chmod");
    expect(at()).toBe("commands/chmod");
    s().goBack();
    expect(at()).toBe("commands/mkdir");
    s().goBack();
    expect(at()).toBe("apps/krita");
    s().goForward();
    expect(at()).toBe("commands/mkdir");
    s().setView("tor");
    expect(s().nav.future).toEqual([]);
    s().goBack();
    expect(at()).toBe("commands/mkdir");
  });

  it("Up goes one level: a page to its list, a section to Home", () => {
    const s = () => useArch.getState();
    s().openCommand("ls");
    s().goUp();
    expect(at()).toBe("commands");
    s().goUp();
    expect(at()).toBe("home");
    s().goBack();
    expect(at()).toBe("commands");
  });

  it("the same place twice is one step, not two", () => {
    const s = () => useArch.getState();
    s().setView("ports");
    const n = s().nav.past.length;
    s().setView("ports");
    expect(s().nav.past.length).toBe(n);
  });
});

describe("each page keeps its own scroll", () => {
  it("somewhere new opens at the top; Back and Forward return where you were", async () => {
    const { ScrollMemory } = await import("@/lib/scroll-memory");
    const { placeKey } = await import("@/components/arch/store");
    const s = () => useArch.getState();
    const key = () => placeKey(s());
    const m = new ScrollMemory();
    s().setView("home");
    m.remember(key(), 900); // scrolled down on Home
    const home = key();
    s().setView("services");
    expect(s().lastMove).toBe("go");
    expect(m.target(key(), s().lastMove)).toBe(0); // the bug: Services opened at Home's 900
    m.remember(key(), 300);
    s().goBack();
    expect(key()).toBe(home);
    expect(m.target(key(), s().lastMove)).toBe(900);
    s().goForward();
    expect(m.target(key(), s().lastMove)).toBe(300);
    s().setView("home");
    expect(m.target(key(), s().lastMove)).toBe(0); // clicking Home again is somewhere new
    expect(placeKey({ view: "apps", commandsTab: "mine", securityTab: "glance", commandPage: null, appPage: { app: "krita", source: "pacman" } })).not.toBe(
      placeKey({ view: "apps", commandsTab: "mine", securityTab: "glance", commandPage: null, appPage: null }),
    );
  });
});

describe("Security's sub-sections", () => {
  it("a sub-section is a place: Back returns to the one you were on, each keeps its own scroll", async () => {
    const { placeKey } = await import("@/components/arch/store");
    const s = () => useArch.getState();
    s().setView("home");
    s().openSecurity("system", "sec-kernel"); // from Security at a glance: the kernel's row
    expect([s().view, s().securityTab, s().securityAnchor?.id]).toEqual(["security", "system", "sec-kernel"]);
    const system = placeKey(s());
    s().setSecurityTab("network");
    expect(placeKey(s())).not.toBe(system);
    s().goBack();
    expect([s().view, s().securityTab]).toEqual(["security", "system"]);
    s().goBack();
    expect(s().view).toBe("home");
    s().openSecurity("glance");
    expect(s().securityAnchor).toBeNull(); // nothing to scroll to
  });

  it("the sidebar has Security, not a Firewall of its own; Settings is TuxCopilot's own", async () => {
    const { readFileSync } = await import("node:fs");
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toMatch(/\{ id: "security", label: "Security"/);
    expect(app).not.toMatch(/id: "firewall"/);
    const settings = readFileSync("src/components/arch/settings-view.tsx", "utf8");
    for (const p of ["InputControlPanel", "StorageControlPanel", "UsbGuardPanel", "GroupsPanel", "ScreenLockPanel", "LoginsPanel", "SystemFilesPanel", "KernelPanel"])
      expect(settings + readFileSync("src/components/arch/security-panel.tsx", "utf8"), p).not.toContain(p);
    const security = readFileSync("src/components/arch/security-view.tsx", "utf8");
    for (const p of ["FirewallView", "InputControlPanel", "StorageControlPanel", "UsbGuardPanel", "GroupsPanel", "ScreenLockPanel", "LoginsPanel", "SecurityCheck", "SystemFilesPanel", "KernelPanel"])
      expect(security, p).toContain(`<${p} />`);
    // the sidebar scrolls when the window is short ("when it is not full screen i cant access settings")
    expect(readFileSync("src/components/arch/section-nav.tsx", "utf8")).toMatch(/<nav ref=\{navRef\} className="[^"]*\bmin-h-0\b[^"]*\boverflow-y-auto\b/);
    expect(app).toMatch(/<aside className="[^"]*\bmin-h-0\b/);
  });
});
