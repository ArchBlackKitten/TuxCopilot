// The screen lock, in plain words, each with its fix (KDE's own
// settings, through kwriteconfig6: yours, no password).

import { inv } from "./host";

export interface ScreenLock {
  autolock: boolean;
  timeoutMin: number;
  lockOnResume: boolean;
  graceS: number;
  laptop: boolean;
  lid: Array<[string, number]>;
  autologin: string | null;
}
export const screenLock = () => inv<ScreenLock>("screen_lock"); // screenlock.rs

export const LID_WORDS: Record<number, string> = {
  0: "does nothing",
  1: "puts it to sleep",
  2: "hibernates it",
  4: "puts it to sleep (hybrid)",
  8: "shuts it down",
  16: "asks what to do",
  32: "locks the screen",
  64: "only turns the screen off",
};
const LOCKS_OR_SLEEPS = new Set([1, 2, 4, 8, 32]); // sleeping locks too, when "lock after sleep" is on

export interface LockFinding {
  level: "ok" | "warn";
  text: string;
  fix?: { label: string; command: string };
}

const KL = "kwriteconfig6 --file kscreenlockerrc --group Daemon";
// No error hidden: what is written is read back from KDE's own file —
// what the next lock reads — and a locker or power manager that doesn't answer "read it again now"
// is said, never swallowed (the settings then count from your next login).
const RELOAD = `{ qdbus6 org.freedesktop.ScreenSaver /ScreenSaver configure >/dev/null || echo "Fluff: the screen locker didn't answer — the new settings count from your next login."; }`;
const PD_RELOAD = `{ qdbus6 org.kde.Solid.PowerManagement /org/kde/Solid/PowerManagement reparseConfiguration >/dev/null || echo "Fluff: the power manager didn't answer — the lid counts from your next login."; }`;
/** One of KDE's settings, read back from its file. */
const readBack = (file: string, groups: string[], key: string, want: string | number) =>
  `{ r=$(kreadconfig6 --file ${file} ${groups.map((g) => `--group ${g}`).join(" ")} --key ${key}); [ "$r" = ${want} ] || { echo "Fluff: ${key} says \\"$r\\", not ${want}." >&2; false; }; }`;

export function lockFindings(s: ScreenLock): LockFinding[] {
  const out: LockFinding[] = [];
  out.push(
    s.autolock
      ? s.timeoutMin <= 15
        ? { level: "ok", text: `It locks by itself after ${s.timeoutMin} minute${s.timeoutMin === 1 ? "" : "s"} without use.` }
        : { level: "warn", text: `It locks by itself only after ${s.timeoutMin} minutes: a long time for anyone passing by.`, fix: { label: "After 5 minutes", command: `${KL} --key Timeout 5 && ${RELOAD}` } }
      : { level: "warn", text: "It never locks by itself: walk away, and anyone can use it.", fix: { label: "Lock after 5 minutes", command: `${KL} --key Autolock true && ${KL} --key Timeout 5 && ${RELOAD}` } },
  );
  out.push(
    s.lockOnResume
      ? { level: "ok", text: "It locks when it wakes from sleep." }
      : { level: "warn", text: "It wakes from sleep unlocked.", fix: { label: "Lock after sleep", command: `${KL} --key LockOnResume true && ${RELOAD}` } },
  );
  out.push(
    s.graceS <= 5
      ? { level: "ok", text: s.graceS === 0 ? "Once locked, it needs your password at once." : `Once locked, it needs your password after ${s.graceS} seconds.` }
      : { level: "warn", text: `For ${s.graceS} seconds after it locks, a key opens it again without a password.`, fix: { label: "Password at once", command: `${KL} --key LockGrace 0 && ${RELOAD}` } },
  );
  if (s.laptop) {
    const lid = s.lid.length ? s.lid : [["AC", 1] as [string, number]];
    const open = lid.filter(([, a]) => !LOCKS_OR_SLEEPS.has(a) || (a !== 32 && a !== 8 && !s.lockOnResume));
    out.push(
      open.length
        ? {
            level: "warn",
            text: `Closing the lid ${open.map(([p, a]) => `${LID_WORDS[a] ?? `does action ${a}`} (${p === "AC" ? "plugged in" : p === "Battery" ? "on battery" : "on low battery"})`).join(", ")}: it stays unlocked.`,
            fix: { label: "Lock when the lid closes", command: [...open.map(([p]) => `kwriteconfig6 --file powerdevilrc --group ${p} --group SuspendAndShutdown --key LidAction 32`), PD_RELOAD].join(" && ") },
          }
        : { level: "ok", text: `Closing the lid ${[...new Set(lid.map(([, a]) => LID_WORDS[a] ?? `does action ${a}`))].join(" or ")}.` },
    );
  }
  out.push(
    s.autologin
      ? { level: "warn", text: `The login screen logs in by itself (${s.autologin}): anyone who turns the computer on is you — unless the disk asks its own password first (LUKS). It is switched off in the login screen's own settings.` }
      : { level: "ok", text: "The login screen asks for your password: it never logs in by itself." },
  );
  return out;
}

/** Security → Accounts & login's levels: the lock by itself after `timeout` minutes, after sleep,
 *  and the password after `grace` seconds — only the keys that differ are written. */
export function lockSetCommand(want: { timeout: number; grace: number }, s: ScreenLock): string {
  const keys: Array<[string, string | number]> = [
    ...(s.autolock ? [] : [["Autolock", "true"] as [string, string]]),
    ...(s.timeoutMin === want.timeout ? [] : [["Timeout", want.timeout] as [string, number]]),
    ...(s.lockOnResume ? [] : [["LockOnResume", "true"] as [string, string]]),
    ...(s.graceS === want.grace ? [] : [["LockGrace", want.grace] as [string, number]]),
  ];
  return keys.length ? [...keys.map(([k, v]) => `${KL} --key ${k} ${v}`), ...keys.map(([k, v]) => readBack("kscreenlockerrc", ["Daemon"], k, v)), RELOAD].join(" && ") : "";
}

/** The lid's profiles that leave it unlocked whatever the lock says (nothing, asks, only the screen off). */
export const lidOpen = (s: ScreenLock): string[] => (!s.laptop ? [] : (s.lid.length ? s.lid : [["AC", 1] as [string, number]]).filter(([, a]) => !LOCKS_OR_SLEEPS.has(a)).map(([p]) => p));

const profileRefused = (p: string): never => {
  throw new Error(`not a power profile name: ${p}`);
};

/** Those profiles put back to KDE's own: closing the lid puts it to sleep (which locks, after sleep). */
export const lidSleepCommand = (profiles: string[]): string =>
  profiles.length
    ? [
        ...profiles.map((p) => (/^\w+$/.test(p) ? p : profileRefused(p))).map((p) => `kwriteconfig6 --file powerdevilrc --group ${p} --group SuspendAndShutdown --key LidAction 1`),
        ...profiles.map((p) => readBack("powerdevilrc", [p, "SuspendAndShutdown"], "LidAction", 1)),
        PD_RELOAD,
      ].join(" && ")
    : "";
