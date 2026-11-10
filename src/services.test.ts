// Services: the buttons each state gets, the commands they run, and what Fluff protects.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { buttons, killCommand, offCommand, onCommand, protectedWhy, fluffSays, type Service } from "@/lib/services";

const svc = (name: string, state: Service["state"], enabled = "enabled", user = false): Service => ({ name, description: "", user, state, enabled, since: null });

describe("services", () => {
  it("On, Off, Kill: the commands, sudo for the system's, --user for yours", () => {
    expect(onCommand(svc("cups.service", "off", "disabled"))).toBe("sudo systemctl enable --now 'cups.service'");
    expect(offCommand(svc("cups.service", "running"))).toBe("sudo systemctl disable --now 'cups.service'");
    expect(killCommand(svc("cups.service", "running"))).toBe("sudo systemctl kill --signal=SIGKILL 'cups.service'");
    expect(onCommand(svc("foo.service", "on demand", "static"))).toBe("sudo systemctl start 'foo.service'");
    expect(offCommand(svc("syncthing.service", "running", "enabled", true))).toBe("systemctl --user disable --now 'syncthing.service'");
    expect(onCommand(svc("dev-disk-by\\x2duuid.service", "off", "disabled"))).toContain("'dev-disk-by\\x2duuid.service'");
    for (const c of [onCommand(svc("cups.service", "off", "disabled")), killCommand(svc("a@b.service", "running"))]) execFileSync("bash", ["-n", "-c", c]);
    for (const bad of ["x'; rm -rf ~.service", "$(id).service", "cups", "a b.service"]) expect(() => onCommand(svc(bad, "off")), bad).toThrow();
  });

  it("Kill only for what runs; nothing for a blocked one; Fluff keeps the computer's own on", () => {
    expect(buttons(svc("cups.service", "running"))).toEqual({ on: false, off: true, kill: true });
    expect(buttons(svc("cups.service", "dead"))).toMatchObject({ on: true, kill: false });
    expect(buttons(svc("x.service", "blocked", "masked"))).toEqual({ on: false, off: false, kill: false });
    expect(buttons(svc("NetworkManager.service", "running"))).toEqual({ on: false, off: false, kill: false });
    expect(protectedWhy({ name: "NetworkManager.service" })).toMatch(/network/);
    expect(protectedWhy({ name: "systemd-journald.service" })).toMatch(/systemd/);
    expect(protectedWhy({ name: "firewalld.service" })).toMatch(/Security → Network/);
    expect(protectedWhy({ name: "cups.service" })).toBeNull();
  });

  it("Fluff speaks up for what failed or was killed", () => {
    expect(fluffSays(svc("foo.service", "failed"))).toMatch(/log first/);
    expect(fluffSays(svc("foo.service", "dead"))).toMatch(/You killed foo\.service/);
    expect(fluffSays(svc("foo.service", "running"))).toBeNull();
  });
});

describe("TuxCopilot's own ports carry its tag", () => {
  it("the ports TuxCopilot's Tor file sets, and only those", async () => {
    const { torPortsSet, tuxcopilotRole } = await import("@/lib/ports");
    const conf = "# Written by TuxCopilot.\nSocksPort 9050 IsolateDestAddr\nTransPort 127.0.0.1:9040 IsolateClientAddr\nDNSPort 127.0.0.1:5353\n";
    expect([...torPortsSet(conf)]).toEqual([[9050, "SocksPort"], [9040, "TransPort"], [5353, "DNSPort"]]);
    const port = (port: number, service: string | null, program: string | null = null) =>
      ({ port, proto: "tcp", address: "127.0.0.1", reach: "this computer", program, pid: null, service, user: null, container: null }) as const;
    expect(tuxcopilotRole(port(9040, "tor.service"), conf)).toMatch(/TransPort/);
    expect(tuxcopilotRole(port(9050, "tor.service"), null)).toBeNull(); // Tor's own default, not TuxCopilot's
    expect(tuxcopilotRole(port(631, "cups.service"), conf)).toBeNull();
    expect(tuxcopilotRole(port(9040, "other.service"), conf)).toBeNull();
  });

  it("the dev preview by its process, not its port number", async () => {
    const { tuxcopilotRole } = await import("@/lib/ports");
    const dev = { port: 1420, proto: "tcp", address: "127.0.0.1", reach: "this computer", program: "node", pid: 4242, service: null, user: null, container: null } as const;
    const own = new Map([[4242, "TuxCopilot's dev preview (the page npm run tauri dev shows)"]]);
    expect(tuxcopilotRole(dev, null, own)).toMatch(/dev preview/);
    expect(tuxcopilotRole(dev, null, new Map())).toBeNull(); // port 1420 alone says nothing
    expect(tuxcopilotRole({ ...dev, port: 5173 }, null, own)).toMatch(/dev preview/); // on any port
    expect(tuxcopilotRole({ ...dev, pid: null }, null, own)).toBeNull();
  });
});
