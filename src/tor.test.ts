// Tor section: settings rendered from the Tor Project's own bridge file (a copy of it), read back, saved for real against a fake /etc/tor — including Tor
// refusing them — and Troubleshoot reading Tor's log.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PRESETS, SHADOW_RULES, bridgesAge, shadowOnCommand,
  cleanBridge, diagnoseTorFrom, lastBootstrap, parseConf, parsePtConfig, parseTorVersion, pluginLine, renderConf, saveCommand,
  DEFAULTS, INCLUDE, type Builtins, type TorState,
} from "@/lib/tor";

const pt = parsePtConfig(readFileSync(join(__dirname, "test-fixtures/pt_config.json"), "utf8"))!;
const live: Builtins = { ...pt, fetchedAt: "2026-10-26T00:00:00Z" };

describe("settings", () => {
  it("snowflake runs through lyrebird at Arch's path, as the Tor Project's file says today", () => {
    expect(pluginLine("snowflake", pt.plugins)).toBe("ClientTransportPlugin snowflake exec /usr/bin/lyrebird");
    expect(pluginLine("obfs4", pt.plugins)).toBe("ClientTransportPlugin meek_lite,obfs2,obfs3,obfs4,scramblesuit,webtunnel exec /usr/bin/lyrebird");
  });

  it("renders bridges with their plugin, and reads its own file back", () => {
    const s = { ...DEFAULTS, socksPort: 9060, bridges: "snowflake" as const, control: true };
    const { text, problems } = renderConf(s, live);
    expect(problems).toEqual([]);
    expect(text).toMatch(/^SocksPort 9060$/m);
    expect(text).toMatch(/^UseBridges 1$/m);
    expect(text.match(/^Bridge snowflake /gm)?.length).toBe(pt.bridges.snowflake.length);
    expect(text).toMatch(/^ClientTransportPlugin snowflake exec \/usr\/bin\/lyrebird$/m);
    expect(text).toMatch(/^CookieAuthFileGroupReadable 1$/m);
    expect(parseConf(text)).toEqual({ socksPort: 9060, bridges: "snowflake", ownBridges: [], control: true, preset: "standard", bridgesSince: null });
  });

  it("without the Tor Project's file, built-in bridges are not invented", () => {
    const { text, problems } = renderConf({ ...DEFAULTS, bridges: "obfs4" }, { bridges: {}, plugins: {}, fetchedAt: null });
    expect(problems[0]).toMatch(/could not be fetched.*bridges\.torproject\.org/);
    expect(text).not.toMatch(/UseBridges/);
  });

  it("own bridge lines: \"Bridge \" is dropped, anything that could break out is refused", () => {
    expect(cleanBridge("Bridge obfs4 192.0.2.1:443 ABCD cert=x iat-mode=0")).toBe("obfs4 192.0.2.1:443 ABCD cert=x iat-mode=0");
    expect(cleanBridge("192.0.2.1:9001 ABCD")).toBe("192.0.2.1:9001 ABCD");
    for (const bad of ["obfs4 1.2.3.4:1 x'; rm -rf ~", "obfs4 $(id)", "hello world", "# comment", ""]) expect(cleanBridge(bad)).toBeNull();
    const { text } = renderConf({ ...DEFAULTS, bridges: "own", ownBridges: ["obfs4 192.0.2.1:443 ABCD cert=x iat-mode=0", "junk"] }, live);
    expect(text.match(/^Bridge /gm)?.length).toBe(1);
  });
});

