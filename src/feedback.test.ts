// Feedback: what you choose to add is said plainly, your home folder and user name never go
// with it, and the link opens GitHub's page filled in — or, too long for a link, the text goes
// by the clipboard. Nothing is sent from here: these only build the text you are shown.
import { describe, expect, it } from "vitest";
import { cleanLog, documentName, ISSUES, issueBody, issueDocument, issueLink, logsSection, OTHER_PLACES, scrub, URL_LIMIT, type FeedbackInput } from "@/lib/feedback";
import { readFileSync } from "node:fs";
import type { OriginalFacts } from "@/lib/original";

const ctx = { home: "/home/penguin", user: "penguin" };
const copy = {
  version: "0.1.0", builtFrom: "git", commit: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", releaseTag: null, isCreators: true, origin: "https://github.com/ArchBlackKitten/TuxCopilot.git",
  changedFiles: ["src/a.ts"], localCommits: 0, package: null,
} as unknown as OriginalFacts;
const none: FeedbackInput = { kind: "bug", title: "x", first: "It froze.", second: "", copy: null, machine: null, kernel: null, failed: null };

describe("feedback", () => {
  it("your home folder and user name are taken out, and nothing else", () => {
    expect(scrub("cd /home/penguin/Projects && ls /home/penguin", ctx)).toBe("cd ~/Projects && ls ~");
    expect(scrub("penguin@arch: owned by penguin. penguinish /home/penguinx", ctx)).toBe("<you>@arch: owned by <you>. penguinish /home/penguinx");
    expect(scrub("nothing here", { home: "", user: "" })).toBe("nothing here");
    expect(scrub("mypenguin and penguin-ish, but penguin.", ctx)).toBe("mypenguin and penguin-ish, but <you>.");
    expect(scrub("a+b /home/a+b/x", { home: "/home/a+b", user: "a+b" })).toBe("<you> ~/x");
  });

  it("only what you ticked is added, said plainly", () => {
    expect(issueBody(none)).toBe("### What happened?\n\nIt froze.\n\n<sub>Written in TuxCopilot's Feedback section.</sub>");
    const all = issueBody({
      ...none,
      second: "To keep going.",
      copy,
      machine: { os: "CachyOS", desktop: "KDE", sessionType: "wayland" },
      kernel: "7.1.5-1-cachyos",
      failed: { id: "1", label: "Install firefox", commands: "sudo pacman -Sy firefox\n", output: Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"), status: "failed", dryRun: false, createdAt: "2026-11-03T10:15:00Z", updatedAt: "" },
    });
    expect(all).toContain("### What did you expect? (and how to make it happen again, if you know)\n\nTo keep going.");
    expect(all).toContain("Install firefox (2026-11-03 10:15)\n\n```\nsudo pacman -Sy firefox\n```");
    expect(all).toContain("line 39");
    expect(all).not.toContain("line 9\n"); // the end only
    expect(all).toContain("- TuxCopilot 0.1.0, built from a git folder, commit a1b2c3d4e5f6\n- changed on this computer\n- CachyOS; desktop: KDE (wayland); kernel 7.1.5-1-cachyos");
    expect(issueBody({ ...none, copy: { ...copy, isCreators: false, origin: "https://github.com/someone/Tux", changedFiles: [] } as OriginalFacts })).toContain("- a fork: https://github.com/someone/Tux");
    expect(issueBody({ ...none, kind: "words" })).toContain("### What did it say, and where?");
  });

  it("the link fills GitHub's page; too long, the text goes by the clipboard", () => {
    const { url, viaClipboard } = issueLink("bug", "Froze on Apply", "It & froze #1");
    expect(viaClipboard).toBe(false);
    const u = new URL(url);
    expect(`${u.origin}${u.pathname}`).toBe(ISSUES);
    expect([u.searchParams.get("title"), u.searchParams.get("body"), u.searchParams.get("labels")]).toEqual(["Froze on Apply", "It & froze #1", "bug"]);
    expect(new URL(issueLink("other", "t", "b").url).searchParams.has("labels")).toBe(false);
    const long = issueLink("idea", "t", "é".repeat(URL_LIMIT));
    expect(long.viaClipboard).toBe(true);
    expect(long.url.length).toBeLessThanOrEqual(URL_LIMIT);
    expect(new URL(long.url).searchParams.get("body")).toMatch(/clipboard/);
  });

  it("the sections you tick head the message, and the document is the title and that message", () => {
    const body = issueBody({ ...none, where: ["Apps", "Ports"] });
    expect(body.startsWith("### Where in TuxCopilot\n\n- Apps\n- Ports\n\n### What happened?\n\nIt froze.")).toBe(true);
    expect(issueBody({ ...none, where: [] })).not.toContain("Where in TuxCopilot");
    expect(issueBody(none)).not.toContain("Where in TuxCopilot");
    expect(issueDocument("  Play froze ", "\n" + body + "\n\n")).toBe(`# Play froze\n\n${body}\n`);
  });

  it("the document's name: the date and the title's first words, nothing a file name can't hold", () => {
    const day = new Date(2026, 10, 3);
    expect(documentName("Play froze on Apply!", day)).toBe("fluff-feedback-2026-11-03-play-froze-on-apply.md");
    expect(documentName("  ~/home/<you> & é a b c d e f g ", day)).toBe("fluff-feedback-2026-11-03-home-you-e-a-b-c.md");
    expect(documentName("", day)).toBe("fluff-feedback-2026-11-03.md");
    expect(documentName("???", new Date(2027, 0, 9))).toBe("fluff-feedback-2027-01-09.md");
  });

  it("every section of the side menu can be ticked (the screen gets them from the menu itself)", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    // the menu is in your order (sections.ts) — the same sections, every one
    expect(app).toContain("const sections = useSections(NAV);");
    expect(app).toMatch(/<FeedbackView sections=\{sections\.filter\(\(n\) => n\.id !== "feedback"\)\.map\(\(n\) => n\.label\)\} \/>/);
    expect(OTHER_PLACES.some((p) => /top bar/.test(p))).toBe(true);
  });
});

