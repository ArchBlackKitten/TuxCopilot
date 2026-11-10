// DNS in the Firewall section: who answers now, read from resolvectl; Quad9's and Cloudflare's
// options; encryption that fits a VPN; and a change that puts the old settings back by itself.
import { describe, expect, it } from "vitest";
import { currentDns, DNS_CHOICES, DNS_FILE, dnsCommand, dnsConf, parseResolvectl, recommendedDns, whoAnswers } from "@/lib/dns";

// a computer with a VPN on tun0: nothing chosen, systemd's fallbacks
const OWNERS = `Global
           Protocols: +LLMNR +mDNS -DNSOverTLS DNSSEC=no/unsupported
    resolv.conf mode: foreign
Fallback DNS Servers: 9.9.9.9#dns.quad9.net 2620:fe::9#dns.quad9.net
                      1.1.1.1#cloudflare-dns.com

Link 3 (wlan0)
    Current Scopes: LLMNR/IPv4 LLMNR/IPv6 mDNS/IPv4 mDNS/IPv6
         Protocols: -DefaultRoute +LLMNR +mDNS -DNSOverTLS DNSSEC=no/unsupported
     Default Route: no

Link 50 (tun0)
    Current Scopes: DNS LLMNR/IPv4 LLMNR/IPv6 mDNS/IPv4 mDNS/IPv6
         Protocols: +DefaultRoute +LLMNR +mDNS -DNSOverTLS DNSSEC=no/unsupported
Current DNS Server: 10.8.0.1
       DNS Servers: 10.8.0.1
        DNS Domain: ~.
     Default Route: yes
`;

const QUAD9_SET = `Global
           Protocols: +LLMNR +mDNS +DNSOverTLS DNSSEC=no/unsupported
         DNS Servers: 9.9.9.9#dns.quad9.net 149.112.112.112#dns.quad9.net
                      2620:fe::fe#dns.quad9.net
          DNS Domain: ~.

Link 3 (wlan0)
         Protocols: +DefaultRoute -LLMNR +mDNS +DNSOverTLS DNSSEC=no/unsupported
       DNS Servers: 192.168.1.1
     Default Route: yes
`;

