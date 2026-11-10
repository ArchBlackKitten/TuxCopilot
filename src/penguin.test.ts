// Your apps back from a penguin: the commands are built only from names that cannot be
// anything else — a penguin may come from anyone.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { appsLine, aurCommand, contentsLine, dockerCommand, firewallCommand, flatpakCommand, gitCommand, ollamaCommand, pacmanCommand, torrcBackCommand } from "@/lib/penguin";

describe("getting your apps back", () => {
  it("one command per source, -Syu and --needed always", () => {
    expect(pacmanCommand(["krita", "qt6-base", "lib32-mesa", "gtk2+extra"])).toBe("sudo pacman -Syu --needed krita qt6-base lib32-mesa gtk2+extra");
    expect(aurCommand(["brave-bin"])).toBe("yay -Syu --needed brave-bin");
    expect(flatpakCommand(["com.spotify.Client"])).toMatch(/flatpak install -y flathub com\.spotify\.Client$/);
  });

  it("clones go back where they were in your home, on their branch", () => {
    const c = gitCommand([
      { path: "git/yay", remote: "https://aur.archlinux.org/yay.git", branch: "master" },
      { path: "src/My Notes", remote: "git@github.com:me/notes.git", branch: null },
    ]);
    expect(c).toBe(
      `mkdir -p "$(dirname "$HOME"/'git/yay')" && git clone -b 'master' 'https://aur.archlinux.org/yay.git' "$HOME"/'git/yay' || echo "Could not clone git/yay"; ` +
        `mkdir -p "$(dirname "$HOME"/'src/My Notes')" && git clone 'git@github.com:me/notes.git' "$HOME"/'src/My Notes' || echo "Could not clone src/My Notes"`,
    );
  });

  it("anything that is not a plain name is refused, never quoted around", () => {
    for (const bad of ["--overwrite=*", "a;id", "x$(id)", "a b", "Firefox", "", "-x", ".x"]) expect(() => pacmanCommand([bad]), bad).toThrow();
    expect(() => aurCommand(["ok", "x`id`"])).toThrow();
    expect(() => flatpakCommand(["org.x;id"])).toThrow();
    expect(() => pacmanCommand([])).toThrow(/no package/);
    const ok = { path: "git/a", remote: "https://x.org/a", branch: null };
    for (const c of [
      { ...ok, path: "../etc" },
      { ...ok, path: "/etc" },
      { ...ok, path: "git/-x" },
      { ...ok, path: "git/a'b" },
      { ...ok, path: "git/$(id)" },
      { ...ok, remote: "file:///etc" },
      { ...ok, remote: "https://x.org/a';id;'" },
      { ...ok, remote: "ext::sh -c id" },
      { ...ok, branch: "--upload-pack=id" },
      { ...ok, branch: "a..b" },
    ]) expect(() => gitCommand([c]), JSON.stringify(c)).toThrow();
  });

  it("what Fluff's belongings hold, in words", () => {
    expect(contentsLine({ made: "", from: "", appVersion: "", items: 1, runs: 2, usageDays: 1, settings: 3 } as never)).toBe("1 item, 2 runs, 1 day of app use, 3 settings");
    expect(appsLine({ pacman: 120, aur: 15, flatpak: 1, git: 6 })).toBe("120 from pacman, 15 from the AUR, 1 Flatpak app and 6 git clones");
    expect(appsLine({ pacman: 0, aur: 0, flatpak: 0, git: 2 })).toBe("2 git clones");
    expect(appsLine({ pacman: 0, aur: 0, flatpak: 0, git: 0 })).toBe("no apps");
  });
});

