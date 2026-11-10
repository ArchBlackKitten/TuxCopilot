// Safe updates: the Arch news read from its feed (and what asks for work by hand), the news since
// the last full update, what stands out about an AUR package, and the steps Fluff checks.
import { describe, expect, it } from "vitest";
import { aurLook, logTime, newsSince, parseNews, steps, type AurInfo, type UpdatesFacts } from "@/lib/updates";

const FEED = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>Arch Linux: Recent news updates</title>
<item><title>Update to php ≥ 8.5.12 to prevent remote code execution</title><link>https://archlinux.org/news/update-to-php/</link><description>&lt;p&gt;PHP versions prior to 8.5.12 are affected by &lt;a href="https://www.cve.org/x"&gt;CVE-2026-1&lt;/a&gt;.&lt;/p&gt;
&lt;p&gt;We urge users to upgrade.&lt;/p&gt;</description><pubDate>Wed, 21 Oct 2026 19:29:36 +0000</pubDate></item>
<item><title>linux-firmware &amp;gt;= 20250613 upgrade requires manual intervention</title><link>https://archlinux.org/news/linux-firmware/</link><description>&lt;p&gt;Remove it first: &lt;code&gt;pacman -Rdd linux-firmware&lt;/code&gt;&lt;/p&gt;</description><pubDate>Fri, 20 Jun 2025 10:00:00 +0000</pubDate></item>
<item><title>Old news</title><link>https://archlinux.org/news/old/</link><description>x</description><pubDate>Mon, 01 Jan 2024 00:00:00 +0000</pubDate></item>
</channel></rss>`;

const facts: UpdatesFacts = {
  repo: [{ name: "linux", from: "6.1-1", to: "6.2-1" }], repoError: null, aur: [{ name: "brave-bin", from: "1", to: "2" }],
  lastUpgrade: "2026-10-24T13:06:34+0000", btrfs: true, snapperRoot: true, snapPac: true, limineSnapper: true,
  mirrorlistDays: 3, reflector: true, reflectorTimer: true,
};
const info = (o: Partial<AurInfo>): AurInfo => ({ Name: "x", Maintainer: "someone", NumVotes: 120, Popularity: 2, OutOfDate: null, FirstSubmitted: 1_600_000_000, LastModified: 1_790_000_000, ...o });
const NOW = Date.parse("2026-10-28T12:00:00Z") / 1000;

describe("safe updates", () => {
  it("reads the news feed: plain text, newest first, and what asks for work by hand", () => {
    const n = parseNews(FEED);
    expect(n.map((x) => x.title)).toEqual(["Update to php ≥ 8.5.12 to prevent remote code execution", "linux-firmware >= 20250613 upgrade requires manual intervention", "Old news"]);
    expect(n[0].text).toBe("PHP versions prior to 8.5.12 are affected by CVE-2026-1.\nWe urge users to upgrade.");
    expect(n[0].byHand).toBe(false);
    expect(n[1].byHand).toBe(true);
    expect(n[1].text).toBe("Remove it first: pacman -Rdd linux-firmware");
  });

  it("the news since your last full update (pacman's log time has no colon)", () => {
    expect(logTime("2026-10-24T13:06:34+0200")).toBe(Date.parse("2026-10-24T11:06:34Z")); // a non-zero offset, applied
    expect(logTime(null)).toBeNull();
    const n = parseNews(FEED);
    expect(newsSince(n, "2026-10-01T00:00:00+0000").map((x) => x.title)).toEqual(["Update to php ≥ 8.5.12 to prevent remote code execution"]);
    expect(newsSince(n, "2026-10-24T13:06:34+0000")).toEqual([]);
    expect(newsSince(n, null, Date.parse("2026-11-01T00:00:00Z"))).toHaveLength(1);
  });

  it("what stands out about an AUR package, in plain words", () => {
    expect(aurLook("brave-bin", info({}), NOW)).toMatchObject({ level: "ok", why: [] });
    expect(aurLook("x", info({ Maintainer: null }), NOW).level).toBe("careful");
    expect(aurLook("x", info({ FirstSubmitted: NOW - 3 * 86_400 }), NOW).why).toEqual(["new: first put on the AUR 3 days ago"]);
    expect(aurLook("x", info({ OutOfDate: NOW - 10 * 86_400, NumVotes: 1 }), NOW)).toMatchObject({ level: "look", why: ["flagged out of date 10 days ago", "few people use it (1 vote)"] });
    expect(aurLook("gone", undefined, NOW)).toMatchObject({ level: "careful", page: "https://aur.archlinux.org/packages/gone" });
  });

  it("all set: news read, snapshots taken, mirrors fresh, the AUR fine", () => {
    const s = steps(facts, parseNews(FEED), [aurLook("brave-bin", info({}), NOW)]);
    expect(s.map((x) => [x.id, x.level])).toEqual([["news", "ok"], ["snapshot", "ok"], ["mirrors", "ok"], ["aur", "ok"]]);
    expect(s[1].detail).toMatch(/limine-snapper-sync lists them in the boot menu/);
  });

  it("each step says what is missing, with the fix", () => {
    const s = steps(
      { ...facts, lastUpgrade: "2025-06-01T00:00:00+0000", snapperRoot: false, snapPac: false, mirrorlistDays: 90, reflectorTimer: false },
      parseNews(FEED),
      [aurLook("x", info({ Maintainer: null }), NOW)],
    );
    expect(s.find((x) => x.id === "news")?.level).toBe("bad");
    expect(s.find((x) => x.id === "snapshot")?.fix?.command).toBe("sudo pacman -Syu --needed snapper snap-pac && sudo snapper -c root create-config /");
    expect(s.find((x) => x.id === "mirrors")).toMatchObject({ level: "warn", title: "Your mirror list is 90 days old" });
    expect(s.find((x) => x.id === "aur")?.detail).toMatch(/^x — see why below\. .*type A/);
    expect(steps({ ...facts, btrfs: false }, null, []).map((x) => [x.id, x.level])).toEqual([["news", "info"], ["snapshot", "info"], ["mirrors", "ok"], ["aur", "ok"]]);
  });

  it("every install it offers says -Syu", () => {
    const all = JSON.stringify(steps({ ...facts, snapperRoot: false, snapPac: false, reflector: false, mirrorlistDays: 99 }, null, null));
    expect(all).not.toMatch(/pacman -S /);
    expect(all).toContain("sudo pacman -Syu --needed reflector");
  });
});
