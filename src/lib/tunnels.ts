// Fluff dismantles the myths about VPNs, Tor and the web: what a VPN can and can't do, why free
// VPNs aren't as safe as they say, how Tor tunnels and what its exit sees, how the web fingerprints
// you, and what private windows and deleting your history really do. Shown under the Firewall,
// because the biggest myth is that a VPN is Wi-Fi protection: a tunnel protects what you send on its way; it doesn't close this computer to the people on the same
// Wi-Fi — the firewall does. First how each works (a VPN, Tor, a fingerprint), then each myth with
// what's true — the tunnels', then the web's — then which one when.

import type { Network } from "./firewall";

export interface TunnelPart {
  id: string;
  kind: "how" | "myth" | "which";
  about?: "tunnel" | "web"; // a myth's group
  title: string; // for a myth: the myth itself, as people say it
  points: string[]; // for a myth: what's true
}

/** The one thing to take away, always shown. */
export const TUNNELS_IN_ONE =
  "A VPN or Tor protects what you send, on its way. Neither one protects your Wi-Fi, or this computer: the people on the same Wi-Fi can still knock on it, and a bad download is still bad. The firewall above does the knocking part. And nothing you delete on this computer deletes what websites already know.";

export const TUNNEL_PARTS: TunnelPart[] = [
  {
    id: "vpn",
    kind: "how",
    title: "How a VPN works",
    points: [
      "A VPN (virtual private network) is a tunnel to one company's server. Your computer encrypts everything it sends and hands it to that server, which sends it on to the internet as if it came from there.",
      "The network you're on — a café's Wi-Fi, a hotel's, your internet provider — then sees only that you talk to the VPN's server, and how much. Not which websites.",
      "Websites see the VPN server's address instead of yours, so they don't learn your rough location or your internet provider from it.",
    ],
  },
  {
    id: "tor",
    kind: "how",
    title: "How Tor tunnels",
    points: [
      "Tor sends your connection through three relays, run by volunteers and chosen at random: the guard (the first), the middle, and the exit (the last). Your data is wrapped in three layers of encryption, one for each relay, like an onion.",
      "Each relay takes off its own layer and learns only the relay before it and the one after it. The guard sees your address, not where you're going. The exit sees where you're going, not who you are. No single relay knows both.",
      "That is why Tor hides who you are better than a VPN: with a VPN, one company knows both ends. Tor is slower, and some websites refuse it.",
    ],
  },
  {
    id: "fingerprint",
    kind: "how",
    title: "How the web fingerprints you",
    points: [
      "Every website your browser opens can ask it questions: its version, your system, the screen's size, your time zone and language, the fonts installed, how your graphics card draws a hidden picture. Each answer alone is common; together they are often unique to you — a fingerprint.",
      "A fingerprint needs nothing saved on your computer. Deleting cookies, a private window or a VPN doesn't change it: the same browser on the same computer answers the same way.",
      "Every unusual thing makes it more unique — even extensions meant for privacy. Tor Browser answers the same as every other Tor Browser, so its fingerprint says only \"someone using Tor Browser\". Firefox can come close with its privacy.resistFingerprinting setting, at the cost of some websites working a little worse.",
    ],
  },
  {
    id: "wifi",
    kind: "myth",
    about: "tunnel",
    title: "A VPN protects my Wi-Fi.",
    points: [
      "It protects what you send out, inside its tunnel. Most VPNs leave the Wi-Fi itself as it was: the other people on it can still reach this computer directly and try its open doors (ports).",
      "Keeping them out is the firewall's job: on any network that isn't yours, keep it at Out and about.",
      "The Wi-Fi's own password keeps out people who don't have it — not the ones who do. At a café, everyone has it.",
    ],
  },
  {
    id: "anonymous",
    kind: "myth",
    about: "tunnel",
    title: "A VPN makes me anonymous.",
    points: [
      "The VPN company now sees what your internet provider used to see: which sites, when, from which address. You moved your trust; you didn't remove it.",
      "Websites still know you by what you tell them: log in, and the site knows it's you. Cookies and your browser's fingerprint follow you through any VPN.",
    ],
  },
  {
    id: "viruses",
    kind: "myth",
    about: "tunnel",
    title: "With a VPN, I'm safe from viruses and hackers.",
    points: [
      "A VPN doesn't look at what you download. A virus, a fake login page or a bad download comes through the tunnel just the same.",
      "Against those: updates, the firewall, and care with what you install and where you type your passwords.",
    ],
  },
  {
    id: "free",
    kind: "myth",
    about: "tunnel",
    title: "A free VPN is as good as any.",
    points: [
      "Running servers costs money. When a VPN is free, ask what pays for it: often it is what the VPN sees — your browsing sold, ads put in, your data collected. Free VPN apps have been caught doing exactly that, and some carried malware.",
      "Everything you send passes through the VPN's servers. Choosing a VPN is choosing who sees your traffic, not making it unseen.",
    ],
  },
  {
    id: "logs",
    kind: "myth",
    about: "tunnel",
    title: "\"No logs\" means nobody keeps a record.",
    points: [
      "It is a promise you can't check. Some companies that made it were later shown to have kept logs after all. Prefer one whose promise was tested by an independent audit — and remember it is still a promise.",
      "A VPN from your school or work is theirs: they see what goes through it.",
    ],
  },
  {
    id: "always",
    kind: "myth",
    about: "tunnel",
    title: "Once the VPN is on, everything goes through it.",
    points: [
      "If the VPN drops for a moment, your computer goes back to sending straight through the network — unless the VPN has a kill switch that stops everything until the tunnel is back. Turn it on if yours has one.",
      "Some setups even send the name lookups (DNS: which site you're about to visit) around the tunnel. A good VPN app has a setting against it.",
    ],
  },
  {
    id: "readable",
    kind: "myth",
    about: "tunnel",
    title: "Without a VPN, the café can read everything I do.",
    points: [
      "Most websites already use HTTPS (the padlock): the café's Wi-Fi can't read the pages or what you type, only see which sites you visit.",
      "So on such a network, what a VPN adds is hiding which sites — useful, but less than people think.",
    ],
  },
  {
    id: "exit",
    kind: "myth",
    about: "tunnel",
    title: "Tor encrypts everything, all the way.",
    points: [
      "The last relay, the exit, takes off the last layer and hands your data to the website exactly as you sent it. Whatever isn't encrypted by the website itself, the exit holds in the clear — it can read it, and change it.",
      "With HTTPS (the padlock), the exit sees only which site, not what you read or type. With a plain http:// page, it sees everything: never type a password into one over Tor. Most exits are honest volunteers, but bad ones have been caught spying on traffic and changing it.",
      "A .onion address never leaves Tor: there is no exit, and it is encrypted all the way.",
    ],
  },
  {
    id: "tor-anonymous",
    kind: "myth",
    about: "tunnel",
    title: "Tor makes me anonymous, whatever I do.",
    points: [
      "What you tell about yourself still tells: log in, and the site knows it's you.",
      "A program other than Tor Browser can send things that name you, which is why Fluff's Tor section says no setting makes you anonymous by itself. For the web, use Tor Browser.",
    ],
  },
  {
    id: "incognito",
    kind: "myth",
    about: "web",
    title: "Private browsing (incognito) hides what I do.",
    points: [
      "It hides what you do from the next person using this computer: when you close the window, its history, cookies and what you typed into forms are gone from here. That is all.",
      "The websites still see you, and so do your network, your internet provider, your school or work, and your VPN. Your fingerprint is the same, and logging in tells as always. Downloads and bookmarks stay on the computer.",
    ],
  },
  {
    id: "always-incognito",
    kind: "myth",
    about: "web",
    title: "If I always browse in incognito, I can't be tracked.",
    points: [
      "Each private window starts with no cookies, so a site can't simply read yesterday's. But inside the window, tracking works as usual, and your fingerprint and your address link one window to the next.",
      "It doesn't keep viruses, fake pages or bad downloads out either: a private window is the same browser.",
    ],
  },
  {
    id: "delete-history",
    kind: "myth",
    about: "web",
    title: "Deleting my history and cookies erases my tracks.",
    points: [
      "It erases them from this computer. The websites, the ad companies and your internet provider keep their own records, and nothing on your computer reaches those.",
      "An account's own history is apart from the browser's: what you did while logged in to Google, for example, stays in that account until you delete it there.",
      "And your fingerprint recognises you again the next minute — no cookie needed.",
    ],
  },
  {
    id: "ad-data",
    kind: "myth",
    about: "web",
    title: "Clearing my ad data, or turning off personalised ads, stops the tracking.",
    points: [
      "Turning off personalised ads changes which ads you see. What you do can still be collected; only the ads stop being picked for you.",
      "What was already passed on — to ad companies and the data brokers who buy and sell such profiles — isn't called back by any button in your browser or account.",
      "Resetting a phone's advertising ID starts a new one, and your logins and your fingerprint can link it back to the old one.",
    ],
  },
  {
    id: "cookies",
    kind: "myth",
    about: "web",
    title: "Without cookies, websites can't recognise me.",
    points: [
      "Cookies are only one way. Your fingerprint, your address and your logins are others — see \"How the web fingerprints you\" above.",
      "Blocking other websites' cookies (third-party cookies) still helps: it stops the simplest way ad companies follow you from site to site. Most browsers do it now.",
    ],
  },
  {
    id: "logged-out",
    kind: "myth",
    about: "web",
    title: "When I'm not logged in, they don't know it's me.",
    points: [
      "They may not know your name yet, but they can tell it is the same visitor: your fingerprint, your address, a cookie.",
      "Log in once, and everything that visitor did before can be joined to your name.",
    ],
  },
  {
    id: "ad-blocker",
    kind: "myth",
    about: "web",
    title: "An ad blocker makes me invisible.",
    points: [
      "A good one (uBlock Origin, for example) stops many trackers and ads from even loading — worth having. Fluff recommends one.",
      "It doesn't stop the website you are on from seeing you, fingerprinting you or knowing who you are once you log in.",
    ],
  },
  {
    id: "do-not-track",
    kind: "myth",
    about: "web",
    title: "\"Do Not Track\" tells websites not to track me.",
    points: [
      "It asks. Most websites ignore it, and some browsers have dropped it.",
      "Switched on, it is one more detail that sets your browser apart — a little more fingerprint.",
    ],
  },
  {
    id: "which",
    kind: "which",
    title: "Which one, when",
    points: [
      "Any network that isn't yours: the firewall at Out and about, always — with or without a VPN or Tor.",
      "A VPN: when you don't trust the network you're on, or don't want it (or your internet provider) to see which sites you visit. Choose one you pay for, whose promise was audited, with a kill switch.",
      "Tor (Tor Browser): when who you are must not be known. Prefer HTTPS sites, and .onion addresses when a site offers one.",
      "On the web: a browser kept updated, an ad blocker, few other extensions. A private window to keep this computer clean, not to hide. Tor Browser to look like everyone else.",
      "Neither: against viruses and break-ins. That is updates, the firewall, and care with what you install.",
    ],
  },
];

/** The VPN tunnels up now, by name (NetworkManager's kinds: a VPN, WireGuard, or a tun device). */
export const vpnNow = (networks: Network[]): string[] =>
  networks.filter((n) => ["vpn", "wireguard", "tun"].includes(n.kind)).map((n) => n.name || n.device);
