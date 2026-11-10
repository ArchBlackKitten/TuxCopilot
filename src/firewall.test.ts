// The Firewall section's advice: turn one on, never two, close what nothing uses, open what an
// installed app needs, and every command checked before it is built.
import { describe, expect, it } from "vitest";
import { advice, choosableNetworks, closeCommand, currentPreset, FIREWALLD_INSTALL, FIREWALLD_ON, FW_PRESETS, UFW_OFF, networkZoneCommand, openCommand, presetChanges, presetCommand, presetServices, type FirewallState, type Network, type Zone } from "@/lib/firewall";
import type { Service } from "@/lib/services";

const zone = (o: Partial<Zone>): Zone => ({ name: "public", short: "Public", description: "", default: true, target: "default", connections: ["COWIFI (wlan0)"], services: ["dhcpv6-client"], ports: [], masquerade: false, changed: false, ...o });
const state = (o: Partial<FirewallState>): FirewallState => ({ firewalldInstalled: true, firewalldOn: true, ufwInstalled: false, ufwOn: false, defaultZone: "public", zones: [zone({})], servicePorts: [], networks: [], presetZones: [], ...o });
const svc = (name: string, state: string, enabled = "disabled") => ({ name, state, enabled, description: "", user: false, since: null }) as unknown as Service;
const ids = (a: { id: string }[]) => a.map((x) => x.id);

describe("Fluff's firewall advice", () => {
  it("none on: turn one on (installed or not), and nothing else matters yet", () => {
    const a = advice(state({ firewalldOn: false }), [], new Set());
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ id: "off", level: "bad", fix: { command: FIREWALLD_ON } });
    expect(FIREWALLD_ON).toMatch(/^sudo systemctl enable --now firewalld\.service && \{ r=\$\(sudo firewall-cmd --state\); \[ "\$r" = running \] \|\| /); // and checked running
    expect(advice(state({ firewalldOn: false, firewalldInstalled: false }), [], new Set())[0].fix?.command).toBe(FIREWALLD_INSTALL);
    expect(FIREWALLD_INSTALL).toContain("pacman -Syu --needed firewalld");
  });

  it("two on: keep one", () => {
    expect(advice(state({ ufwOn: true }), [], new Set())[0]).toMatchObject({ id: "both", fix: { command: UFW_OFF } });
    expect(UFW_OFF).toMatch(/^sudo systemctl disable --now ufw\.service && \{ ! systemctl is-active -q ufw\.service \|\| \{ echo "Fluff: ufw is still running\." >&2; false; \}; \}$/);
  });

  it("SSH let in with no SSH server: close it — but not when sshd runs or starts at boot", () => {
    const f = state({ zones: [zone({ services: ["ssh", "dhcpv6-client"] })] });
    const a = advice(f, [svc("cups.service", "running")], new Set());
    expect(a[0]).toMatchObject({ id: "ssh:public", level: "warn" });
    expect(a[0].fix!.command).toBe(closeCommand("public", "ssh"));
    expect(closeCommand("public", "ssh")).toMatch(/^sudo firewall-cmd --permanent --zone='public' --remove-service='ssh' && sudo firewall-cmd --reload && /); // and then checked, now and from the next start
    expect(ids(advice(f, [svc("sshd.service", "running")], new Set()))).not.toContain("ssh:public");
    expect(ids(advice(f, [svc("sshd.service", "off", "enabled")], new Set()))).not.toContain("ssh:public");
    expect(ids(advice(f, null, new Set()))).not.toContain("ssh:public"); // services unknown: Fluff doesn't guess
  });

  it("an installed app that needs a door: offered, in the default zone", () => {
    const a = advice(state({}), [], new Set(["kdeconnect"]));
    expect(a.find((x) => x.id === "need:kdeconnect")?.fix?.command).toBe(openCommand("public", "kdeconnect"));
    expect(ids(advice(state({ zones: [zone({ services: ["kdeconnect"] })] }), [], new Set(["kdeconnect"])))).not.toContain("need:kdeconnect");
  });

  it("all right: said plainly; Docker's ACCEPT zone is Docker's", () => {
    const a = advice(state({ zones: [zone({}), zone({ name: "docker", default: false, target: "ACCEPT", services: [] })] }), [], new Set());
    expect(a[0]).toMatchObject({ id: "fine", level: "ok" });
    expect(ids(a)).not.toContain("accept:docker");
    expect(ids(advice(state({ zones: [zone({}), zone({ name: "home", default: false, target: "ACCEPT" })] }), [], new Set()))).toContain("accept:home");
  });

  it("names are checked before a command is built", () => {
    expect(() => closeCommand("public; rm -rf ~", "ssh")).toThrow(/not a zone name/);
    expect(() => openCommand("public", "ssh' && x '")).toThrow(/not a service name/);
  });
});

