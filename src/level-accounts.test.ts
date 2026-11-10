// Security → Accounts & login as levels (Good security, Secured, Hardened, As it comes first —
// KDE's own defaults, from its kscreenlockersettings.kcfg).
import { describe, expect, it } from "vitest";
import { accountsCards, accountsCommand, accountsLevel, JOURNAL_ARCH, PARTS, rootGroups, type AccountsNow } from "@/lib/level-accounts";
import { lidOpen, lidSleepCommand, lockSetCommand, type ScreenLock } from "@/lib/screenlock";
import { groupCommand, type Group } from "@/lib/groups";
import { JOURNAL_KEEP, keepJournalCommand } from "@/lib/logins";

const kde: ScreenLock = { autolock: true, timeoutMin: 5, lockOnResume: true, graceS: 5, laptop: true, lid: [["AC", 1], ["Battery", 1], ["LowBattery", 1]], autologin: null };
const g = (name: string, o: Partial<Group> = {}): Group => ({ name, gid: 1, listed: true, thisLogin: true, primary: false, others: 0, ...o });
const mine = [g("penguin", { primary: true }), g("wheel"), g("docker"), g("libvirt")];
const at = (screen: Partial<ScreenLock>, kept: boolean, groups = mine): AccountsNow => ({ screen: { ...kde, ...screen }, journal: { kept }, groups });

const arch = at({}, false);
const good = at({ graceS: 0 }, false);
const secured = at({ timeoutMin: 2, graceS: 0 }, true);
const hardened = at({ timeoutMin: 1, graceS: 0 }, true, [g("penguin", { primary: true }), g("wheel"), g("docker", { listed: false, thisLogin: true })]);