describe("saving, against a fake /etc/tor", () => {
  // sudo runs the command; tor accepts unless the config says SocksPort 6666; systemctl notes it
  const setup = () => {
    const root = mkdtempSync(join(tmpdir(), "am-tor-"));
    const bin = join(root, "bin");
    mkdirSync(bin);
    mkdirSync(join(root, "etc/tor"), { recursive: true });
    writeFileSync(join(root, "etc/tor/torrc"), "User tor\nDataDirectory /var/lib/tor\n");
    const script = (name: string, body: string) => {
      writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    };
    script("sudo", 'exec "$@"');
    script("tor", `! grep -qs 'SocksPort 6666' ${root}/etc/tor/torrc.d/*.conf`);
    script("systemctl", `echo "$@" >> ${root}/systemctl.log`);
    const run = (text: string) => {
      const cmd = saveCommand(text).replaceAll("/etc/tor", `${root}/etc/tor`);
      try {
        return { ok: true, out: execFileSync("bash", ["-c", cmd], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }) };
      } catch (e) {
        return { ok: false, out: String((e as { stdout?: string }).stdout ?? "") };
      }
    };
    return { root, run, conf: () => readFileSync(join(root, "etc/tor/torrc.d/tuxcopilot.conf"), "utf8") };
  };

  it("writes the file, includes it once, and restarts Tor", () => {
    const t = setup();
    const a = renderConf({ ...DEFAULTS, socksPort: 9055 }, live).text;
    expect(t.run(a).ok).toBe(true);
    expect(t.run(a).ok).toBe(true);
    expect(t.conf()).toBe(a);
    const torrc = readFileSync(join(t.root, "etc/tor/torrc"), "utf8");
    // the test moved /etc/tor into a temp folder, so the include line points there too
    expect(torrc.split("\n").filter((l) => l === INCLUDE.replace("/etc/tor", `${t.root}/etc/tor`)).length).toBe(1);
    expect(torrc.startsWith("User tor\n")).toBe(true); // your torrc is only appended to
    expect(readFileSync(join(t.root, "systemctl.log"), "utf8")).toMatch(/reload-or-restart tor\.service/);
  });

  it("when Tor refuses the new settings, the previous ones are put back", () => {
    const t = setup();
    const good = renderConf({ ...DEFAULTS, socksPort: 9055 }, live).text;
    t.run(good);
    const r = t.run(renderConf({ ...DEFAULTS, socksPort: 6666 }, live).text);
    expect(r.ok).toBe(false);
    expect(r.out).toMatch(/refused these settings — the previous ones are back/);
    expect(t.conf()).toBe(good);
  });

  it("refused on the very first save: no file is left behind", () => {
    const t = setup();
    expect(t.run(renderConf({ ...DEFAULTS, socksPort: 6666 }, live).text).ok).toBe(false);
    expect(existsSync(join(t.root, "etc/tor/torrc.d/tuxcopilot.conf"))).toBe(false);
  });
});

describe("reading Tor", () => {
  const journal = [
    "2026-10-26T10:00:00+00:00 host systemd[1]: Started Anonymizing overlay network for TCP.",
    "2026-10-26T10:00:01+00:00 host Tor[9]: Bootstrapped 100% (done): Done",
    "2026-10-26T11:00:00+00:00 host systemd[1]: Started Anonymizing overlay network for TCP.",
    "2026-10-26T11:00:02+00:00 host Tor[10]: Bootstrapped 10% (conn_done): Connected to a relay",
    "2026-10-26T11:00:30+00:00 host Tor[10]: [warn] Problem bootstrapping. Stuck at 10% (conn_done): Connected to a relay. (Connection refused; CONNECTREFUSED)",
  ].join("\n");

  it("the progress since Tor last started, not an older run's 100%", () => {
    expect(lastBootstrap(journal)).toEqual({ percent: 10, summary: "Connected to a relay" });
    expect(parseTorVersion("Tor version 0.4.9.14.\nThis build of Tor is covered by the GNU GPL")).toBe("0.4.9.14");
  });

  it("stuck while connecting → points at bridges; bridges on without lyrebird → installs it", () => {
    const base: TorState = {
      version: "0.4.9.14", active: true, enabled: "enabled", bootstrap: lastBootstrap(journal), settings: { ...DEFAULTS },
      confText: null, included: false, inTorGroup: false, journal, shadowOn: false,
      tools: [{ pkg: "lyrebird-proxy", name: "lyrebird", what: "", how: "", aur: true, installed: false }],
    };
    const d = diagnoseTorFrom(base);
    const connected = d.checks.find((c) => c.id === "connected")!;
    expect(connected.ok).toBe(false);
    expect(connected.detail).toMatch(/stuck at 10%.*turn on Bridges/);
    expect(d.errors.some((l) => l.includes("Problem bootstrapping"))).toBe(true);

    const withBridges = diagnoseTorFrom({ ...base, settings: { ...DEFAULTS, bridges: "snowflake" } });
    expect(withBridges.checks.find((c) => c.id === "transport")?.fix?.command).toBe("yay -Syu --needed --noconfirm lyrebird-proxy");
  });
});