describe("Fluff's firewall settings (like Tor's presets)", () => {
  const pub = zone({ name: "public", default: true, services: ["dhcpv6-client", "ssh"] });
  const home = zone({ name: "home", default: false, connections: [], services: ["dhcpv6-client", "mdns", "samba-client", "ssh"] });
  const drop = zone({ name: "drop", default: false, connections: [], target: "DROP", services: [] });
  const f = state({ presetZones: [pub, home, drop] });
  const none = new Set<string>();

  it("three settings, Out and about first (Fluff recommends it), each said plainly with what it costs", () => {
    expect(FW_PRESETS.map((p) => [p.id, p.label])).toEqual([["public", "Out and about"], ["home", "Home"], ["drop", "Stealth"]]);
    expect(FW_PRESETS[0].caution).toBeNull();
    expect(FW_PRESETS.slice(1).every((p) => p.caution)).toBe(true);
  });

  it("what each lets in: SSH only when an SSH server runs (never in Stealth); Home opens what installed apps need", () => {
    expect(presetServices("public", false, none)).toEqual(["dhcpv6-client"]);
    expect(presetServices("public", true, none)).toEqual(["dhcpv6-client", "ssh"]);
    expect(presetServices("home", false, new Set(["kdeconnect", "syncthing", "vlc"]))).toEqual(["dhcpv6-client", "kdeconnect", "mdns", "samba-client", "syncthing"]);
    expect(presetServices("public", false, new Set(["kdeconnect"]))).toEqual(["dhcpv6-client"]); // not on a café's network
    expect(presetServices("drop", true, new Set(["kdeconnect"]))).toEqual([]);
  });

  it("choosing one: what it opens and closes, saved then applied, and made the default for every network", () => {
    expect(presetChanges(f, "public", false, none)).toEqual({ opens: [], closes: ["ssh"], closesPorts: [], target: null });
    // the zone it replaces first, then saved, applied, made the default — then checked, shown, and the way back said
    expect(presetCommand(f, "public", false, none)).toMatch(
      /^was=\$\(sudo firewall-cmd --get-default-zone\) && sudo firewall-cmd --permanent --zone='public' --remove-service='ssh' && sudo firewall-cmd --reload && sudo firewall-cmd --set-default-zone='public' && \{ bad=; .* && sudo firewall-cmd --zone='public' --list-all && echo "Fluff: the default zone was \$was\..*To go back: sudo firewall-cmd --set-default-zone=\$was"$/,
    );
    expect(presetChanges(f, "home", false, new Set(["kdeconnect"]))).toEqual({ opens: ["kdeconnect"], closes: ["ssh"], closesPorts: [], target: null });
    expect(presetCommand(f, "drop", false, none)).toMatch(/^was=\$\(sudo firewall-cmd --get-default-zone\) && sudo firewall-cmd --set-default-zone='drop' && \{ bad=/); // nothing to open or close
    expect(presetCommand(state({ presetZones: [] }), "public", false, none)).toMatch(
      /^was=\$\(sudo firewall-cmd --get-default-zone\) && sudo firewall-cmd --permanent --zone='public' --add-service='dhcpv6-client' && sudo firewall-cmd --reload && sudo firewall-cmd --set-default-zone='public' && /,
    );
    // ports opened by hand are closed, and Stealth drops what nothing lets in
    const hand = state({ presetZones: [{ ...pub, ports: ["8080/tcp"] }, { ...drop, target: "default" }] });
    expect(presetChanges(hand, "public", true, none)).toEqual({ opens: [], closes: [], closesPorts: ["8080/tcp"], target: null });
    expect(presetCommand(hand, "public", true, none)).toContain("sudo firewall-cmd --permanent --zone='public' --remove-port='8080/tcp' && sudo firewall-cmd --reload");
    expect(presetChanges(hand, "drop", false, none).target).toBe("DROP");
    expect(presetCommand(hand, "drop", false, none)).toContain("sudo firewall-cmd --permanent --zone='drop' --set-target=DROP && sudo firewall-cmd --reload");
    expect(() => presetCommand(state({ presetZones: [{ ...pub, ports: ["80; reboot"] }] }), "public", false, none)).toThrow(/not a port/);
  });

  it("which one is on now: the default zone exactly as Fluff sets it, or your own settings", () => {
    expect(currentPreset(f, true, none)).toBe("public");
    expect(currentPreset(f, false, none)).toBeNull(); // SSH open with no server: not Fluff's
    expect(currentPreset(state({ presetZones: [{ ...pub, services: ["dhcpv6-client"], ports: ["8080/tcp"] }] }), false, none)).toBeNull();
    expect(currentPreset(state({ presetZones: [{ ...drop, default: true }] }), false, none)).toBe("drop");
    expect(currentPreset(state({ presetZones: [{ ...drop, default: true, target: "default" }] }), false, none)).toBeNull(); // a "drop" zone that doesn't drop isn't Stealth
    expect(currentPreset(state({ presetZones: [{ ...pub, default: false }] }), true, none)).toBeNull(); // the default is another zone
  });

  it("one network gets its own zone (or goes back to the setting above), checked before the command is built", () => {
    const n: Network = { name: "Home WiFi", uuid: "0b6e3f0a-1c2d-4e5f-8a9b-0c1d2e3f4a5b", device: "wlan0", kind: "802-11-wireless", zone: "" };
    expect(networkZoneCommand(n, "home")).toBe(
      "sudo nmcli connection modify 0b6e3f0a-1c2d-4e5f-8a9b-0c1d2e3f4a5b connection.zone 'home' && sudo nmcli device reapply 'wlan0' && { r=$(nmcli -g connection.zone connection show 0b6e3f0a-1c2d-4e5f-8a9b-0c1d2e3f4a5b); [ \"$r\" = 'home' ] || { echo \"Fluff: Home WiFi doesn't use home.\" >&2; false; }; }",
    );
    expect(networkZoneCommand(n, "")).toMatch(/^sudo nmcli connection modify 0b6e3f0a-1c2d-4e5f-8a9b-0c1d2e3f4a5b connection\.zone "" && sudo nmcli device reapply 'wlan0' && \{ r=.*; \[ "\$r" = "" \] \|\| \{ echo "Fluff: Home WiFi doesn't use the default zone\." >&2; false; \}; \}$/);
    expect(() => networkZoneCommand({ ...n, uuid: "x; rm -rf ~" }, "home")).toThrow();
    expect(() => networkZoneCommand({ ...n, device: "wlan0; reboot" }, "home")).toThrow();
    expect(() => networkZoneCommand(n, "home; reboot")).toThrow();
    const docker = { ...n, name: "docker0", device: "docker0", kind: "bridge" };
    expect(choosableNetworks(state({ networks: [n, docker, { ...n, device: "virbr0", kind: "802-3-ethernet" }] }))).toEqual([n]);
    expect(choosableNetworks(state({ networks: [{ ...n, device: "tun0", kind: "tun" }, { ...n, device: "lanbr", kind: "bridge" }] }))).toEqual([]);
    // a VPN on wlan0 beside the Wi-Fi, and its kill switch
    const vpn = { ...n, name: "My VPN", kind: "vpn" };
    const kill = { ...n, name: "vpn-killswitch", device: "vpnks0", kind: "dummy" };
    expect(choosableNetworks(state({ networks: [vpn, kill, n, { ...n, device: "wg0", kind: "wireguard" }] }))).toEqual([n]);
  });
});

