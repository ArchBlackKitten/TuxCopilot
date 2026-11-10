// A plain report for a helper. When you ask for help on a
// forum or from a friend, they first ask how your computer stands; this says it in one plain file,
// from what Fluff already reads: the system and its kernels, the updates, what Fluff's checkup sees,
// and every Security protection with its level. It says how things are, never a secret: no
// passwords, keys or settings files' contents, no journal lines (they can name you and your files),
// and — cleaned from the whole text, whatever a reading carried — no user name, home folder,
// computer name, network address or hardware address. Nothing is sent: you read it first, then
// save it or copy it, and choose who gets it.

import { inv } from "./host";
import type { SystemProfile } from "./system-profile";
import type { BootFacts } from "./boot";
import { LOADER_NAMES } from "./boot";
import type { Checkup } from "./checkup";
import type { Service } from "./services";
import { knownFailure } from "./known-failures";
import type { UpdatesFacts } from "./updates";
import type { GlanceRow } from "./glance";
import type { Level } from "./levels";
import { levelLabel } from "./levels";
import { AREA_NAMES, type SecurityArea } from "./level-chosen";

export interface ReportNames {
  user: string;
  home: string;
  host: string;
}
export const reportNames = () => inv<ReportNames>("report_names"); // report.rs

/** Each reading: undefined is never given (the report waits for all); null when Fluff couldn't read it. */
export interface ReportInput {
  profile: SystemProfile | null;
  boot: BootFacts | null;
  updates: UpdatesFacts | null;
  checkup: Checkup | null;
  services: Service[] | null;
  glance: GlanceRow[];
  levels: Partial<Record<SecurityArea, Level | null>>;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every name and address out of a text: what a reading carried is never trusted to be clean. */
export function scrub(text: string, n: ReportNames): string {
  let t = text;
  if (n.home.length > 1) t = t.replace(new RegExp(`${escape(n.home)}(?![\\w.-])`, "g"), "~");
  if (n.user) t = t.replace(new RegExp(`(?<![\\w.-])${escape(n.user)}(?![\\w-])`, "g"), "[you]");
  if (n.host) t = t.replace(new RegExp(`(?<![\\w.-])${escape(n.host)}(?![\\w-])`, "gi"), "[this computer]");
  t = t.replace(/(?<![\w:.-])[0-9a-f]{2}(?::[0-9a-f]{2}){5}(?![\w-]|[.:]\w)/gi, "[a hardware address]");
  // IPv6: two colons or more, and a letter or "::" (a time of day, 13:06:34, has neither)
  t = t.replace(/(?<![\w:.-])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?:%\w+)?(?![\w-]|[.:]\w)/gi, (m) => (/::|[a-f]/i.test(m) ? "[an address]" : m));
  // IPv4: four numbers up to 255 (a version, 1.2.3.4-1 or 1.2.3.4.5, goes on and is left alone; a full stop ends a sentence)
  t = t.replace(/(?<![\w.-])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\/\d{1,2})?(?![\w-]|\.\w)/g, "[an address]");
  return t;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const gb = (b: number) => `${(b / 1e9).toFixed(1)} GB`;
const day = (iso: string) => iso.slice(0, 10);
const couldnt = "Fluff couldn't read it.";

/** The report, as plain text (Markdown: it reads as is, and forums show it neatly). */
export function helperReport(i: ReportInput, names: ReportNames, now = new Date()): string {
  const out: string[] = [];
  const line = (s = "") => out.push(s);
  line(`# How this computer stands — TuxCopilot, ${now.toISOString().slice(0, 10)}`);
  line();
  line("Made by TuxCopilot for whoever helps me. It says how things are, never a secret: no passwords, keys or settings files, no journal lines, no names of people, computers or networks, and no addresses. Nothing was sent: I chose who gets it.");

  line();
  line("## The computer");
  const p = i.profile;
  if (!p) line(`- ${couldnt}`);
  else {
    line(`- System: ${p.osName}${p.desktop ? ` · desktop ${p.desktop}${p.sessionType ? ` (${p.sessionType})` : ""}` : ""}${p.loginScreen ? ` · login screen ${p.loginScreen}` : ""}`);
  }
  const b = i.boot;
  if (!b) line(`- Kernels: ${couldnt}`);
  else {
    line(`- Kernels: ${b.kernels.map((k) => `${k.package} ${k.version}${k.package === b.running ? " (running now)" : ""}`).join(", ") || "none found"}${b.running ? "" : " — the one running isn't among them (updated, not restarted yet)"}`);
    line(`- Start menu: ${LOADER_NAMES[b.loader]}${b.snapshotMenu ? ", which lists snapshots to start from" : ""}${b.snapper ? " · snapper takes snapshots" : " · no snapshots (snapper isn't installed)"}`);
  }
  const c = i.checkup;
  if (c?.disk) line(`- System disk: ${gb(c.disk[0])} free of ${gb(c.disk[1])}`);

  line();
  line("## Updates");
  const u = i.updates;
  if (!u) line(`- ${couldnt}`);
  else {
    line(`- Last full update: ${u.lastUpgrade ? day(u.lastUpgrade) : "none in pacman's log"}`);
    line(`- Waiting: ${u.repo ? plural(u.repo.length, "update") : "couldn't check the repos"} from the repos${u.aur ? `, ${plural(u.aur.length, "update")} from the AUR` : ""}`);
  }
  if (c) line(`- Settings files waiting after updates: ${c.waiting.length ? c.waiting.map((w) => w.path).join(", ") : "none"}`);

  line();
  line("## What Fluff's checkup sees");
  if (!c) line(`- ${couldnt}`);
  else {
    const failed = (i.services ?? []).filter((s) => s.state === "failed");
    if (!i.services) line("- Services: Fluff couldn't read them.");
    else if (!failed.length) line("- No service failed.");
    else for (const s of failed) line(`- Failed: ${s.name}${s.user ? " (yours)" : ""}${s.result ? ` — ${s.result}` : ""}${knownFailure(s)?.harmless ? " (Fluff knows it: harmless)" : ""}`);
    line(`- Errors since this start: ${c.errors.length ? `${plural(c.errors.length, "line")} in the journal (not copied here: they can name me and my files — I can share them if you need them)` : "none"}`);
    if (c.lockLeft) line("- pacman's lock was left behind (no pacman is running), so installs and updates can't run.");
    if (c.pacmanRunning) line("- pacman is running now.");
  }

  line();
  line("## Security");
  line(`- Levels: ${(Object.keys(AREA_NAMES) as SecurityArea[]).map((a) => `${AREA_NAMES[a]} ${i.levels[a] === undefined || i.levels[a] === null ? "(a mix of my own)" : levelLabel(i.levels[a]!)}`).join(" · ")}`);
  const mark = { good: "fine", look: "Fluff would change it", yours: "my choice", unknown: "not known" } as const;
  for (const r of i.glance) line(`- ${r.name}: ${r.now} [${mark[r.level]}]${r.fluff ? ` Fluff recommends: ${r.fluff}` : ""}`);

  return scrub(out.join("\n") + "\n", names);
}