describe("presets", () => {
  const torOk = (() => {
    try {
      execFileSync("tor", ["--version"]);
      return true;
    } catch {
      return false;
    }
  })();

  it("each preset's file is one the real Tor accepts (checked by tor --verify-config, nothing written)", () => {
    if (!torOk) return console.warn("tor is not installed: the presets were not checked by Tor itself");
    let checked = 0;
    for (const p of PRESETS) {
      const dir = mkdtempSync(join(tmpdir(), "tux-preset-"));
      const { text } = renderConf({ ...DEFAULTS, preset: p.id, bridges: p.id === "ghost" ? "snowflake" : "off", bridgesSince: "2026-10-01" }, live);
      writeFileSync(join(dir, "torrc"), `DataDirectory ${dir}/data\n${text}`);
      let out = "";
      try {
        out = execFileSync("tor", ["--verify-config", "-f", join(dir, "torrc")], { encoding: "utf8" });
      } catch (e) {
        out = String((e as { stdout?: string }).stdout);
        throw new Error(`Tor refused ${p.label}: ${out.split("\n").filter((l) => /\[(warn|err)\]/.test(l)).join(" / ")}`);
      } finally {
        execFileSync("rm", ["-rf", dir]);
      }
      expect(out, p.label).toMatch(/Configuration was valid/);
      checked++;
    }
    expect(checked).toBe(PRESETS.length);
  });

  it("what each preset sets, and it reads back", () => {
    const text = (preset: (typeof PRESETS)[number]["id"]) => renderConf({ ...DEFAULTS, preset }, live).text;
    expect(text("standard")).toMatch(/^SocksPort 9050$/m);
    expect(text("secure")).toMatch(/^SocksPort 9050 IsolateDestAddr IsolateDestPort$/m);
    expect(text("ghost")).toMatch(/^SafeSocks 1$/m);
    expect(text("ghost")).toMatch(/^ConnectionPadding 1$/m);
    expect(text("shadow")).toMatch(/^TransPort 127\.0\.0\.1:9040 /m);
    expect(text("shadow")).toMatch(/^DNSPort 127\.0\.0\.1:5353$/m);
    expect(text("standard")).not.toMatch(/SafeSocks|TransPort/);
    for (const p of PRESETS) expect(parseConf(text(p.id)).preset).toBe(p.id);
  });

  it("bridges keep their date, and Fluff counts the days", () => {
    const { text } = renderConf({ ...DEFAULTS, bridges: "snowflake", bridgesSince: "2026-09-20" }, live);
    expect(parseConf(text).bridgesSince).toBe("2026-09-20");
    expect(bridgesAge("2026-09-20", new Date("2026-10-27T12:00:00Z"))).toBe(37);
    expect(bridgesAge(null)).toBeNull();
    expect(bridgesAge("not a date")).toBeNull();
  });

  it("Shadow's rules travel whole, as base64, and say how to undo them", () => {
    const c = shadowOnCommand();
    const b64 = c.match(/printf '%s' '([A-Za-z0-9+/=]+)' \| base64 -d \| sudo tee \/etc\/tuxcopilot\/shadow\.nft/)![1];
    expect(Buffer.from(b64, "base64").toString("utf8")).toBe(SHADOW_RULES);
    expect(SHADOW_RULES).toMatch(/meta skuid "tor" accept/);
    expect(SHADOW_RULES).toMatch(/policy drop;/);
    expect(c).not.toMatch(/systemctl enable/); // started, never enabled: a restart turns it off
    execFileSync("bash", ["-n", "-c", c]);
  });
});
