// Fluff dismantles the myths about VPNs, Tor and the web (tunnels.ts): each point is there,
// nothing promises what a tunnel can't do, and the VPN up now is named from the networks.
import { describe, expect, it } from "vitest";
import { TUNNEL_PARTS, TUNNELS_IN_ONE, vpnNow } from "@/lib/tunnels";
import type { Network } from "@/lib/firewall";

const part = (id: string) => TUNNEL_PARTS.find((p) => p.id === id)!;
const words = (id: string) => part(id).points.join(" ");
const all = TUNNEL_PARTS.flatMap((p) => [p.title, ...p.points]).join(" ");

describe("Fluff dismantles the myths", () => {
  it("says at once that neither is Wi-Fi protection, and that the firewall is", () => {
    expect(TUNNELS_IN_ONE).toMatch(/Neither one protects your Wi-Fi/);
    expect(TUNNELS_IN_ONE).toMatch(/firewall/);
  });

  it("goes how it works → the myths → which one when", () => {
    // any number of "how" parts first; the order is the rule
    const kinds = TUNNEL_PARTS.map((p) => p.kind);
    const hows = kinds.filter((k) => k === "how").length;
    expect(hows).toBeGreaterThanOrEqual(2);
    expect(kinds.slice(0, hows).every((k) => k === "how")).toBe(true);
    expect(kinds.at(-1)).toBe("which");
    expect(kinds.slice(hows, -1).every((k) => k === "myth")).toBe(true);
    expect(new Set(TUNNEL_PARTS.map((p) => p.id)).size).toBe(TUNNEL_PARTS.length);
    for (const p of TUNNEL_PARTS) expect(p.points.length).toBeGreaterThan(0);
  });

  it("the Wi-Fi myth: others on it can still reach this computer — the firewall's job", () => {
    expect(part("wifi").kind).toBe("myth");
    expect(words("wifi")).toMatch(/can still reach this computer/);
    expect(words("wifi")).toMatch(/firewall's job/);
  });

  it("a VPN moves your trust, and free ones are paid for by something", () => {
    expect(words("anonymous")).toMatch(/VPN company now sees/);
    expect(words("free")).toMatch(/what pays for it/);
    expect(words("logs")).toMatch(/promise you can't check/);
    expect(words("always")).toMatch(/kill switch/);
  });

  it("Tor: three relays, and the exit holds what the website doesn't encrypt", () => {
    expect(words("tor")).toMatch(/three relays/);
    expect(words("tor")).toMatch(/guard.*middle.*exit/);
    expect(words("exit")).toMatch(/exit holds in the clear/);
    expect(words("exit")).toMatch(/http:\/\//);
    expect(words("exit")).toMatch(/\.onion/);
  });

  it("never promises anonymity or safety a tunnel can't give", () => {
    const claims = all.replace(/no setting makes you anonymous/g, "").replace(/Tor makes me anonymous, whatever I do/g, "").replace(/A VPN makes me anonymous/g, "");
    expect(claims).not.toMatch(/makes you anonymous|you are anonymous|completely safe|100%/i);
  });
});

describe("the VPN up now", () => {
  const net = (kind: string, name: string, device = "dev0"): Network => ({ name, uuid: name, device, kind, zone: "" });

  it("names VPNs, WireGuard and tun devices, never Wi-Fi, cable or a bridge", () => {
    const nets = [net("802-11-wireless", "Home Wi-Fi"), net("vpn", "My VPN"), net("wireguard", "wg-work"), net("802-3-ethernet", "cable"), net("bridge", "docker0"), net("tun", "", "tun0")];
    expect(vpnNow(nets)).toEqual(["My VPN", "wg-work", "tun0"]);
  });

  it("none, when nothing tunnels", () => {
    expect(vpnNow([net("802-11-wireless", "Home Wi-Fi")])).toEqual([]);
  });
});

describe("the web's myths", () => {
  const myths = TUNNEL_PARTS.filter((p) => p.kind === "myth");

  it("every myth is in a group, the tunnels' first, then the web's", () => {
    expect(myths.every((p) => p.about === "tunnel" || p.about === "web")).toBe(true);
    const groups = myths.map((p) => p.about);
    expect(groups.lastIndexOf("tunnel")).toBeLessThan(groups.indexOf("web"));
    for (const id of ["incognito", "always-incognito", "delete-history", "ad-data", "cookies", "logged-out", "ad-blocker", "do-not-track"]) expect(part(id).about).toBe("web");
  });

  it("how the web fingerprints you: nothing saved, so deleting and private windows don't change it", () => {
    expect(part("fingerprint").kind).toBe("how");
    expect(words("fingerprint")).toMatch(/often unique to you/);
    expect(words("fingerprint")).toMatch(/needs nothing saved on your computer/);
    expect(words("fingerprint")).toMatch(/Tor Browser answers the same/);
  });

  it("incognito hides you from the next person at this computer, not from the websites", () => {
    expect(words("incognito")).toMatch(/next person using this computer/);
    expect(words("incognito")).toMatch(/websites still see you/);
    expect(words("always-incognito")).toMatch(/fingerprint and your address link/);
  });

  it("deleting erases only this computer's copy; ad settings change the ads, not the collecting", () => {
    expect(words("delete-history")).toMatch(/erases them from this computer/);
    expect(words("delete-history")).toMatch(/fingerprint recognises you again/);
    expect(words("ad-data")).toMatch(/changes which ads you see/);
    expect(words("ad-data")).toMatch(/isn't called back/);
  });

  it("an ad blocker helps but doesn't hide you; Do Not Track adds to the fingerprint", () => {
    expect(words("ad-blocker")).toMatch(/doesn't stop the website you are on/);
    expect(words("do-not-track")).toMatch(/Most websites ignore it/);
    expect(words("do-not-track")).toMatch(/fingerprint/);
  });

  it("the take-away says deleting here deletes nothing there", () => {
    expect(TUNNELS_IN_ONE).toMatch(/nothing you delete on this computer deletes what websites already know/);
  });
});
