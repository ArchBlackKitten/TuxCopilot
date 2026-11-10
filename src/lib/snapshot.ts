// A snapshot before TuxCopilot changes the system.
// snap-pac already takes a snapper pair around every pacman run. TuxCopilot's own changes to the
// system (anything run with sudo that isn't pacman) get a pair too: one step before, one after,
// shown in "Are you sure?" like every other step. Then `snapper undochange <before>..<after>`
// puts back every file of the system that changed between the two: this change's — and anything
// else that changed a file at the same moment, which "What it changed" lists first. Files only: a
// service it stopped stays stopped (and one it started keeps running) until it is started again.
// Only when snapper has a config for /.
//
// The runner goes on to the next step whatever the last one returned (runner.rs session_script),
// so each step that changes the system checks first that the snapshot before it was taken: if it
// wasn't, nothing is changed. The after step still runs when a change failed half way:
// the pair then holds what was done, so it can be undone.

import { inv } from "./host";

export const snapshotReady = () => inv<boolean>("snapshot_ready"); // snapshot.rs

export const SNAP_BEFORE = "Snapshot before (snapper)";
export const SNAP_AFTER = "Snapshot after (snapper)";
const PRE_FILE = '"$HOME/.local/state/tuxcopilot/snapper-pre"';
// a change that failed writes its code here, so the after step can say the run didn't finish
// (otherwise a failed change would still get its after-snapshot and look like a success)
const FAILED_FILE = '"$HOME/.local/state/tuxcopilot/snapper-failed"';

/** It runs something as root that isn't pacman (snap-pac covers pacman) or snapper itself. */
export function touchesSystem(cmd: string): boolean {
  // the program after sudo and its options (sudo -v and sudo -k alone only ask for, or forget, your password)
  return [...cmd.matchAll(/\bsudo\s+((?:-\S+\s+)*)(\S+)/g)].some(([, , prog]) => !prog.startsWith("-") && !/^(pacman|snapper)$/.test(prog));
}

