// Programs talking to the internet now.
import { describe, expect, it } from "vitest";
import { ALL_AS_ROOT, byProgram, connWords, hostOf, onYourNetwork, plainWeb, type Conn } from "@/lib/conns";

const c = (program: string, peer: string, pkg = ""): Conn => ({ proto: "tcp", local: "192.168.0.9:40000", peer, program, pid: program ? 1 : null, package: pkg });

describe("who talks to the internet", () => {
  it("each connection in words: what, and with whom", () => {
    expect(connWords(c("codium", "140.82.112.4:443"))).toBe("secure web (HTTPS), with the internet (140.82.112.4)");
    expect(connWords(c("x", "192.168.0.1:67"))).toBe("your network giving this computer its address (DHCP), with a computer on your own network (192.168.0.1)");
    expect(connWords(c("x", "[2606:4700::1111]:853"))).toBe("a private name lookup (DNS over TLS), with the internet (2606:4700::1111)");
    expect(connWords(c("x", "203.0.113.5:4444"))).toBe("port 4444, with the internet (203.0.113.5)");
  });

  it("your own network is told apart", () => {
    for (const h of ["10.1.2.3", "192.168.0.1", "172.16.0.1", "172.31.255.1", "fe80::1", "fd00::1"]) expect(onYourNetwork(h), h).toBe(true);
    for (const h of ["172.32.0.1", "8.8.8.8", "2606:4700::1111"]) expect(onYourNetwork(h), h).toBe(false);
    expect(hostOf("[fe80::1%wlan0]:5353")).toBe("fe80::1");
  });

  it("grouped by program, busiest first, the system's own last", () => {
    const g = byProgram([c("", "1.1.1.1:443"), c("codium", "1.1.1.1:443", "vscodium-bin"), c("claude", "2.2.2.2:443"), c("claude", "3.3.3.3:443")]);
    expect(g.map((x) => x.program)).toEqual(["claude", "codium", ""]);
    expect(g[1].package).toBe("vscodium-bin");
  });

  it("plain web to the internet is the one to notice; to your own network it isn't", () => {
    expect(plainWeb([c("a", "93.184.216.34:80"), c("b", "192.168.0.1:80"), c("c", "1.1.1.1:443")]).map((x) => x.program)).toEqual(["a"]);
    expect(ALL_AS_ROOT).toBe("sudo ss -tunp state established");
  });
});
