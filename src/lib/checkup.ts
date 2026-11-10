// Fluff's checkup (Troubleshoot): the whole system at a glance, in plain words — what failed,
// the errors since this boot, the config files an update left waiting, a pacman lock left
// behind, a disk filling up. Each finding says what it means and, when there is one, the
// command that fixes it (it runs like any other: "Are you sure?" first). The checkup only reads.

import { inv } from "./host";
import { q } from "./docker";
import { clearMarkCommand, failureSaid, knownFailure } from "./known-failures";
import type { Service } from "./services";

export interface Waiting {
  path: string; // /etc/pacman.conf.pacnew
  file: string; // /etc/pacman.conf
  kind: "pacnew" | "pacsave";
  owner: string | null;
  fileExists: boolean;
}

export interface Checkup {
  waiting: Waiting[];
  lockLeft: boolean;
  pacmanRunning: boolean;
  boot: string | null;
  errors: string[];
  disk: [number, number] | null; // free, total bytes
}

export const runCheckup = () => inv<Checkup>("checkup");
/** What differs between the file in use and the one waiting (diff -u); refused for secret files. */
export const waitingDiff = (path: string) => inv<string>("waiting_diff", { path });

export const PACMAN_LOCK = "/var/lib/pacman/db.lck";

// ── how the computer started ─────────────────────────────────────────────

