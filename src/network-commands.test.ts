// Security → Network's commands, run for real against a fake firewalld and a fake systemd-resolved:
// no gap left, no error masked. Each failure says only what the command wrote to stderr —
// never the command's own text, which holds Fluff's messages too.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeCommand, defaultZoneCommand, openCommand, presetCommand, type FirewallState, type Zone } from "@/lib/firewall";
import { DNS_FILE, dnsCommand, dnsConf, dnsRemoveCommand } from "@/lib/dns";

// bash's own ${…} is written @{…} here (a template would take ${ for its own)
const FAKE_FW = String.raw`#!/bin/bash
D=$FAKE_DIR/fw; perm=; zone=
if [ -n "$FW_FAIL" ] && [[ " $* " == *"$FW_FAIL"* ]]; then echo "Error: COMMAND_FAILED (fake)" >&2; exit 252; fi
for a in "$@"; do case $a in --permanent) perm=1;; --zone=*) zone=@{a#--zone=}; zone=@{zone//\'/};; esac; done
zone=@{zone:-$(cat $D/default)}
pd=$D/perm/$zone; rd=$D/run/$zone; d=$rd; [ -n "$perm" ] && d=$pd
mkdir -p $pd $rd; touch $pd/services $pd/ports $rd/services $rd/ports; [ -f $pd/target ] || echo default > $pd/target
for a in "$@"; do v=@{a#*=}; v=@{v//\'/}; case $a in
  --state) echo running;;
  --get-default-zone) cat $D/default;;
  --set-default-zone=*) [ -n "$FW_STUCK_DEFAULT" ] || echo "$v" > $D/default; echo success;;
  --add-service=*) grep -qx "$v" $d/services || echo "$v" >> $d/services;;
  --remove-service=*) grep -vx "$v" $d/services > $d/t; mv $d/t $d/services;;
  --remove-port=*) [ -n "$FW_KEEP_PORT" ] || { grep -vx "$v" $d/ports > $d/t; mv $d/t $d/ports; };;
  --set-target=*) [ -n "$FW_STUCK_TARGET" ] || echo "$v" > $pd/target;;
  --reload) [ -n "$FW_NO_RELOAD" ] || { rm -rf $D/run; cp -r $D/perm $D/run; }; echo success;;
  --list-services) sort $d/services | xargs;;
  --list-ports) xargs < $d/ports;;
  --get-target) cat $pd/target;;
  --query-service=*) if grep -qx "$v" $d/services; then echo yes; else echo no; exit 1; fi;;
  --get-active-zones) cat $D/default; echo "  interfaces: wlan0";;
  --list-all) echo "$zone (active)"; echo "  services: $(xargs < $d/services)";;
esac; done
`;

