// Ports: read from sample `ss -Htulnpe` output, owners as specific as ss
// allows without a password; and the app page's running processes grouped under their main one.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nearestFree, ownerOf, parsePasswd, parseSs, takenBy } from "@/lib/ports";
import { endCommand, installPkgCommand, mainProcesses } from "@/lib/app-details";

const ss = readFileSync(join(__dirname, "test-fixtures/ss.txt"), "utf8");
const users = parsePasswd("root:x:0:0::/root:/bin/bash\ntor:x:43:43::/var/lib/tor:/usr/bin/nologin\nsystemd-resolve:x:974:974::/:/usr/bin/nologin\npenguin:x:1000:1000::/home/penguin:/bin/zsh\n");

describe("who holds which port", () => {
  const ports = parseSs(ss, users);

  it("system services are named by their service, your programs by name and pid", () => {
    const tor = takenBy(ports, 9050);
    expect(tor && ownerOf(tor)).toBe("tor");
    expect(tor?.reach).toBe("this computer");
    const dns = ports.find((p) => p.port === 53 && p.proto === "tcp");
    expect(dns?.service).toBe("systemd-resolved.service");
    expect(dns?.user).toBe("systemd-resolve");
    const mine = ports.find((p) => p.program !== null && p.proto === "tcp");
    expect(mine?.pid).toBeGreaterThan(0);
    expect(mine?.service).toBeNull(); // an app's own scope is not a service
  });

  it("listening TCP only (no connections), no link-local helpers", () => {
    expect(parseSs("tcp ESTAB 0 0 127.0.0.1:5000 127.0.0.1:40000 users:((\"x\",pid=5,fd=3)) uid:1000")).toEqual([]);
    expect(ports.some((p) => p.address.startsWith("[fe80"))).toBe(false);
  });

  it("free or taken, and the nearest free one", () => {
    const fake = parseSs("tcp LISTEN 0 4096 127.0.0.1:8080 0.0.0.0:* ino:1 cgroup:/system.slice/docker.service\ntcp LISTEN 0 4096 0.0.0.0:8081 0.0.0.0:* uid:1000 users:((\"node\",pid=42,fd=3))", users);
    expect(takenBy(fake, 8080)?.service).toBe("docker.service");
    expect(takenBy(fake, 8081)?.reach).toBe("your network");
    expect(takenBy(fake, 8082)).toBeNull();
    expect(nearestFree(fake, 8080)).toBe(8082);
    expect(nearestFree(fake, 80)).toBe(1024);
  });
});

describe("running processes on an app page", () => {
  it("helpers are counted under their main process; only your own can be ended", () => {
    const ps = [
      { pid: 2051, name: "codium", uid: 1000, parent: 1361, mine: true },
      { pid: 2088, name: "codium", uid: 1000, parent: 2051, mine: true },
      { pid: 2125, name: "codium", uid: 1000, parent: 2088, mine: true },
      { pid: 1071, name: "dockerd", uid: 0, parent: 1, mine: false },
    ];
    expect(mainProcesses(ps).map((p) => [p.pid, p.helpers])).toEqual([[2051, 2], [1071, 0]]);
    expect(endCommand([2051])).toBe("kill 2051");
    expect(() => endCommand([1])).toThrow();
    expect(() => endCommand([])).toThrow();
  });

  it("installing from a link: -Syu, and only real package names", () => {
    expect(installPkgCommand("nyx", false)).toBe("sudo pacman -Syu --needed --noconfirm nyx");
    expect(installPkgCommand("lyrebird-proxy", true)).toBe("yay -Syu --needed --noconfirm lyrebird-proxy");
    expect(() => installPkgCommand("x;rm", false)).toThrow();
  });
});

import { portSystemTag } from "@/components/arch/ports-panel";

describe("the System tag", () => {
  const ports = parseSs(ss, users);
  // "system" is base software the machine needs to run: Tor and the printer service are apps
  // you chose; name lookups are the machine's own
  it("only what the machine needs to run is tagged", () => {
    const at = (n: number) => ports.find((p) => p.port === n && p.proto === "tcp")!;
    expect(portSystemTag(at(53), "systemd")).toMatch(/name lookups/);
    expect(portSystemTag(at(9050), "tor")).toBeNull();
    expect(portSystemTag(at(631), "cups")).toBeNull();
    expect(portSystemTag(ports.find((p) => p.program !== null && p.proto === "tcp")!, null)).toBeNull();
  });
});