const seconds = (t: string): number => {
  let s = 0;
  for (const [, n, u] of t.matchAll(/([\d.]+)(min|ms|s)/g)) s += Number(n) * (u === "min" ? 60 : u === "ms" ? 0.001 : 1);
  return s;
};
export const said = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${s < 10 ? s.toFixed(1) : Math.round(s)} s`);

const PART_WORDS: Record<string, string> = {
  firmware: "the computer's own start (firmware), before Linux",
  loader: "the boot menu (the boot loader)",
  kernel: "Linux itself starting",
  initrd: "the early start (initramfs) — this includes the time you take to type a disk-encryption password, if you have one",
  userspace: "starting the services and your desktop",
};

/** systemd-analyze's line → how long it took, and which part took longest. */
export function bootSaid(line: string | null): { total: number; longest: { part: string; seconds: number; words: string } | null } | null {
  if (!line) return null;
  const m = line.match(/Startup finished in (.*?)= ([^\n]+)$/);
  if (!m) return null;
  const parts = [...m[1].matchAll(/([\dminms.]+) \((\w+)\)/g)].map(([, t, part]) => ({ part, seconds: seconds(t) }));
  const longest = parts.sort((a, b) => b.seconds - a.seconds)[0];
  return { total: seconds(m[2]), longest: longest ? { ...longest, words: PART_WORDS[longest.part] ?? longest.part } : null };
}

// ── the errors since this boot ───────────────────────────────────────────

export interface ErrorGroup {
  program: string;
  count: number;
  last: string;
}

/** The journal's error lines, by the program that logged them, most first. */
export function errorGroups(lines: string[]): ErrorGroup[] {
  const by = new Map<string, ErrorGroup>();
  for (const l of lines) {
    const m = l.match(/^\S+ \S+ ([^\s:[]+)(?:\[\d+\])?: (.*)$/);
    if (!m) continue;
    const g = by.get(m[1]) ?? { program: m[1], count: 0, last: "" };
    g.count++;
    g.last = m[2];
    by.set(m[1], g);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.program.localeCompare(b.program));
}

// ── config files an update left waiting ──────────────────────────────────

export type Pick = "keep" | "new" | "merge";
// [the file, what it is and what Fluff recommends, the button Fluff recommends (null: compare first)]
const ADVICE: Array<[RegExp, string, Pick | null]> = [
  [/\/pacman\.conf$/, "pacman's own settings. Yours likely has your changes (Color, ParallelDownloads, [multilib] or your distribution's repositories) — compare, and copy anything new from the waiting one into yours by hand (often a new option such as CheckSpace). Fluff recommends not replacing this one blindly: keep yours, and add the new options by hand.", "keep"],
  [/^\/etc\/pacman\.d\/mirrorlist$/, "Arch's list of download servers. If you made yours with reflector or rate-mirrors (or the installer did), keep yours: the waiting one is the full list with every server switched off (each line starts with #).", "keep"],
  [/mirrorlist$/, "another list of download servers, from your distribution's own repositories. If a tool ranks yours (reflector, rate-mirrors, cachyos-rate-mirrors), keep yours; if not, the new one has the current servers.", "keep"],
  [/\/locale\.gen$/, "the list of languages your system can use. Yours has the ones you switched on at install; keep yours unless the waiting one has a language you need.", "keep"],
  [/\/resolv\.conf$/, "where your computer asks for website addresses (DNS). NetworkManager or systemd-resolved usually writes yours, so keep yours.", "keep"],
  [/\/(passwd|group|shadow|gshadow)$/, "the list of users and groups. Keep yours: the waiting one would lose your user.", "keep"],
  [/\/fstab$/, "which disks are mounted at start. Keep yours: the waiting one doesn't know your disks.", "keep"],
  [/\/mkinitcpio\.conf$/, "how the early start (initramfs) is built. Compare: your HOOKS line (encryption, keyboard) must stay; after changing it, rebuild with sudo mkinitcpio -P.", null],
  [/^\/etc\/bluetooth\/main\.conf$/, "Bluetooth's settings. A new version mostly adds options that are switched off (each starts with #). If you changed one — AutoEnable=false keeps Bluetooth off when the computer starts — keep yours; Merge keeps it and takes the new ones, when it can.", "keep"],
  [/^\/etc\/limine-snapper-sync\.conf$/, "how your snapshots appear in the boot menu (limine-snapper-sync). If you changed nothing that is switched on, use the new one: it brings the current options (for example, leaving Windows out of the snapshot entries).", "new"],
  [/^\/etc\/tpm2-tss\/fapi-profiles\/[^/]+\.json$/, "a profile for the TPM chip's FAPI tools, in the package's newer format. Nobody edits these by hand: use the new one. (TuxCopilot's lock uses the chip through systemd, not through these.)", "new"],
];

/** The button Fluff recommends for this one (null: compare first; a .pacsave has its own one button). */
export function waitingPick(w: Waiting): Pick | null {
  if (w.kind === "pacsave") return null;
  return ADVICE.find(([re]) => re.test(w.file))?.[2] ?? null;
}

/** What this waiting file is, and what Fluff recommends, in plain words. */
export function waitingAdvice(w: Waiting): string {
  if (w.kind === "pacsave")
    return w.fileExists
      ? "your old settings, kept when the package replaced the file. If everything works, the old copy can go."
      : "your old settings, kept when the package was removed. If you won't install it again, the old copy can go.";
  const known = ADVICE.find(([re]) => re.test(w.file));
  return (
    (known ? known[1] : "a new version of a settings file. If you never changed yours, use the new one; if you did, compare them and copy your changes into the new one.") +
    " (It waits because the file in use isn't the one the package first put there — you, the installer, or a tool changed it — so pacman didn't overwrite it.)"
  );
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
function checked(w: Waiting): void {
  if (!/^\/etc\/[^\n']+\.(pacnew|pacsave)$/.test(w.path) || w.path.includes("/../") || w.path !== `${w.file}.${w.kind}`) throw new Error(`not a waiting file Fluff knows: ${w.path}`);
}

/** Use the new one: yours is kept beside it first (<file>.before-fluff-<when>). */
export function useNewCommand(w: Waiting, when = stamp()): string {
  checked(w);
  if (w.kind !== "pacnew") throw new Error("only a .pacnew is a new version");
  const keep = `${w.file}.before-fluff-${when}`;
  return `sudo cp -a -- ${q(w.file)} ${q(keep)} && sudo mv -- ${q(w.path)} ${q(w.file)} && echo ${q(`Fluff kept your old one as ${keep}`)}`;
}

// ── Merge: your changes and the new version, together ──

export interface Merge {
  owner: string;
  installed: string;
  basePackage: string | null; // the cached package the base comes from (null: none older in the cache)
  baseVersion: string | null;
  conflicts: number;
  preview: string; // diff -u: yours → merged
  sha256: string;
}
/** Preview only: what the merge would be (checkup.rs waiting_merge). */
export const waitingMerge = (path: string) => inv<Merge>("waiting_merge", { path });

/** What the merge preview means, in plain words. */
export function mergeSaid(m: Merge): string {
  if (!m.basePackage)
    return `Fluff can't merge this one: a merge needs the file as the older ${m.owner} shipped it, and no older ${m.owner} is left in pacman's cache (it was cleaned). Compare them (What changed) and copy what you need by hand. Next time there will be one: Fluff's cache clean keeps the last two versions.`;
  if (m.conflicts)
    return `${m.conflicts} place${m.conflicts === 1 ? "" : "s"} where both you and the package changed the same lines, so Fluff can't choose for you. Compare them (What changed) and copy by hand, or keep yours.`;
  return `Your changes and the new version fit together (from ${m.owner} ${m.baseVersion} to ${m.installed}). Below is how yours would change. Yours is kept beside it first.`;
}