function machine(o: { zones?: Record<string, { services?: string[]; ports?: string[]; target?: string }>; def?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "tux-net-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const fw = join(root, "fw");
  writeFileSync(join(root, "fw.default"), "");
  mkdirSync(join(fw, "perm"), { recursive: true });
  writeFileSync(join(fw, "default"), `${o.def ?? "public"}\n`);
  for (const [z, c] of Object.entries(o.zones ?? {})) {
    mkdirSync(join(fw, "perm", z), { recursive: true });
    writeFileSync(join(fw, "perm", z, "services"), (c.services ?? []).map((s) => `${s}\n`).join(""));
    writeFileSync(join(fw, "perm", z, "ports"), (c.ports ?? []).map((s) => `${s}\n`).join(""));
    writeFileSync(join(fw, "perm", z, "target"), `${c.target ?? "default"}\n`);
  }
  execFileSync("bash", ["-c", `rm -rf ${fw}/run && cp -r ${fw}/perm ${fw}/run`]);
  const tool = (name: string, body: string) => {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  };
  tool("firewall-cmd", FAKE_FW.replaceAll("@{", "${"));
  tool("sudo", `#!/bin/bash\nexec "$@"\n`);
  return {
    root,
    tool,
    run: (cmd: string, env: Record<string, string> = {}) => {
      try {
        return execFileSync("bash", ["-c", cmd], { encoding: "utf8", stdio: "pipe", env: { ...process.env, ...env, FAKE_DIR: root, PATH: `${bin}:${process.env.PATH}` } });
      } catch (e) {
        throw new Error(`stderr: ${(e as { stderr?: string }).stderr ?? ""}`);
      }
    },
    services: (z: string, where: "perm" | "run") => readFileSync(join(fw, where, z, "services"), "utf8").split("\n").filter(Boolean).sort(),
    ports: (z: string, where: "perm" | "run") => readFileSync(join(fw, where, z, "ports"), "utf8").split("\n").filter(Boolean),
    target: (z: string) => readFileSync(join(fw, "perm", z, "target"), "utf8").trim(),
    def: () => readFileSync(join(fw, "default"), "utf8").trim(),
  };
}

const zone = (name: string, o: Partial<Zone> = {}): Zone => ({ name, short: name, description: "", default: false, target: "default", connections: [], services: [], ports: [], masquerade: false, changed: false, ...o });
const state = (zones: Zone[]): FirewallState => ({ firewalldInstalled: true, firewalldOn: true, ufwInstalled: false, ufwOn: false, defaultZone: "home", zones: [], servicePorts: [], networks: [], presetZones: zones });

describe("the firewall's commands, against a fake firewalld", () => {
  const before = { home: { services: ["dhcpv6-client", "mdns", "samba-client"] }, public: { services: ["dhcpv6-client", "ssh"], ports: ["8080/tcp"] }, drop: { target: "default" } };
  const f = state([zone("home", { default: true, services: before.home.services }), zone("public", { services: before.public.services, ports: before.public.ports }), zone("drop")]);

  it("Out and about: services and ports as it says, now and from the next start; it says the zone it replaced and the way back", () => {
    const m = machine({ zones: before, def: "home" });
    const out = m.run(presetCommand(f, "public", false, new Set()));
    expect(m.def()).toBe("public");
    for (const w of ["perm", "run"] as const) {
      expect(m.services("public", w), w).toEqual(["dhcpv6-client"]);
      expect(m.ports("public", w), w).toEqual([]); // the port opened by hand is closed
    }
    expect(out).toContain("Fluff: the default zone was home.");
    expect(out).toContain("To go back: sudo firewall-cmd --set-default-zone=home");
    expect(out).toContain("public (active)"); // everything it does now, shown
  });

  it("Stealth: a drop zone that didn't drop is made to", () => {
    const m = machine({ zones: before, def: "public" });
    m.run(presetCommand(f, "drop", false, new Set()));
    expect(m.target("drop")).toBe("DROP");
    expect(m.def()).toBe("drop");
  });

  it("a firewall-cmd that fails stops the command, out loud", () => {
    const m = machine({ zones: before, def: "home" });
    expect(() => m.run(presetCommand(f, "public", false, new Set()), { FW_FAIL: "--set-default-zone" })).toThrow(/^stderr: Error: COMMAND_FAILED/);
    expect(m.def()).toBe("home");
  });

  it("a reload that didn't take, or a default that didn't change, is caught by the check", () => {
    expect(() => machine({ zones: before, def: "home" }).run(presetCommand(f, "public", false, new Set()), { FW_NO_RELOAD: "1" })).toThrow(/^stderr: Fluff: the firewall isn't as “Out and about” says: services-now/);
    expect(() => machine({ zones: before, def: "home" }).run(presetCommand(f, "public", false, new Set()), { FW_STUCK_DEFAULT: "1" })).toThrow(/^stderr: Fluff: the firewall isn't as “Out and about” says: default-zone/);
  });

  it("a port that stayed open, or a drop zone that still doesn't drop, is caught by the check", () => {
    expect(() => machine({ zones: before, def: "home" }).run(presetCommand(f, "public", false, new Set()), { FW_KEEP_PORT: "1" })).toThrow(/^stderr: Fluff: the firewall isn't as “Out and about” says: ports$/m);
    expect(() => machine({ zones: before, def: "public" }).run(presetCommand(f, "drop", false, new Set()), { FW_STUCK_TARGET: "1" })).toThrow(/^stderr: Fluff: the firewall isn't as “Stealth” says: target$/m);
  });

  it("the check can't be fooled by a list that failed: Stealth's empty list isn't taken from an error", () => {
    const m = machine({ zones: { ...before, drop: { target: "DROP" } }, def: "public" });
    const stealth = state([zone("public", { default: true, services: before.public.services }), zone("drop", { target: "DROP" })]);
    expect(() => m.run(presetCommand(stealth, "drop", false, new Set()), { FW_FAIL: "--list-services" })).toThrow(/^stderr: (Error: COMMAND_FAILED \(fake\)\n)+Fluff: the firewall isn't as “Stealth” says: services-now services-from-the-next-start/);
  });

  it("closing and opening one service: checked now and from the next start", () => {
    const m = machine({ zones: before, def: "public" });
    m.run(closeCommand("public", "ssh"));
    expect(m.services("public", "run")).toEqual(["dhcpv6-client"]);
    m.run(openCommand("public", "ssh"));
    expect(m.services("public", "perm")).toEqual(["dhcpv6-client", "ssh"]);
    const stuck = machine({ zones: before, def: "public" });
    expect(() => stuck.run(closeCommand("public", "ssh"), { FW_NO_RELOAD: "1" })).toThrow(/^stderr: Fluff: ssh is still open in public\.$/m);
    // a query that can't be asked is a failure, not a "no"
    expect(() => machine({ zones: before, def: "public" }).run(closeCommand("public", "ssh"), { FW_FAIL: "--query-service" })).toThrow(/^stderr: Error: COMMAND_FAILED \(fake\)\nFluff: ssh is still open in public\./);
  });

  it("the default zone by itself: checked, and the way back said", () => {
    const m = machine({ zones: before, def: "home" });
    expect(m.run(defaultZoneCommand("public"))).toContain("To go back: sudo firewall-cmd --set-default-zone=home");
    expect(() => machine({ zones: before, def: "home" }).run(defaultZoneCommand("public"), { FW_STUCK_DEFAULT: "1" })).toThrow(/^stderr: Fluff: the default zone isn't public\./);
  });
});

describe("DNS's commands, against a fake systemd-resolved", () => {
  // resolvectl that says what the file says (or what FAKE_* forces), and a lookup that works unless told not to
  const resolved = (m: ReturnType<typeof machine>, o: { mode?: string } = {}) => {
    const conf = join(m.root, "resolved.conf");
    m.tool(
      "resolvectl",
      String.raw`#!/bin/bash
f=$(cat ${conf} 2>/dev/null)
case "$1" in
  status) echo Global; echo "    resolv.conf mode: ${o.mode ?? "stub"}";;
  dns) echo "Global: @{FAKE_DNS-$(printf '%s\n' "$f" | sed -n 's/^DNS=//p')}";;
  dnsovertls) echo "Global: @{FAKE_DOT-$(printf '%s\n' "$f" | sed -n 's/^DNSOverTLS=//p' | grep . || echo no)}";;
  query) [ -z "$FAKE_NO_LOOKUP" ];;
esac
`.replaceAll("@{", "${"),
    );
    m.tool("systemctl", "#!/bin/bash\ntrue\n");
    m.tool("sleep", "#!/bin/bash\ntrue\n");
    const local = (c: string) => c.replaceAll(DNS_FILE, conf).replaceAll("sudo install -d -m 755 /etc/systemd/resolved.conf.d", "true");
    return { conf, run: (c: string, env: Record<string, string> = {}) => m.run(local(c), env), file: () => readFileSync(conf, "utf8") };
  };

  it("set, then checked: servers and encryption as the file says", () => {
    const r = resolved(machine());
    expect(r.run(dnsCommand(dnsConf("quad9", "always")))).toContain("DNS works with the new settings, as they say.");
    expect(r.file()).toBe(dnsConf("quad9", "always"));
  });

  it("resolved not using the new servers, or not encrypting: the old settings come back, and it says why", () => {
    for (const [env, why] of [
      [{ FAKE_DNS: "192.168.1.1" }, "systemd-resolved doesn't use the new servers"],
      [{ FAKE_DOT: "no" }, "encryption is no, not yes"],
      [{ FAKE_NO_LOOKUP: "1" }, "looking up archlinux.org failed"],
    ] as const) {
      const r = resolved(machine());
      writeFileSync(r.conf, dnsConf("quad9", "possible"));
      expect(() => r.run(dnsCommand(dnsConf("quad9", "always")), env), why).toThrow(new RegExp(`^stderr: Fluff: ${why} — so Fluff put the old settings back\\.`));
      expect(r.file(), why).toBe(dnsConf("quad9", "possible"));
    }
  });

  it("programs that don't ask resolved: refused before anything changes", () => {
    const r = resolved(machine(), { mode: "foreign" });
    writeFileSync(r.conf, "before\n");
    expect(() => r.run(dnsCommand(dnsConf("quad9", "always")))).toThrow(/^stderr: Fluff: your programs don't ask systemd-resolved \(resolv\.conf mode: foreign — .*Nothing was changed\.$/m);
    expect(r.file()).toBe("before\n");
  });

  it("As it comes: the file goes, and comes back if names can't be looked up without it", () => {
    const r = resolved(machine());
    writeFileSync(r.conf, dnsConf("quad9", "always"));
    expect(() => r.run(dnsRemoveCommand(), { FAKE_NO_LOOKUP: "1" })).toThrow(/^stderr: Fluff: looking up archlinux\.org failed without TuxCopilot's DNS file, so Fluff put it back\./);
    expect(r.file()).toBe(dnsConf("quad9", "always"));
    expect(r.run(dnsRemoveCommand())).toContain("DNS works as your network gives it.");
    expect(() => r.file()).toThrow(); // gone
  });
});
