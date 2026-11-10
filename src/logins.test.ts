// Failed password attempts, said with how far back the journal reaches.
import { describe, expect, it } from "vitest";
import { failuresSaid, JOURNAL_KEEP, keepJournalCommand, type Failure } from "@/lib/logins";
import { tuxPath } from "@/lib/tux-own";

const f = (when: string, place: string, from = ""): Failure => ({ when, place, user: "penguin", from });

describe("wrong passwords, in plain words", () => {
  it("none: said with how far back Fluff could look (this computer: since Oct 31)", () => {
    const s = failuresSaid({ failures: [], since: "2026-10-31 18:22:15" });
    expect(s.level).toBe("ok");
    expect(s.text).toMatch(/^No wrong password since .*31 Oct.* \(as far back as the journal reaches\)\.$/);
    expect(failuresSaid({ failures: [], since: null }).text).toBe("No wrong password.");
  });

  it("by where, most first, with the days", () => {
    const s = failuresSaid({
      failures: [f("2026-11-04T21:04:00+0000", "sudo"), f("2026-11-04T21:05:00+0000", "sudo"), f("2026-11-05T08:00:00+0000", "lock screen")],
      since: "2026-10-31 18:22:15",
    });
    expect(s.level).toBe("info");
    expect(s.text).toMatch(/^3 wrong passwords since .*: 2 for sudo \(a terminal\) \(.*4 Nov\); 1 at the lock screen \(.*5 Nov\)\. If they weren't you, someone used this computer\.$/);
  });

  it("from the network: the worst, with the addresses, and what to do", () => {
    const s = failuresSaid({ failures: [f("2026-11-05T03:00:00+0000", "ssh", "203.0.113.9"), f("2026-11-05T03:01:00+0000", "ssh", "203.0.113.9")], since: null });
    expect(s.level).toBe("bad");
    expect(s.text).toMatch(/2 over SSH, from the network from 203\.0\.113\.9/);
    expect(s.text).toMatch(/switch it off \(Security → Network\)/);
  });

  it("many at once is a warning", () => {
    expect(failuresSaid({ failures: Array.from({ length: 5 }, (_, i) => f(`2026-11-05T0${i}:00:00+0000`, "lock screen")), since: null }).level).toBe("warn");
  });

  it("keeping a month: TuxCopilot's own file, tagged, and the journal restarted to read it", () => {
    const c = keepJournalCommand();
    expect(c).toContain(`sudo tee ${JOURNAL_KEEP}`);
    expect(c).toContain("'SystemMaxUse=500M' 'MaxRetentionSec=1month'");
    expect(c).toMatch(/&& sudo systemctl restart systemd-journald && \{ systemctl is-active -q systemd-journald /); // restarted, then checked it reads it
    expect(tuxPath(JOURNAL_KEEP)).toMatch(/journal kept a month/);
  });
});