const PKG_FILE = /^\/[^\n']+\.pkg\.tar\.(zst|xz|gz|bz2)$/;
// as root, from root-owned files only: the cached package, yours, the waiting one. It writes only
// if the merge is byte-for-byte what you saw (its sha256), and only without places to choose.
const MERGE_SCRIPT = [
  "set -eu",
  "d=$(mktemp -d)",
  'trap "rm -rf -- \\"\\$d\\"" EXIT',
  'bsdtar -xqOf "$1" "$2" > "$d/base"',
  'diff3 -m "$3" "$d/base" "$4" > "$d/merged" || { echo "Fluff: both changed the same lines, so nothing was written." >&2; exit 1; }',
  'printf "%s  %s\\n" "$6" "$d/merged" | sha256sum -c --quiet - >/dev/null 2>&1 || { echo "Fluff: the files changed since you looked, so nothing was written. Look again." >&2; exit 1; }',
  'cp -a -- "$3" "$3.before-fluff-$5"',
  'cp -- "$d/merged" "$3"',
  'rm -- "$4"',
  'echo "Fluff merged it. Your old one is kept as $3.before-fluff-$5"',
].join("; ");

/** Use the merge: rebuilt as root and checked against the preview; yours kept beside it first. */
export function mergeCommand(w: Waiting, m: Merge, when = stamp()): string {
  checked(w);
  if (w.kind !== "pacnew") throw new Error("only a .pacnew is a new version");
  if (!m.basePackage || !PKG_FILE.test(m.basePackage) || m.basePackage.includes("/../")) throw new Error("no older package to merge from");
  if (m.conflicts) throw new Error("the merge has places to choose");
  if (!/^[0-9a-f]{64}$/.test(m.sha256)) throw new Error("no merge was previewed");
  return `sudo sh -c '${MERGE_SCRIPT}' fluff-merge ${[m.basePackage, w.file.slice(1), w.file, w.path, when, m.sha256].map(q).join(" ")}`;
}

/** Keep yours: the waiting copy goes. */
export function keepMineCommand(w: Waiting): string {
  checked(w);
  return `sudo rm -- ${q(w.path)}`;
}

// ── the findings ─────────────────────────────────────────────────────────

export interface Finding {
  id: string;
  level: "ok" | "info" | "warn" | "bad";
  title: string;
  detail: string;
  fix?: { label: string; command: string };
  look?: { label: string; command: string }; // a command that only reads, to see more
  goto?: "services"; // where to look closer
}

const gb = (b: number) => `${(b / 1e9).toFixed(b < 1e10 ? 1 : 0)} GB`;

/** Everything the checkup found, worst first. `services`: null when they could not be read. */
export function findings(c: Checkup, services: Service[] | null): Finding[] {
  const out: Finding[] = [];
  const failedAll = (services ?? []).filter((s) => s.state === "failed");
  // the ones Fluff knows are harmless, each on its own, with the mark cleared by a button
  const harmless = failedAll.filter((s) => knownFailure(s)?.harmless);
  const failed = failedAll.filter((s) => !harmless.includes(s));
  for (const s of harmless) {
    const k = knownFailure(s)!;
    out.push({
      id: `service:${s.name}`,
      level: "info",
      title: `${k.label} failed — harmless (${s.name})`,
      detail: `${failureSaid(s)} Clearing the mark only tidies the list; if it fails again, Fluff says so again.`,
      fix: { label: "Clear the mark", command: clearMarkCommand(s) },
      ...(k.look ? { look: k.look } : {}),
    });
  }
  if (services === null) out.push({ id: "services", level: "info", title: "Fluff couldn't read the services", detail: "The Services section shows them." });
  else if (failed.length) {
    const one = failed.length === 1 ? failed[0] : null;
    const k = one && knownFailure(one);
    out.push({
      id: "services",
      level: "bad",
      title: one ? `A service failed: ${k ? `${k.label} (${one.name})` : one.name}` : `${failed.length} services failed`,
      detail: `${failed.map((s) => (failed.length === 1 ? failureSaid(s) : `${s.name} — ${failureSaid(s)}`)).join(" ")} Its log says more (Services → the page button); On tries again, Off if you don't use it.`,
      ...(k?.look ? { look: k.look } : {}),
      goto: "services",
    });
  } else
    out.push({
      id: "services",
      level: "ok",
      title: harmless.length ? "No other service failed" : "No service failed",
      detail: "Everything systemd started is running or finished well.",
    });

  if (c.lockLeft)
    out.push({
      id: "lock",
      level: "bad",
      title: "pacman thinks it is still running",
      detail: `${PACMAN_LOCK} was left behind (an update was stopped half way, or the computer turned off during one), and no pacman is running now. Until it goes, every install or update says "unable to lock database". After removing it, run a full update: sudo pacman -Syu.`,
      fix: { label: "Remove the lock", command: `sudo rm -- ${q(PACMAN_LOCK)}` },
    });
  else if (c.pacmanRunning) out.push({ id: "lock", level: "info", title: "pacman is running right now", detail: "Fluff waits: an install or update is happening. Check again when it is done." });

  if (c.disk) {
    const [free, total] = c.disk;
    const pct = total ? (free / total) * 100 : 100;
    if (pct < 10 || free < 5e9)
      out.push({
        id: "disk",
        level: pct < 5 || free < 2e9 ? "bad" : "warn",
        title: `The system disk is nearly full: ${gb(free)} free`,
        detail: "Updates need room, and a full disk can stop one half way. The package cache is usually the quickest room: it keeps old versions of everything.",
        fix: { label: "Clean the package cache", command: "sudo paccache -rk2 && sudo paccache -ruk0" },
      });
    else out.push({ id: "disk", level: "ok", title: `The system disk has room: ${gb(free)} free of ${gb(total)}`, detail: "" });
  }

  const pacnew = c.waiting.filter((w) => w.kind === "pacnew").length;
  const pacsave = c.waiting.length - pacnew;
  if (c.waiting.length)
    out.push({
      id: "waiting",
      level: "warn",
      title: `${c.waiting.length} settings file${c.waiting.length === 1 ? "" : "s"} waiting after updates`,
      detail: `${pacnew ? `${pacnew} new version${pacnew === 1 ? "" : "s"} (.pacnew)` : ""}${pacnew && pacsave ? " and " : ""}${pacsave ? `${pacsave} old cop${pacsave === 1 ? "y" : "ies"} (.pacsave)` : ""}. Nothing is broken: your files are still the ones in use. Each one below says what it is.`,
    });
  else out.push({ id: "waiting", level: "ok", title: "No settings file is waiting", detail: "" });

  const groups = errorGroups(c.errors);
  if (groups.length)
    out.push({
      id: "errors",
      level: "info",
      title: `${c.errors.length} error line${c.errors.length === 1 ? "" : "s"} since this boot, from ${groups.length} program${groups.length === 1 ? "" : "s"}`,
      detail: "Most computers log some at every start, and many mean nothing. Look closer if something doesn't work: find the program it is about below.",
    });
  else out.push({ id: "errors", level: "ok", title: "No errors logged since this boot", detail: "" });

  const boot = bootSaid(c.boot);
  if (boot)
    out.push({
      id: "boot",
      level: "info",
      title: `Your computer took ${said(boot.total)} to start`,
      detail: boot.longest ? `The longest part (${said(boot.longest.seconds)}): ${boot.longest.words}.` : "",
    });

  const rank = { bad: 0, warn: 1, info: 2, ok: 3 } as const;
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

/** How Fluff feels about it all (for Home): the worst finding decides. */
export function mood(f: Finding[]): "calm" | "unsure" | "worried" {
  return f.some((x) => x.level === "bad") ? "worried" : f.some((x) => x.level === "warn") ? "unsure" : "calm";
}