/** A run's label as its snapshot pair carries it (no quote, tab or new line; 60 letters at most). */
export const snapshotLabel = (label: string) => label.replace(/['\n\r\t\\]/g, "").slice(0, 60);
const description = (label: string) => `TuxCopilot: ${snapshotLabel(label)}`;
// Fluff's own record of its pairs (snapper lists snapshots only to root): number, number, when, label
export const RECORD = '"$HOME/.local/state/tuxcopilot/snapshots.tsv"';

/** Before a change to the system: the snapshot before it was taken (its number written down), or stop. */
export const SNAP_GUARD = `grep -qx '[0-9][0-9]*' ${PRE_FILE} 2>/dev/null || { echo "Fluff: the snapshot before this change wasn't taken, so nothing was changed." >&2; exit 1; }`;

/** The two steps around a change: before writes down its number, after pairs with it and says how to undo. */
export function snapshotSteps(label: string): { before: string; after: string } {
  const d = description(label);
  return {
    before: `mkdir -p "$HOME/.local/state/tuxcopilot" && rm -f ${FAILED_FILE} && sudo snapper -c root create --type pre --cleanup-algorithm number --print-number --description '${d}' > ${PRE_FILE}`,
    after: `n=$(cat ${PRE_FILE}) && case "$n" in ''|*[!0-9]*) echo "Fluff: no snapshot before was written down, so there is nothing to pair." >&2; false;; esac && m=$(sudo snapper -c root create --type post --pre-number "$n" --cleanup-algorithm number --print-number --description '${d}') && rm -f ${PRE_FILE} && l='${d}' && { [ ! -e ${FAILED_FILE} ] || l="$l (not finished)"; } && printf '%s\\t%s\\t%s\\t%s\\n' "$n" "$m" "$(date +%Y-%m-%dT%H:%M:%S)" "$l" >> ${RECORD} && { [ ! -e ${FAILED_FILE} ] || { rm -f ${FAILED_FILE}; echo "Fluff: this change did NOT finish — a step failed (said above). Snapshots $n and $m hold what it did change, so it can be undone."; }; } && echo "Fluff: snapshots $n and $m hold what this run changed in the system's files (and anything else that changed one at the same moment). To see the files: sudo snapper -c root status $n..$m. To undo it: History, Fluff's snapshots — it shows the files first."`,
  };
}

/** A change that, if it fails, writes its code down for the after step (in a subshell: an `exit`
 *  inside the change can't skip the mark), and still fails with that code. */
export const markFailed = (c: string): string => `( ${c} ) || { r=$?; echo "$r" >> ${FAILED_FILE}; exit "$r"; }`;

/** The commands to run: with the snapshot steps around them when they change the system and snapper is ready.
 *  `mustRun`: a way back that runs even if the snapshot can't be taken (the hands check's undo —
 *  you may have no keyboard until it ran), so it gets the pair but not the guard. */
export function withSnapshot(commands: string[], label: string, ready: boolean, mustRun = false): { commands: string[]; labels: (l: string[]) => string[]; offset: number } {
  if (!ready || !commands.some(touchesSystem)) return { commands, labels: (l) => l, offset: 0 };
  const s = snapshotSteps(label);
  // a step that changes the system runs only after a snapshot was taken before it, and if it fails
  // it says so to the after step
  return {
    commands: [s.before, ...commands.map((c) => (!touchesSystem(c) ? c : mustRun ? markFailed(c) : `${SNAP_GUARD}; ${markFailed(c)}`)), s.after],
    labels: (l) => [SNAP_BEFORE, ...l, SNAP_AFTER],
    offset: 1,
  };
}

/** Of the steps that didn't end well, the changes' own (the snapshot steps aren't changes). */
export const changesNotDone = (notDone: number[], offset: number, count: number): number[] =>
  notDone.map((i) => i - offset).filter((i) => i >= 0 && i < count);

// ── "Undo this change" ─────────────

export interface FluffSnapshot {
  pre: number;
  post: number;
  when: string;
  label: string;
}
export const fluffSnapshots = () => inv<FluffSnapshot[]>("fluff_snapshots"); // snapshot.rs

const pair = (s: Pick<FluffSnapshot, "pre" | "post">) => {
  if (!Number.isInteger(s.pre) || !Number.isInteger(s.post) || s.pre < 1 || s.post <= s.pre) throw new Error("not a pair of snapshots Fluff took");
  return `${s.pre} ${s.post}`;
};

// as root: the pair must be snapper's own pre/post pair, described by TuxCopilot — Fluff's record
// is in your folder, so it is checked before anything is undone
// (snapper 0.13's columns: number, pre-number, post-number, description — it has no "type": a
// "before" has no pre-number, an "after" names its "before")
const IS_OURS = `l=$(snapper -c root --csvout --no-headers list --columns number,pre-number,post-number,description); printf "%s\\n" "$l" | grep -Eq "^$1,,[0-9]*,\\"?TuxCopilot:" && printf "%s\\n" "$l" | grep -Eq "^$2,$1,[0-9]*,\\"?TuxCopilot:" || { echo "Fluff: snapshots $1 and $2 are not a TuxCopilot pair (snapper may have cleaned them up), so nothing was done." >&2; exit 1; }`;

/** What the change touched: the files snapper saw change between the two (it only reads). */
export const whatChangedCommand = (s: Pick<FluffSnapshot, "pre" | "post">): string => `sudo sh -c 'set -eu; ${IS_OURS}; snapper -c root status "$1..$2"' fluff-snapshot ${pair(s)}`;

// After the files are back, what reads them is told to read them again — snapper puts back files,
// not what runs (a snapshot holds files, not, say, the firewall's live state). Each one only when a file of its own changed; one that
// can't is said, and the undo fails out loud (the files are back either way).
const READ_AGAIN: Array<[string, string, string]> = [
  ["/etc/firewalld/", "! systemctl is-active -q firewalld || firewall-cmd --reload >/dev/null", "the firewall"],
  ["/etc/systemd/resolved.conf.d/", "systemctl restart systemd-resolved", "DNS (systemd-resolved)"],
  ["/etc/sysctl.d/", "sysctl --system >/dev/null", "the kernel settings"],
  ["/etc/systemd/journald.conf.d/", "systemctl restart systemd-journald", "the journal"],
  ["/etc/udev/rules.d/", "udevadm control --reload && udevadm trigger --name-match=/dev/uinput", "udev"],
  ["/etc/systemd/system/", "systemctl daemon-reload", "systemd"],
];
// (inside the root part's '…': no quote of its own)
const readAgain = READ_AGAIN.map(([dir, cmd, name]) => `case "$c" in *" ${dir}"*) { ${cmd}; } || bad="$bad, ${name}";; esac`).join("; ");
// your session bus is yours (not root's): told after, as you
const BUS_AGAIN = `{ busctl --user call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus ReloadConfig >/dev/null || { echo "Fluff: your session bus didn't read its rules again: they count from your next login." >&2; false; }; }`;

/** Undo it: the files go back to how they were before the change (snapper undochange), then what
 *  reads them reads them again. */
export const undoCommand = (s: Pick<FluffSnapshot, "pre" | "post">): string =>
  `sudo sh -c 'set -eu; ${IS_OURS}; c=$(snapper -c root status "$1..$2"); snapper -c root undochange "$1..$2"; bad=; ${readAgain}; [ -z "$bad" ] || { echo "Fluff: the files are back, but these did not read them again: \${bad#, } — they count from the next restart." >&2; exit 1; }' fluff-undo ${pair(s)} && ${BUS_AGAIN}`;

export const UNDO_WORDS =
  "Undo puts every file of the system that changed between the two snapshots back the way it was (snapper undochange) — this change's, and anything else that changed a file at that same moment, so Fluff lists the files first. Files only: a service it stopped stays stopped, and one it started keeps running, until it is started again (Services) or the computer restarts. Fluff takes a new snapshot pair around the undo too, so the undo can be undone.";

