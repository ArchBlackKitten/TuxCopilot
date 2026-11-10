// Failed password attempts, from the system journal, said with how far
// back the journal reaches — "none" never claims more than Fluff could see.

import { inv } from "./host";

export interface Failure {
  when: string;
  place: string;
  user: string;
  from: string;
}
export interface Failures {
  failures: Failure[];
  since: string | null;
  kept: boolean; // TuxCopilot's file that keeps a month is there (logins.rs JOURNAL_KEEP)
}
export const loginFailures = (days = 30) => inv<Failures>("login_failures", { days }); // logins.rs

export const PLACE_WORDS: Record<string, string> = {
  sudo: "for sudo (a terminal)",
  su: "for su (a terminal)",
  "lock screen": "at the lock screen",
  "login screen": "at the login screen",
  "password window": "in a password window",
  ssh: "over SSH, from the network",
  console: "at a text console",
  other: "somewhere else",
};

const day = (iso: string) => {
  const d = new Date(iso.replace(/([+-]\d\d)(\d\d)$/, "$1:$2").replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
};

/** In plain words: how many, where, and how far back Fluff could look. */
export function failuresSaid(f: Pick<Failures, "failures" | "since">): { level: "ok" | "info" | "warn" | "bad"; text: string } {
  const back = f.since ? ` since ${day(f.since)} (as far back as the journal reaches)` : "";
  if (!f.failures.length) return { level: "ok", text: `No wrong password${back}.` };
  const by = new Map<string, Failure[]>();
  for (const x of f.failures) by.set(x.place, [...(by.get(x.place) ?? []), x]);
  const parts = [...by.entries()].sort((a, b) => b[1].length - a[1].length).map(([place, xs]) => {
    const days = [...new Set(xs.map((x) => day(x.when)))];
    const from = place === "ssh" ? ` from ${[...new Set(xs.map((x) => x.from).filter(Boolean))].slice(0, 3).join(", ")}` : "";
    return `${xs.length} ${PLACE_WORDS[place] ?? place}${from} (${days.slice(0, 3).join(", ")}${days.length > 3 ? ", …" : ""})`;
  });
  const net = by.has("ssh");
  return {
    level: net ? "bad" : f.failures.length >= 5 ? "warn" : "info",
    text: `${f.failures.length} wrong password${f.failures.length === 1 ? "" : "s"}${back}: ${parts.join("; ")}.${net ? " Someone on the network tried to log in: if you don't use SSH, switch it off (Security → Network)." : " If they weren't you, someone used this computer."}`,
  };
}

// The journal on CachyOS keeps 50 MB — a few days. A month, up to 500 MB, so a wrong password from
// last week can still be seen. TuxCopilot's own file, tagged.
export const JOURNAL_KEEP = "/etc/systemd/journald.conf.d/tuxcopilot-keep.conf";
export const keepJournalCommand = (): string =>
  `sudo mkdir -p /etc/systemd/journald.conf.d && printf '%s\\n' '# TuxCopilot: keep a month of the journal, up to 500 MB (Security). Delete this file to undo.' '[Journal]' 'SystemMaxUse=500M' 'MaxRetentionSec=1month' | sudo tee ${JOURNAL_KEEP} >/dev/null && sudo systemctl restart systemd-journald && ${JOURNALD_READS("SystemMaxUse=500M", true)}`;

/** After a restart: journald runs, and TuxCopilot's setting is (or is no longer) the one that counts —
 *  the last of its key in systemd's own view of the config (CachyOS's 00-journal-size.conf says 50M
 *  before it; a file after it would win). */
export const JOURNALD_READS = (line: string, reads: boolean) => {
  const key = line.split("=")[0];
  return `{ systemctl is-active -q systemd-journald || { echo "Fluff: the journal (systemd-journald) isn't running." >&2; false; }; } && { c=$(systemd-analyze cat-config systemd/journald.conf) && last=$(printf '%s\\n' "$c" | grep '^${key}=' | tail -n1) && ${reads ? `[ "$last" = '${line}' ]` : `[ "$last" != '${line}' ]`} || { echo "Fluff: ${reads ? "the journal's size is $last, not TuxCopilot's" : "the journal still keeps TuxCopilot's size"}." >&2; false; }; }`;
};
