// Security → Accounts & login, as levels (levels.ts): the screen lock, the journal (to see wrong
// passwords), and — only at Hardened — the groups that give root without a password.
//                 locks by itself   password after   journal               groups
//   As it comes   5 min (KDE's)     5 s (KDE's)      as CachyOS keeps it   not changed
//   Good security 5 min             at once          as it comes           not changed
//   Secured       2 min             at once          a month, 500 MB       not changed
//   Hardened      1 min             at once          a month, 500 MB       out of root-giving ones
// Every level locks after sleep, and with the lid (KDE's own: the lid sleeps, and sleep locks).
// KDE's defaults are read from its own kscreenlockersettings.kcfg: Autolock true, Timeout 5,
// LockOnResume true, LockGrace 5. Below Hardened, groups aren't touched: going down never puts
// you back into docker — the groups panel does that, one by one.

import type { Group } from "./groups";
import { groupCommand, neededWhy, wordsFor } from "./groups";
import type { Failures } from "./logins";
import { JOURNAL_KEEP, JOURNALD_READS, keepJournalCommand } from "./logins";
import type { ScreenLock } from "./screenlock";
import { lidOpen, lidSleepCommand, lockSetCommand } from "./screenlock";
import { levelOf, type Level, type LevelCard } from "./levels";

export interface AccountsNow {
  screen: ScreenLock;
  journal: Pick<Failures, "kept">;
  groups: Group[];
}

type Parts = { lock: string; lid: "locks" | "open"; journal: "as-it-comes" | "month"; rootGroups?: "none" | "some" };

const LOCK: Record<Level, { timeout: number; grace: number }> = {
  arch: { timeout: 5, grace: 5 },
  good: { timeout: 5, grace: 0 },
  secured: { timeout: 2, grace: 0 },
  hardened: { timeout: 1, grace: 0 },
};

export const PARTS: Record<Level, Parts> = {
  arch: { lock: "5:5", lid: "locks", journal: "as-it-comes" },
  good: { lock: "5:0", lid: "locks", journal: "as-it-comes" },
  secured: { lock: "2:0", lid: "locks", journal: "month" },
  hardened: { lock: "1:0", lid: "locks", journal: "month", rootGroups: "none" },
};

/** The groups you're in that give root without a password, and that you can leave. */
export const rootGroups = (gs: Group[]): Group[] => gs.filter((g) => g.listed && wordsFor(g.name).risk === "root" && !neededWhy(g));

const lockPart = (s: ScreenLock) => (s.autolock && s.lockOnResume ? `${s.timeoutMin}:${s.graceS}` : "off");

export const accountsLevel = (n: AccountsNow): Level | null =>
  levelOf(
    { lock: lockPart(n.screen), lid: lidOpen(n.screen).length ? "open" : "locks", journal: n.journal.kept ? "month" : "as-it-comes", rootGroups: rootGroups(n.groups).length ? "some" : "none" },
    PARTS,
  );

const min = (n: number) => `${n} minute${n === 1 ? "" : "s"}`;

export function accountsCards(n: AccountsNow): LevelCard[] {
  const lid = n.screen.laptop ? ", after sleep and when the lid closes" : " and after sleep";
  const out = rootGroups(n.groups);
  return [
    {
      id: "arch",
      what: "As KDE and CachyOS come.",
      sets: [`the screen locks after ${min(5)}${lid}`, "for 5 seconds after it locks, a key opens it again without a password", "the journal: as CachyOS keeps it (50 MB — a few days of wrong passwords)", "your groups: not changed"],
      caution: "Anyone who reaches the keys in the first 5 seconds after it locks is in.",
    },
    {
      id: "good",
      what: "It locks by itself, after sleep and with the lid, and once locked it needs your password at once.",
      sets: [`the screen locks after ${min(5)}${lid}`, "your password at once, once locked", "the journal: as it comes", "your groups: not changed"],
      caution: null,
    },
    {
      id: "secured",
      what: "Good security, locking sooner, and a month of the journal kept, so a wrong password from last week can still be seen.",
      sets: [`the screen locks after ${min(2)}${lid}`, "your password at once", "the journal: a month kept, up to 500 MB of the disk", "your groups: not changed"],
      caution: "It locks after 2 minutes without use: reading without touching anything, it locks.",
    },
    {
      id: "hardened",
      what: "The strictest: it locks after a minute, and no group of yours lets a program act as root without your password.",
      sets: [
        `the screen locks after ${min(1)}${lid}`,
        "your password at once",
        "the journal: a month kept, up to 500 MB",
        out.length ? `your groups: out of ${out.map((g) => g.name).join(", ")} (from your next login)` : "your groups: none gives root without a password — nothing to change",
      ],
      caution: ["It locks after a minute without use.", ...out.map((g) => `Out of ${g.name}: ${wordsFor(g.name).without}`)].join(" "),
    },
  ];
}

/** The journal as CachyOS keeps it: TuxCopilot's file gone, journald restarted, and checked. */
export const JOURNAL_ARCH = `sudo rm -f ${JOURNAL_KEEP} && sudo systemctl restart systemd-journald && ${JOURNALD_READS("SystemMaxUse=500M", false)}`;

/** The command that sets a level from how it is now: only the parts that differ. */
export function accountsCommand(to: Level, n: AccountsNow): string {
  const want = PARTS[to];
  const steps = [lockSetCommand(LOCK[to], n.screen), lidSleepCommand(lidOpen(n.screen))];
  const kept = n.journal.kept;
  if (want.journal === "month" && !kept) steps.push(keepJournalCommand());
  if (want.journal === "as-it-comes" && kept) steps.push(JOURNAL_ARCH);
  if (want.rootGroups === "none") steps.push(...rootGroups(n.groups).map((g) => groupCommand(g, false)));
  return steps.filter(Boolean).join(" && ");
}