describe("DNS", () => {
  it("reads who answers now, values on following lines included", () => {
    const n = parseResolvectl(OWNERS);
    expect(n.fallback).toEqual(["9.9.9.9#dns.quad9.net", "2620:fe::9#dns.quad9.net", "1.1.1.1#cloudflare-dns.com"]);
    expect([n.dot, n.llmnr, n.servers]).toEqual([false, true, []]);
    expect(n.links).toEqual([{ index: 50, name: "tun0", servers: ["10.8.0.1"], domains: ["~."], defaultRoute: true, dot: false }]); // wlan0 has none
    expect(whoAnswers(n)).toBe("your VPN (tun0: 10.8.0.1)");
    const q = parseResolvectl(QUAD9_SET);
    expect(q.servers).toEqual(["9.9.9.9#dns.quad9.net", "149.112.112.112#dns.quad9.net", "2620:fe::fe#dns.quad9.net"]);
    expect([q.dot, q.llmnr]).toEqual([true, true]);
    expect(whoAnswers(q)).toBe("the servers chosen for this computer (9.9.9.9, 149.112.112.112, 2620:fe::fe)");
    expect(whoAnswers(parseResolvectl(QUAD9_SET.replace(/ +DNS Servers: 9[\s\S]*?DNS Domain: ~\.\n/, "")))).toBe("your network's own (wlan0: 192.168.1.1)");
    expect(whoAnswers(parseResolvectl(""))).toBe("nobody: no DNS server is known");
    expect(whoAnswers(parseResolvectl(OWNERS.split("\nLink 3")[0]))).toMatch(/^nobody chosen: systemd's fallback servers \(9\.9\.9\.9, 2620:fe::9, 1\.1\.1\.1\)$/);
  });

  it("Quad9's three and Cloudflare's three, each server named for its certificate", () => {
    const s = (id: string) => DNS_CHOICES.find((c) => c.id === id)!.servers;
    expect(s("quad9")).toEqual(["9.9.9.9#dns.quad9.net", "149.112.112.112#dns.quad9.net", "2620:fe::fe#dns.quad9.net", "2620:fe::9#dns.quad9.net"]);
    expect(s("quad9-plain")[0]).toBe("9.9.9.10#dns10.quad9.net");
    expect(s("quad9-ecs")[0]).toBe("9.9.9.11#dns11.quad9.net");
    expect(s("cloudflare")[0]).toBe("1.1.1.1#cloudflare-dns.com");
    expect(s("cloudflare-security")[0]).toBe("1.1.1.2#security.cloudflare-dns.com");
    expect(s("cloudflare-family")[0]).toBe("1.1.1.3#family.cloudflare-dns.com");
    expect(s("network")).toEqual([]);
    for (const c of DNS_CHOICES.filter((c) => c.id !== "network")) expect(c.servers.every((x) => /^[\d.:a-f]+#[a-z0-9.-]+$/.test(x)), c.id).toBe(true);
  });

  it("Fluff recommends Quad9, always encrypted — when possible with a VPN", () => {
    expect(recommendedDns(false)).toEqual({ choice: "quad9", encryption: "always" });
    expect(recommendedDns(true)).toEqual({ choice: "quad9", encryption: "possible" });
  });

  it("the file it writes, and reading it back", () => {
    const q = dnsConf("quad9", "always");
    expect(q).toContain("\n[Resolve]\nDNS=9.9.9.9#dns.quad9.net 149.112.112.112#dns.quad9.net 2620:fe::fe#dns.quad9.net 2620:fe::9#dns.quad9.net\nDomains=~.\nDNSOverTLS=yes\nLLMNR=no\n");
    expect(dnsConf("cloudflare", "possible")).toContain("DNSOverTLS=opportunistic");
    expect(dnsConf("cloudflare", "off")).toContain("DNSOverTLS=no");
    expect(dnsConf("network", "always")).toMatch(/\[Resolve\]\nLLMNR=no\n$/); // nothing chosen: only LLMNR off
    for (const c of DNS_CHOICES) for (const e of ["always", "possible", "off"] as const) {
      const back = currentDns(dnsConf(c.id, e));
      expect(back, `${c.id} ${e}`).toEqual(c.id === "network" ? { choice: "network", encryption: "off" } : { choice: c.id, encryption: e });
    }
    expect(currentDns(null)).toBeNull();
    expect(currentDns("[Resolve]\nDNS=9.9.9.9\n")).toBeNull(); // not Fluff's file
    expect(currentDns(dnsConf("quad9", "always").replace(/^# TuxCopilot.*\n/gm, ""))).toBeNull(); // the same servers, but someone else's file
    expect(currentDns("# TuxCopilot: DNS — x\n[Resolve]\nDNS=8.8.8.8\n")).toBeNull(); // changed by hand
  });

  it("the change: TuxCopilot's file, checked by a lookup, the old settings back if it fails", () => {
    const c = dnsCommand(dnsConf("quad9", "always"));
    expect(c).toContain(`sudo tee "${DNS_FILE}"`);
    expect(c).toContain("sudo systemctl restart systemd-resolved.service");
    expect(c).toMatch(/if \{ why=; resolvectl query --cache=no archlinux\.org .* then sudo rm -f "[^"]+"\.before;/);
    expect(c).toMatch(/else .*if \[ -e "[^"]+"\.before \]; then sudo mv "[^"]+"\.before "[^"]+"; else sudo rm -f "[^"]+"; fi; sudo systemctl restart systemd-resolved\.service; false; fi$/);
    expect(c.indexOf("sudo cp -p")).toBeLessThan(c.indexOf("sudo tee")); // the old one kept before the new one is written
    const bytes = Uint8Array.from(atob(c.match(/printf '%s' '([^']+)'/)![1]), (ch) => ch.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe(dnsConf("quad9", "always")); // UTF-8, as base64 -d writes it
  });
});
