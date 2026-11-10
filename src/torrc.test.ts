// Your torrc in the Tor section: Arch's own torrc (as Arch ships it) read
// into rows, every edit changing exactly one line, the installed Tor's manual and option list
// read, and saving for real against a fake /etc/tor — including Tor refusing the file.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addOption, allRows, changedLines, parseLine, parseOptionList, parseTorMan, parseTorrc, removeLine, restoreCommand, rowProblem,
  saveTorrcCommand, setOn, setValue,
} from "@/lib/torrc";

const TORRC = readFileSync(join(__dirname, "test-fixtures/torrc-arch-default"), "utf8");
const MAN = readFileSync(join(__dirname, "test-fixtures/tor-man-excerpt.txt"), "utf8");
const at = (text: string, n: number) => text.split("\n")[n - 1]; // by line number, as an editor shows it

describe("reading the torrc", () => {
  const rc = parseTorrc(TORRC);
  const rows = allRows(rc);
  const row = (n: number) => rows.find((r) => r.index === n - 1)!;

  it("every option line becomes a row — the ones in use and the ones shipped switched off", () => {
    expect(rows.filter((r) => r.on).map((r) => `${r.name} ${r.value}`)).toEqual(["User tor", "Log notice syslog", "DataDirectory /var/lib/tor"]);
    expect(rows.length).toBe(52); // grep -cE '^(#[A-Z%]|[A-Za-z%])' torrc says 52 too
    expect(row(19)).toMatchObject({ on: false, name: "SOCKSPort", value: "9050", note: "Default: Bind to localhost:9050 for local connections." });
    expect(row(223)).toMatchObject({ name: "ExitPolicy", value: "accept *:6660-6667,reject *:*", note: "allow irc ports on IPv4 and IPv6 but no more" });
    expect(row(257)).toMatchObject({ on: false, name: "%include", value: "/etc/torrc.d/*.conf" });
    // explanations and headings are not options
    for (const n of [1, 5, 16, 64, 80, 81]) expect(rows.some((r) => r.index === n - 1)).toBe(false);
  });

  it("the file's sections, said plainly, and its opening block as the file's own header", () => {
    expect(rc.sections.map((s) => s.title)).toEqual(["Using Tor", "Onion services (hidden services)", "Running a relay or bridge"]);
    expect(rc.about[0]).toBe("Configuration file for a typical Tor user");
    expect(rc.sections[0].groups[0].intro).toEqual([]); // User tor does not inherit the header
  });

  it("the explanation above a group stays with it; a line's own explanation stays with the line", () => {
    const log = rc.sections[0].groups.find((g) => g.rows.some((r) => r.name === "Log"))!;
    expect(log.intro[0]).toMatch(/^Logs go to stdout at level "notice"/);
    expect(log.intro).toContain(""); // its two paragraphs
    expect(row(39).help).toEqual(["Send all messages of level 'notice' or higher to /var/log/tor/notices.log"]);
    expect(row(41).help).toEqual(["Send every possible message to /var/log/tor/debug.log"]);
    expect(row(43).help).toEqual(["Use the system log instead of Tor's logfiles"]);
    // an explanation-only paragraph carries on to the options after the blank line
    const onion = rc.sections[1].groups[0];
    expect(onion.intro[0]).toMatch(/^Once you have configured a hidden service/);
    expect(onion.rows.map((r) => r.name)).toEqual(["HiddenServiceDir", "HiddenServicePort"]);
  });

  it("Tor ignores case, so a line in use counts whatever its case; a # inside quotes is no comment", () => {
    expect(parseLine("socksport 9060")).toMatchObject({ on: true, name: "socksport", value: "9060" });
    expect(parseLine('ContactInfo "me #1" # who')).toMatchObject({ value: '"me #1"', note: "who" });
    expect(parseLine("# a sentence")).toBeNull();
    expect(parseLine("#lowercase words are prose")).toBeNull();
  });
});

