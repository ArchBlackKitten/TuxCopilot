// Apps' lists fill themselves from the system. Apps' Pacman / Yay / GitHub / Flatpak / Ollama lists show what is installed here — the same
// lists moving house takes (penguin.rs apps_here → belongings::here) — without repeating what
// the list already saves.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { hereFor, type AppsHere } from "@/lib/penguin";

const here: AppsHere = {
  pacman: ["firefox", "vlc", "krita"],
  aur: ["brave-bin"],
  flatpak: ["org.gimp.GIMP"],
  git: [{ path: "git/yay-bin", remote: "https://aur.archlinux.org/yay-bin.git", branch: "master" }, { path: "src/bat", remote: "https://github.com/sharkdp/bat.git", branch: null }],
  ollama: ["llama3.2:3b"],
};

describe("Apps' lists, filled from the system", () => {
  it("each list gets its source's share", () => {
    expect(hereFor("pacman", here, []).map((a) => a.name)).toEqual(["firefox", "vlc", "krita"]);
    expect(hereFor("yay", here, []).map((a) => a.name)).toEqual(["brave-bin"]);
    expect(hereFor("flatpak", here, []).map((a) => a.name)).toEqual(["org.gimp.GIMP"]);
    expect(hereFor("ollama", here, []).map((a) => a.name)).toEqual(["llama3.2:3b"]);
    expect(hereFor("github", here, [])).toEqual([
      { name: "https://aur.archlinux.org/yay-bin", detail: "~/git/yay-bin" },
      { name: "sharkdp/bat", detail: "~/src/bat" },
    ]);
    expect(hereFor("snap", here, [])).toEqual([]);
    expect(hereFor("pacman", null, [])).toEqual([]);
  });

  it("what the list already saves isn't shown twice (names in a saved item, a GitHub repo however written)", () => {
    expect(hereFor("pacman", here, ["vlc krita", "  "]).map((a) => a.name)).toEqual(["firefox"]);
    expect(hereFor("github", here, ["sharkdp/bat"]).map((a) => a.name)).toEqual(["https://aur.archlinux.org/yay-bin"]);
    expect(hereFor("github", here, ["https://github.com/SharkDP/bat.git"]).map((a) => a.name)).toEqual(["https://aur.archlinux.org/yay-bin"]);
  });

  it("it is the same list moving house takes, and the screen asks for it", () => {
    const rs = readFileSync("src-tauri/src/penguin.rs", "utf8");
    expect(rs).toMatch(/pub async fn apps_here[\s\S]*crate::belongings::here\(&h, &added\)/);
    expect(readFileSync("src/components/arch/apps-view.tsx", "utf8")).toMatch(/appsHere\(\)\.then\(setHere/);
  });
});
