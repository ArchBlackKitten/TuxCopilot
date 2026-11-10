// Fluff's brain: what the model is told, the commands read out of an answer, and the setting
// waiting for Apply like every other.
import { describe, expect, it } from "vitest";
import { answerCommands, fluffPrompt, machineLine, NO_BRAIN } from "@/lib/brain";
import { EMPTY_HISTORY } from "@/lib/changes";
import { useArch } from "@/components/arch/store";

describe("Fluff's brain", () => {
  it("tells the model who Fluff is and the rules TuxCopilot keeps", () => {
    // the OS and the desktop both matter: a machine, not a line
    const p = fluffPrompt({ os: "CachyOS", desktop: "KDE", sessionType: "wayland", installedDesktops: ["Plasma (Wayland)", "Hyprland", "COSMIC"] });
    expect(p).toMatch(/^You are Fluff, the penguin chick inside TuxCopilot/);
    expect(p).toContain("The computer you are helping with — OS: CachyOS; desktop in use: KDE (wayland); also installed: Hyprland, COSMIC.");
    expect(p).toContain("Hyprland is not KDE Plasma is not GNOME");
    expect(machineLine({ os: "Arch Linux", desktop: "Hyprland", sessionType: "wayland", installedDesktops: ["Hyprland", "Hyprland (uwsm-managed)", "Plasma (Wayland)"] })).toBe(
      "OS: Arch Linux; desktop in use: Hyprland (wayland); also installed: Plasma (Wayland)",
    );
    expect(p).toContain("`sudo pacman -Syu --needed <package>`");
    expect(p).toContain("Never put sudo before yay");
    expect(p).toContain("You don't run anything");
    expect(p).not.toMatch(/pacman -S /);
    expect(fluffPrompt(null)).not.toContain("helping with");
  });

  it("reads the commands out of an answer's code blocks", () => {
    const a = "Peep! First update:\n```bash\n# refresh and upgrade\n$ sudo pacman -Syu\n```\nthen install:\n```\nsudo pacman -Sy --needed steam\n```";
    expect(answerCommands(a)).toEqual(["sudo pacman -Syu", "sudo pacman -Sy --needed steam"]);
    expect(answerCommands("no code here")).toEqual([]);
  });

  it("is off until a model is chosen, and the choice waits for Apply", () => {
    const s = () => useArch.getState();
    useArch.setState({ history: EMPTY_HISTORY, savedBrain: NO_BRAIN, brain: NO_BRAIN });
    expect(s().brain).toEqual({ on: false, model: null });
    s().setBrain({ on: true, model: "llama3.2:3b" }, "Ask Fluff uses llama3.2:3b");
    expect(s().brain.model).toBe("llama3.2:3b");
    expect(s().savedBrain.model).toBeNull();
    s().setBrain({ on: true, model: "llama3.2:3b" }, "Ask Fluff uses llama3.2:3b");
    expect(s().history.pending).toHaveLength(1);
    s().setBrain(NO_BRAIN, "Ask Fluff: off");
    expect(s().history.pending).toEqual([]);
  });
});