// Anonymized logs, for review later
describe("anonymized logs, for review later", () => {
  const names = { user: "kit", home: "/home/kit", host: "kits-laptop" };
  const logs = {
    runs: [
      { label: "Install /home/kit/Downloads/tool.pkg.tar.zst", status: "failed", dryRun: false, createdAt: "2026-11-10T09:00:00.000Z" },
      { label: "Network: Good security", status: "success", dryRun: true, createdAt: "2026-11-09T08:00:00.000Z" },
    ],
    failed: [{ label: "Install /home/kit/Downloads/tool.pkg.tar.zst", output: Array.from({ length: 30 }, (_, i) => `l${i}`).join("\n") + "\nerror: kit can't read /home/kit/Taxes 2026.ods ```" }],
    errors: ["kits-laptop NetworkManager: HomeWifi-5G: DHCP from 192.168.1.1 timed out", "kernel: wlan0 a4:5e:60:d1:22:9b link down"],
    report: "# How this computer stands\n- System: CachyOS Linux",
    names,
    networks: ["HomeWifi-5G", "Ho"],
  };

  it("every line cleaned: names, home files, networks, addresses", () => {
    expect(cleanLog("kit opened /home/kit/Secret.odt on HomeWifi-5G via 10.0.0.2", names, ["HomeWifi-5G"])).toBe("[you] opened ~/[a file] on [a network] via [an address]");
    expect(cleanLog("/etc/pacman.conf and ~/ alone", names, [])).toBe("/etc/pacman.conf and ~/ alone");
    expect(cleanLog("Ho Ho", names, ["Ho"])).toBe("[a network] [a network]"); // two letters: still a name
    expect(cleanLog("H stays", names, ["H"])).toBe("H stays"); // one letter would take letters out of every word
    expect(cleanLog("on HomeWifi-5G", names, ["Home", "HomeWifi-5G"])).toBe("on [a network]"); // the longest first: nothing of it left over
  });

  it("in folded sections: the runs, the failed ones' end, the journal's errors, the report", () => {
    const s = logsSection(logs);
    expect(s.startsWith("### Logs (anonymized, for review later)\n\nNames, addresses, networks and my own files' names are taken out.")).toBe(true);
    expect(s).toContain("<summary>TuxCopilot's last 2 runs</summary>");
    expect(s).toContain("2026-11-10 09:00  failed  Install ~/[a file]");
    expect(s).toContain("2026-11-09 08:00  dry-run  Network: Good security");
    expect(s).toContain("<summary>What a failed run printed (the end): Install ~/[a file]</summary>");
    expect(s).not.toContain("l15\n"); // the last 15 lines only
    expect(s).toContain("l16\n");
    expect(s).toContain("<summary>Errors since this start (the system's journal): 2</summary>");
    expect(s).toContain("<summary>How this computer stands (TuxCopilot's report)</summary>");
    for (const secret of ["kit", "Taxes", "HomeWifi", "192.168", "a4:5e"]) expect(s).not.toContain(secret);
    expect(s.match(/```/g)!.length % 2).toBe(0); // a fence in a log can't break the blocks
  });

  it("only when ticked: off by default, read when ticked, and shown before sending", () => {
    expect(issueBody({ ...none, logs: null })).not.toContain("### Logs");
    expect(issueBody({ ...none, logs })).toContain("### Logs (anonymized, for review later)");
    const v = readFileSync("src/components/arch/feedback-view.tsx", "utf8");
    expect(v).toContain("const [addLogs, setAddLogs] = useState(false);");
    expect(v).toContain("logs: addLogs && logs && logs !== \"reading\" ? logs : null,");
    expect(v).toContain("if (!addLogs || logs) return;"); // nothing is read until you tick it
    expect(v).toMatch(/reportNames\(\),\s+listRuns\(\)/); // no names to take out: no logs at all (it fails)
  });
});