describe("the rest of the move: models, images, Tor, the firewall", () => {
  const bashOk = (cmd: string) => execFileSync("bash", ["-n", "-c", cmd]); // syntax only: nothing runs

  it("Ollama and Docker: installed and started if missing, then each one downloaded again", () => {
    const o = ollamaCommand(["llama3.2:3b", "hf.co/bartowski/Qwen-GGUF:Q4_K_M"]);
    expect(o).toContain("sudo pacman -Syu --needed ollama");
    expect(o).toContain('for m in llama3.2:3b hf.co/bartowski/Qwen-GGUF:Q4_K_M; do ollama pull "$m"');
    const d = dockerCommand(["hello-world:latest", "ghcr.io/me/app@sha256:abc"]);
    expect(d).toContain('for i in hello-world:latest ghcr.io/me/app@sha256:abc; do sudo docker pull "$i"');
    for (const c of [o, d]) bashOk(c);
    for (const bad of ["a;id", "$(id)", "-x", "a b", "../x", "x/../y"]) {
      expect(() => ollamaCommand([bad]), bad).toThrow();
      expect(() => dockerCommand([bad]), bad).toThrow();
    }
  });

  it("the torrc goes back the Tor section's way, checked by Tor first", () => {
    const c = torrcBackCommand("SocksPort 9050\n# it's mine\n");
    expect(c).toMatch(/^\{ command -v tor >\/dev\/null \|\| sudo pacman -Syu --needed tor; \} && t=\$\(mktemp\)/);
    expect(c).toContain("sudo tor --verify-config");
    bashOk(c);
  });

  it("the firewall: kept first, checked by firewalld, put back as it was if refused", () => {
    const c = firewallCommand([
      { path: "zones/home.xml", text: "<zone><service name='ssh'/></zone>" },
      { path: "firewalld.conf", text: "DefaultZone=home\n" },
    ]);
    expect(c).toContain("sudo cp -a /etc/firewalld \"$b\"");
    expect(c).toContain("firewall-offline-cmd --check-config");
    expect(c).toContain('sudo mv "$b" /etc/firewalld');
    expect(c).not.toContain("<zone>"); // the files travel as base64: any character is safe
    bashOk(c);
    for (const path of ["../shadow", "/etc/shadow", "zones/x.sh", "zones/../../x.xml", "zones/$(id).xml"])
      expect(() => firewallCommand([{ path, text: "x" }]), path).toThrow();
    expect(() => firewallCommand([])).toThrow();
  });
});

describe("the firewall command, run for real against a stand-in sudo", () => {
  // nothing touches /etc: the stand-in sudo records each call and copies what would be
  // installed into a folder of the test's own
  const { mkdtempSync, writeFileSync, chmodSync, readFileSync, mkdirSync, rmSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const { tmpdir } = require("node:os") as typeof import("node:os");

  function runFw(fail: boolean) {
    const dir = mkdtempSync(join(tmpdir(), "tux-fw-"));
    const bin = join(dir, "bin");
    const capture = join(dir, "capture");
    mkdirSync(bin);
    mkdirSync(capture);
    const fake = (name: string, body: string) => {
      writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    };
    fake("sudo", `echo "$@" >> "${dir}/log"; if [ "$1" = cp ] && [ "$2" = -r ]; then cp -r "$3" "${capture}/"; fi; if [ "$1" = firewall-offline-cmd ]; then ${fail ? 'echo "Error: INVALID_ZONE"; exit 1' : "exit 0"}; fi; exit 0`);
    fake("systemctl", "exit 0");
    fake("firewall-cmd", "exit 0");
    const files = [
      { path: "zones/home.xml", text: "<zone><description>It's mine — ü</description></zone>\n" },
      { path: "firewalld.conf", text: "DefaultZone=home\n" },
    ];
    let out = "";
    let ok = true;
    try {
      out = execFileSync("bash", ["-c", firewallCommand(files)], { env: { PATH: `${bin}:/usr/bin` }, encoding: "utf8" });
    } catch (e) {
      ok = false;
      out = String((e as { stdout?: string }).stdout ?? "");
    }
    const arrived = Object.fromEntries(files.map((f) => [f.path, ok ? readFileSync(join(capture, f.path), "utf8") : ""]));
    const log = readFileSync(join(dir, "log"), "utf8");
    rmSync(dir, { recursive: true });
    return { ok, out, log, files, read: (p: string) => arrived[p] };
  }

  it("the files arrive exactly, the old ones are kept, and firewalld is reloaded", () => {
    const r = runFw(false);
    expect(r.ok).toBe(true);
    for (const f of r.files) expect(r.read(f.path)).toBe(f.text);
    expect(r.log).toMatch(/^cp -a \/etc\/firewalld \/etc\/firewalld\.before-fluff-\d{8}-\d{6}$/m);
    expect(r.log).toContain("firewall-cmd --reload");
    expect(r.out).toContain("Your firewall settings are back");
  });

  it("refused by firewalld: the kept settings go back, and it says why", () => {
    const r = runFw(true);
    expect(r.ok).toBe(false);
    expect(r.log).toMatch(/^rm -rf \/etc\/firewalld$/m);
    expect(r.log).toMatch(/^mv \/etc\/firewalld\.before-fluff-\d{8}-\d{6} \/etc\/firewalld$/m);
    expect(r.log).not.toContain("--reload");
    expect(r.out).toContain("INVALID_ZONE");
  });
});