describe("Accounts & login: As it comes · Good security · Secured · Hardened", () => {
  it("As it comes is KDE's own: 5 minutes, after sleep, 5 seconds without a password", () => {
    expect(PARTS.arch.lock).toBe("5:5");
    expect(accountsLevel(arch)).toBe("arch");
  });

  it("says the level it is at", () => {
    expect([arch, good, secured, hardened].map(accountsLevel)).toEqual(["arch", "good", "secured", "hardened"]);
    expect(accountsLevel(at({ graceS: 0, lockOnResume: false }, false))).toBeNull(); // wakes unlocked: no level
    expect(accountsLevel(at({ graceS: 0, lid: [["AC", 0]] }, false))).toBeNull(); // the lid does nothing: stays unlocked
    expect(accountsLevel(at({ graceS: 0, laptop: false, lid: [["AC", 0]] }, false))).toBe("good"); // no lid to close
    expect(accountsLevel(at({ graceS: 0 }, true))).toBeNull(); // a month kept, locks at 5: between levels
    // below Hardened, your groups aren't looked at: docker is your own choice there
    expect(accountsLevel(secured)).toBe("secured");
    expect(accountsLevel({ ...hardened, groups: mine })).toBeNull();
  });

  it("only the groups that give root, that you are in, and that you can leave", () => {
    expect(rootGroups(mine).map((x) => x.name)).toEqual(["docker", "libvirt"]);
    expect(rootGroups([g("penguin", { primary: true }), g("wheel"), g("disk", { listed: false })])).toEqual([]);
    expect(rootGroups([g("root", { primary: true })])).toEqual([]); // your own group, even a root-giving one: never left
  });

  it("runs only what differs", () => {
    expect(accountsCommand("good", arch)).toBe(lockSetCommand({ timeout: 5, grace: 0 }, kde));
    expect(lockSetCommand({ timeout: 5, grace: 0 }, kde)).toBe(
      'kwriteconfig6 --file kscreenlockerrc --group Daemon --key LockGrace 0 && { r=$(kreadconfig6 --file kscreenlockerrc --group Daemon --key LockGrace); [ "$r" = 0 ] || { echo "Fluff: LockGrace says \\"$r\\", not 0." >&2; false; }; } && { qdbus6 org.freedesktop.ScreenSaver /ScreenSaver configure >/dev/null || echo "Fluff: the screen locker didn\'t answer — the new settings count from your next login."; }',
    );
    expect(accountsCommand("secured", good)).toBe([lockSetCommand({ timeout: 2, grace: 0 }, good.screen), keepJournalCommand()].join(" && "));
    expect(accountsCommand("hardened", secured)).toBe([lockSetCommand({ timeout: 1, grace: 0 }, secured.screen), groupCommand(mine[2], false), groupCommand(mine[3], false)].join(" && "));
    expect(accountsCommand("arch", hardened)).toBe([lockSetCommand({ timeout: 5, grace: 5 }, hardened.screen), JOURNAL_ARCH].join(" && "));
    expect(JOURNAL_ARCH).toMatch(new RegExp(`^sudo rm -f ${JOURNAL_KEEP.replace(/[./]/g, "\\$&")} && sudo systemctl restart systemd-journald && \\{ systemctl is-active -q systemd-journald `));
    expect(accountsCommand("good", good)).toBe("");
    // going down never puts you back into a group
    expect(accountsCommand("arch", hardened)).not.toMatch(/gpasswd/);
    // a lid that does nothing goes back to KDE's own (sleep, which locks)
    expect(accountsCommand("good", at({ graceS: 0, lid: [["AC", 1], ["Battery", 0], ["LowBattery", 16]] }, false))).toBe(lidSleepCommand(["Battery", "LowBattery"]));
    expect(lidSleepCommand(["Battery"])).toMatch(/^kwriteconfig6 --file powerdevilrc --group Battery --group SuspendAndShutdown --key LidAction 1 && \{ r=\$\(kreadconfig6 --file powerdevilrc --group Battery --group SuspendAndShutdown --key LidAction\); \[ "\$r" = 1 \] .* && \{ qdbus6 org\.kde\.Solid\.PowerManagement \/org\/kde\/Solid\/PowerManagement reparseConfiguration >\/dev\/null \|\| echo /);
    expect(() => lidSleepCommand(["AC; reboot"])).toThrow(/not a power profile/);
    // lock off, and woken unlocked: both come back
    expect(lockSetCommand({ timeout: 5, grace: 0 }, { ...kde, autolock: false, lockOnResume: false })).toMatch(/--key Autolock true && .*--key LockOnResume true && .*--key LockGrace 0 && /);
  });

  it("the lid is open only where closing it neither sleeps nor locks", () => {
    expect(lidOpen(kde)).toEqual([]);
    expect(lidOpen({ ...kde, lid: [["AC", 64], ["Battery", 32], ["LowBattery", 8]] })).toEqual(["AC"]);
    expect(lidOpen({ ...kde, lid: [] })).toEqual([]); // KDE's own: sleep
    expect(lidOpen({ ...kde, laptop: false, lid: [["AC", 0]] })).toEqual([]);
  });

  it("the cards say what they set and cost; Hardened says what leaving each group means", () => {
    const c = accountsCards(arch);
    expect(c.map((x) => x.id)).toEqual(["arch", "good", "secured", "hardened"]);
    expect(c[0].sets[0]).toBe("the screen locks after 5 minutes, after sleep and when the lid closes");
    expect(c[1].caution).toBeNull();
    expect(c[3].sets[3]).toBe("your groups: out of docker, libvirt (from your next login)");
    expect(c[3].caution).toMatch(/Out of docker: .*Out of libvirt: Virtual machines still work/);
    expect(accountsCards(hardened)[3].sets[3]).toMatch(/nothing to change/);
    expect(accountsCards(at({ laptop: false }, false))[1].sets[0]).toBe("the screen locks after 5 minutes and after sleep");
  });
});

describe("the journal's file", () => {
  it("is the same path where it's written and where its being there is read", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src-tauri/src/logins.rs", "utf8")).toContain(`pub const JOURNAL_KEEP: &str = "${JOURNAL_KEEP}";`);
  });
});