describe("editing changes that one line and nothing else", () => {
  const only = (before: string, after: string, n: number) => {
    const a = before.split("\n");
    const b = after.split("\n");
    expect(b.length).toBe(a.length);
    b.forEach((l, i) => i !== n - 1 && expect(l).toBe(a[i]));
  };

  it("switching on and off; values keep the line's #, spacing and note", () => {
    const on = setOn(TORRC, 18, true);
    expect(at(on, 19)).toBe("SOCKSPort 9050 # Default: Bind to localhost:9050 for local connections.");
    only(TORRC, on, 19);
    expect(setOn(on, 18, false)).toBe(TORRC);
    const v = setValue(TORRC, 121, "300 KBytes");
    expect(at(v, 122)).toBe("#RelayBandwidthRate 300 KBytes  # Throttle traffic to 100KB/s (800Kbps)");
    only(TORRC, v, 122);
    expect(at(setValue(TORRC, 53, "/srv/tor"), 54)).toBe("DataDirectory /srv/tor");
    expect(() => setOn(TORRC, 0, true)).toThrow(/not an option/);
    expect(setValue(TORRC, 53, "a\nUser root")).not.toMatch(/^User root$/m); // a value is one line
  });

  it("an option you add goes beside its kind, or at the end before TuxCopilot's include line", () => {
    const a = addOption(TORRC, "SOCKSPort", "9150");
    expect(a.index).toBe(20);
    expect(at(a.text, 21)).toBe("SOCKSPort 9150");
    const withInclude = TORRC + "%include /etc/tor/torrc.d/*.conf\n";
    const b = addOption(withInclude, "ExitNodes", "{de},{nl}");
    expect(b.text.split("\n").slice(-3)).toEqual(["ExitNodes {de},{nl}", "%include /etc/tor/torrc.d/*.conf", ""]);
    expect(() => addOption(TORRC, "Bad Name", "x")).toThrow(/not an option name/);
    expect(removeLine(a.text, a.index)).toBe(TORRC);
  });

  it("what will change is shown line by line", () => {
    let t = setOn(TORRC, 18, true);
    t = addOption(t, "ExitNodes", "{de}").text;
    t = removeLine(t, 13); // User tor
    expect(changedLines(TORRC, t)).toEqual([
      { line: 14, was: "User tor", now: null },
      { line: 18, was: "#SOCKSPort 9050 # Default: Bind to localhost:9050 for local connections.", now: "SOCKSPort 9050 # Default: Bind to localhost:9050 for local connections." },
      { line: 257, was: null, now: "ExitNodes {de}" },
    ]);
    expect(changedLines(TORRC, TORRC)).toEqual([]);
  });
});

describe("what the installed Tor knows", () => {
  it("its manual explains any option, with how it is written", () => {
    const man = parseTorMan(MAN);
    expect(man.get("socksport")).toMatchObject({ section: "CLIENT OPTIONS", usage: "SocksPort [address:]port|unix:path|auto [flags] [isolation flags]" });
    expect(man.get("socksport")!.text[0]).toMatch(/^Open this port to listen for connections from SOCKS-speaking applications/);
    expect(man.get("exitnodes")!.text).toContain("This option can appear multiple times: the values from multiple lines are spliced together.");
    expect(man.get("usebridges")!.text).toHaveLength(1);
    expect(man.has("isolateclientaddr")).toBe(false); // a flag inside SocksPort's text, not an option
  });

  it("a name Tor doesn't know is caught before saving", () => {
    const known = parseOptionList("__ControlPort\nSocksPort\nExitNodes\n");
    expect(known.has("__controlport")).toBe(false);
    expect(rowProblem({ on: true, name: "SOCKSPort", value: "9050" }, known)).toBeNull();
    expect(rowProblem({ on: true, name: "SockPort", value: "9050" }, known)).toMatch(/doesn't know an option called SockPort/);
    expect(rowProblem({ on: false, name: "SockPort", value: "9050" }, known)).toBeNull(); // switched off: Tor never reads it
    expect(rowProblem({ on: true, name: "SockPort", value: "" }, null)).toBeNull(); // list not available: Tor's own check decides
  });
});

describe("saving, against a fake /etc/tor", () => {
  // sudo runs the command; tor refuses a file that sets SocksPort 6666; systemctl: Tor is running
  const setup = () => {
    const root = mkdtempSync(join(tmpdir(), "am-torrc-"));
    const bin = join(root, "bin");
    mkdirSync(bin);
    mkdirSync(join(root, "etc/tor"), { recursive: true });
    writeFileSync(join(root, "etc/tor/torrc"), TORRC);
    const script = (name: string, body: string) => {
      writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    };
    script("sudo", '[ "$1" = install ] && { shift; args=(); while [ $# -gt 0 ]; do case "$1" in -o|-g) shift 2;; *) args+=("$1"); shift;; esac; done; exec install "${args[@]}"; }; exec "$@"');
    script("tor", 'f="$3"; if grep -q "^SocksPort 6666" "$f"; then echo "Oct 26 [warn] Could not bind to 127.0.0.1:6666: Address already in use."; echo "Oct 26 [err] Reading config failed--see warnings above."; exit 1; fi; echo "Configuration was valid"');
    script("systemctl", `[ "$1" = is-active ] && exit 0; echo "$@" >> ${root}/systemctl.log`);
    const run = (cmd: string) => {
      const c = cmd.replaceAll("/etc/tor", `${root}/etc/tor`);
      try {
        return { ok: true, out: execFileSync("bash", ["-c", c], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }) };
      } catch (e) {
        return { ok: false, out: String((e as { stdout?: string }).stdout ?? "") };
      }
    };
    const torrc = () => readFileSync(join(root, "etc/tor/torrc"), "utf8");
    const backups = () => readdirSync(join(root, "etc/tor")).filter((f) => f.startsWith("torrc.bak-")).sort();
    return { root, run, torrc, backups };
  };

  it("Tor checks it, the old file is kept as a backup, the new one goes in, Tor reloads", () => {
    const t = setup();
    const next = setOn(TORRC, 18, true); // its explanations hold apostrophes: base64 carries them
    const r = t.run(saveTorrcCommand(next));
    expect(r.out).toMatch(/Tor took the new torrc/);
    expect(t.torrc()).toBe(next);
    expect(t.backups()).toHaveLength(1);
    expect(readFileSync(join(t.root, "etc/tor", t.backups()[0]), "utf8")).toBe(TORRC);
    expect(readFileSync(join(t.root, "systemctl.log"), "utf8")).toMatch(/reload-or-restart tor\.service/);
  });

  it("when Tor refuses it, nothing changes, and you are told why", () => {
    const t = setup();
    const r = t.run(saveTorrcCommand(addOption(TORRC, "SocksPort", "6666").text));
    expect(r.ok).toBe(false);
    expect(r.out).toMatch(/Tor refused this torrc, so nothing was changed/);
    expect(r.out).toMatch(/Could not bind to 127\.0\.0\.1:6666: Address already in use/);
    expect(t.torrc()).toBe(TORRC);
    expect(t.backups()).toEqual([]);
  });

  it("a backup can be put back, and the file it replaces becomes a backup too", async () => {
    const t = setup();
    t.run(saveTorrcCommand(setOn(TORRC, 18, true)));
    const [first] = t.backups();
    await new Promise((r) => setTimeout(r, 1100)); // backups are named to the second
    expect(t.run(restoreCommand(first)).out).toMatch(/is back/);
    expect(t.torrc()).toBe(TORRC);
    expect(t.backups()).toHaveLength(2);
    expect(() => restoreCommand("torrc; rm -rf /")).toThrow(/not a torrc backup/);
  });
});
