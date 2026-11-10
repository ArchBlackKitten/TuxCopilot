// Your torrc, all of it (Tor section → "Your torrc"). Every option line, the ones in use and
// the ones the file ships switched off ("#SOCKSPort 9050"), becomes a row you can switch on,
// off and edit; the "## " lines above it are its explanation, and for anything the file does
// not explain the installed Tor's own manual does. Lines you don't touch are written back
// byte for byte — an edit changes that one line and nothing else.
//
// What Tor accepts comes from the installed Tor itself (`tor --list-torrc-options`, its man
// page), so it stays right as Tor changes. Saving: Tor checks the new file first (as root, the
// way the service does — the file says `User tor`); if it refuses, nothing is changed. The old
// file is kept as /etc/tor/torrc.bak-<when>. pacman leaves future defaults as torrc.pacnew.

import { execOut, readDir, readText } from "./host";

export const TORRC = "/etc/tor/torrc";

// ── the file ─────────────────────────────────────────────────────────────

export interface OptionRow {
  index: number; // its line in the file
  on: boolean; // false: written as "#Name value"
  name: string;
  value: string;
  note: string | null; // "# …" after the value
  help: string[]; // the "## " lines just above it (after the previous option)
}

export interface Group {
  intro: string[]; // the explanation above the group's first option
  rows: OptionRow[];
}

export interface Section {
  title: string;
  groups: Group[];
}

// in use: any name (Tor ignores case); switched off: "#" right before a capitalised name
const OPTION = /^(?:(#)(%include|[A-Z_][A-Za-z0-9_]*)|(%include|[A-Za-z_][A-Za-z0-9_]*))(?:\s+(.*))?$/;

/** "value # note" → value, note; a # inside quotes is not a comment. */
function splitNote(rest: string): { value: string; note: string | null; noteAt: number } {
  let quoted = false;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === '"' && rest[i - 1] !== "\\") quoted = !quoted;
    if (c === "#" && !quoted) return { value: rest.slice(0, i).trimEnd(), note: rest.slice(i + 1).trim() || null, noteAt: i };
  }
  return { value: rest.trimEnd(), note: null, noteAt: -1 };
}

/** One line as an option, or null for an explanation, a heading or a blank line. */
export function parseLine(raw: string, index = 0): Omit<OptionRow, "help"> | null {
  const line = raw.replace(/\r$/, "");
  if (line.startsWith("##") || /^#\s/.test(line) || line === "#") return null;
  const m = line.trimStart().match(OPTION);
  if (!m) return null;
  const { value, note } = splitNote(m[4] ?? "");
  return { index, on: !m[1], name: m[2] ?? m[3], value, note };
}

const HEADING = /^#{5,}\s*(.*?)\s*#*\s*$/;

/** A heading as the file writes it, said plainly. */
function sectionTitle(h: string): string {
  if (/hidden services/i.test(h)) return "Onion services (hidden services)";
  if (/relays/i.test(h)) return "Running a relay or bridge";
  return h.replace(/^This section is just for\s*/i, "").replace(/^./, (c) => c.toUpperCase());
}

export interface Torrc {
  about: string[]; // the comment block the file opens with
  sections: Section[];
}

/** Split an explanation at its last paragraph break: what the group says, what the line says. */
function splitLast(h: string[]): [string[], string[]] {
  const at = h.lastIndexOf("");
  return at < 0 ? [h, []] : [trimBlank(h.slice(0, at)), trimBlank(h.slice(at + 1))];
}

export function parseTorrc(text: string): Torrc {
  const lines = text.split("\n");
  const sections: Section[] = [{ title: "Using Tor", groups: [] }];
  let about: string[] = [];
  let help: string[] = []; // explanation not yet attached to an option
  let helpFromTop = true; // still in the comment block the file opens with
  let group: Group | null = null;
  const closeGroup = () => {
    if (group?.rows.length) sections[sections.length - 1].groups.push(group);
    group = null;
  };
  lines.forEach((raw, index) => {
    const heading = raw.match(HEADING);
    if (heading) {
      closeGroup();
      help = [];
      helpFromTop = false;
      sections.push({ title: sectionTitle(heading[1]), groups: [] });
      return;
    }
    if (raw.trim() === "") {
      // a paragraph of options ends; an explanation-only paragraph carries on to the next
      if (group?.rows.length) {
        closeGroup();
        help = [];
      }
      if (helpFromTop && help.length) {
        about = trimBlank(help);
        help = [];
      }
      helpFromTop = false;
      return;
    }
    const opt = parseLine(raw, index);
    if (!opt) {
      const h = raw.replace(/^#+\s?/, "").trimEnd();
      if (h) help.push(h);
      else if (help.length) help.push(""); // "##" alone: a paragraph break
      return;
    }
    if (helpFromTop) {
      about = trimBlank(help); // the file's own header, not this line's explanation
      help = [];
      helpFromTop = false;
    }
    if (!group) {
      const [intro, own] = splitLast(trimBlank(help));
      group = { intro, rows: [] };
      help = own;
    }
    group.rows.push({ ...opt, help: trimBlank(help) });
    help = [];
  });
  closeGroup();
  return { about, sections: sections.filter((s) => s.groups.length) };
}

function trimBlank(h: string[]): string[] {
  const out = [...h];
  while (out.length && out[0] === "") out.shift();
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

export const allRows = ({ sections }: Torrc) => sections.flatMap((s) => s.groups.flatMap((g) => g.rows));

// ── edits: each changes one line and returns the whole file ──────────────

function replaceLine(text: string, index: number, line: string | null): string {
  const lines = text.split("\n");
  if (index < 0 || index >= lines.length) throw new Error(`no line ${index + 1}`);
  if (line === null) lines.splice(index, 1);
  else lines[index] = line;
  return lines.join("\n");
}

function lineOf(text: string, index: number): Omit<OptionRow, "help"> {
  const row = parseLine(text.split("\n")[index] ?? "", index);
  if (!row) throw new Error(`line ${index + 1} is not an option`);
  return row;
}

/** Switch an option on (remove its "#") or off (put one in front). */
export function setOn(text: string, index: number, on: boolean): string {
  const raw = text.split("\n")[index];
  const row = lineOf(text, index);
  if (row.on === on) return text;
  return replaceLine(text, index, on ? raw.replace(/^(\s*)#/, "$1") : `#${raw}`);
}

/** A new value for an option; its "#" (if off) and its note stay as they were. */
export function setValue(text: string, index: number, value: string): string {
  const v = value.replace(/[\r\n]+/g, " ").trim();
  const raw = text.split("\n")[index];
  const row = lineOf(text, index);
  const lead = raw.match(/^\s*#?/)![0] + row.name;
  const rest = raw.slice(lead.length);
  const gap = rest.match(/^\s*/)![0] || " ";
  const { noteAt } = splitNote(rest.slice(gap.length));
  const tail = noteAt >= 0 ? rest.slice(gap.length).slice(noteAt) : "";
  const between = tail ? (rest.slice(gap.length, gap.length + noteAt).match(/\s*$/)![0] || " ") : "";
  return replaceLine(text, index, `${lead}${v ? gap + v : ""}${tail ? between + tail : ""}`);
}

export const removeLine = (text: string, index: number) => replaceLine(text, index, null);

/**
 * Add an option you choose: next to the last line of the same option (on or off) so related
 * lines stay together — otherwise at the end, before TuxCopilot's own include line.
 */
export function addOption(text: string, name: string, value: string): { text: string; index: number } {
  const n = name.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) && n !== "%include") throw new Error(`not an option name: ${name}`);
  const line = `${n}${value.trim() ? " " + value.replace(/[\r\n]+/g, " ").trim() : ""}`;
  const lines = text.split("\n");
  let at = -1;
  lines.forEach((l, i) => {
    if (parseLine(l, i)?.name.toLowerCase() === n.toLowerCase()) at = i + 1;
  });
  if (at < 0) {
    at = lines.length;
    while (at > 0 && lines[at - 1] === "") at--; // keep the file's final newline after it
    const inc = lines.findIndex((l) => /^%include\s+\/etc\/tor\/torrc\.d\//.test(l));
    if (inc >= 0 && inc < at) at = inc;
  }
  lines.splice(at, 0, line);
  return { text: lines.join("\n"), index: at };
}

export interface LineChange {
  line: number; // in the new file (for a removed line: where it was)
  was: string | null; // null: added
  now: string | null; // null: removed
}

/** What will change, line by line (a longest-common-lines diff; a changed line is one of each). */
export function changedLines(before: string, after: string): LineChange[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  const keep: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) keep[i][j] = a[i] === b[j] ? keep[i + 1][j + 1] + 1 : Math.max(keep[i + 1][j], keep[i][j + 1]);
  const raw: LineChange[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      i++;
      j++;
    } else if (i < n && (j >= m || keep[i + 1][j] >= keep[i][j + 1])) {
      raw.push({ line: j + 1, was: a[i++], now: null }); // removals first, so a changed line pairs up
    } else {
      raw.push({ line: j + 1, was: null, now: b[j++] });
    }
  }
  // a removal and an addition at the same place is one changed line
  const out: LineChange[] = [];
  for (const c of raw) {
    const prev = out[out.length - 1];
    if (prev && prev.line === c.line && prev.now === null && c.was === null) out[out.length - 1] = { line: c.line, was: prev.was, now: c.now };
    else out.push(c);
  }
  return out;
}

// ── what the installed Tor knows ─────────────────────────────────────────

export interface ManEntry {
  name: string;
  usage: string; // "SocksPort [address:]port|unix:path|auto [flags] [isolation flags]"
  section: string; // "CLIENT OPTIONS"
  text: string[]; // its paragraphs
}

/** `man tor` (unwrapped): options start 5 spaces in, their text 9; headings are capitals. */
export function parseTorMan(out: string): Map<string, ManEntry> {
  const map = new Map<string, ManEntry>();
  let section = "";
  let cur: ManEntry | null = null;
  for (const l of out.split("\n")) {
    if (/^[A-Z][A-Z -]+$/.test(l)) {
      section = l.trim();
      cur = null;
      continue;
    }
    const head = l.match(/^ {5}([A-Za-z_][A-Za-z0-9_]*)(\s.*)?$/);
    if (head && /OPTIONS|AUTHORIZATION/.test(section)) {
      cur = { name: head[1], usage: l.trim(), section, text: [] };
      if (!map.has(head[1].toLowerCase())) map.set(head[1].toLowerCase(), cur);
      continue;
    }
    if (cur && /^ {9}/.test(l)) {
      const t = l.trim();
      const last = cur.text.length - 1;
      // a paragraph per unwrapped line; deeper-indented lists stay as they are
      if (t) cur.text.push(t);
      else if (last >= 0 && cur.text[last] !== "") cur.text.push("");
    } else if (cur && l.trim() && !/^ {9}/.test(l)) {
      cur = null;
    }
  }
  for (const e of map.values()) e.text = trimBlank(e.text);
  return map;
}

/** `tor --list-torrc-options`: every option name, lower-cased (Tor ignores case); internal ones left out. */
export function parseOptionList(out: string): Set<string> {
  return new Set(out.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("__")).map((l) => l.toLowerCase()));
}

/** Why a row would trouble Tor, before Tor itself checks the whole file on save. */
export function rowProblem(row: Pick<OptionRow, "on" | "name" | "value">, known: Set<string> | null): string | null {
  if (!row.on) return null;
  if (row.name === "%include") return row.value ? null : "%include needs a path";
  if (known && known.size && !known.has(row.name.toLowerCase())) return `Tor doesn't know an option called ${row.name}`;
  return null;
}

// ── loading ──────────────────────────────────────────────────────────────

export interface TorrcInfo {
  text: string | null; // null: no torrc (Tor not installed)
  known: Set<string> | null;
  names: string[]; // the same options as Tor writes them, for suggestions
  man: Map<string, ManEntry>;
  backups: string[]; // torrc.bak-<when>, oldest first
  pacnew: boolean; // a newer default from a Tor update waits beside it
}

export const BACKUP = /^torrc\.bak-\d{8}-\d{6}$/;

export async function torrcInfo(): Promise<TorrcInfo> {
  const [text, list, man, dir] = await Promise.all([
    readText(TORRC),
    execOut("tor", ["--list-torrc-options"]),
    execOut("env", ["MANWIDTH=4000", "man", "-P", "cat", "tor"], 10000),
    readDir("/etc/tor").catch(() => [] as string[]),
  ]);
  return {
    text,
    known: list ? parseOptionList(list) : null,
    names: (list ?? "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("__")),
    man: man ? parseTorMan(man) : new Map(),
    backups: dir.filter((f) => BACKUP.test(f)).sort(),
    pacnew: dir.includes("torrc.pacnew"),
  };
}

// ── saving ───────────────────────────────────────────────────────────────

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Tor checks the new file as root first; only then is the old one kept as torrc.bak-<when>
 * and the new one put in place, and a running Tor reloads it. The file travels as base64, so
 * any character in it (an apostrophe in an explanation) is safe.
 */
export function saveTorrcCommand(text: string): string {
  const body = text.endsWith("\n") ? text : text + "\n";
  return [
    `t=$(mktemp) && printf '%s' '${base64(body)}' | base64 -d > "$t";`,
    `if out=$(sudo tor --verify-config -f "$t" 2>&1); then`,
    `sudo cp -p ${TORRC} "${TORRC}.bak-$(date +%Y%m%d-%H%M%S)" && sudo install -m 644 -o root -g root "$t" ${TORRC} && rm -f "$t"`,
    `&& { ! systemctl is-active -q tor.service || sudo systemctl reload-or-restart tor.service; }`,
    `&& echo "Tor took the new torrc. The old one is kept beside it as a backup.";`,
    `else rm -f "$t"; echo "Tor refused this torrc, so nothing was changed. What Tor said:"; printf '%s\\n' "$out" | grep -E '\\[(warn|err)\\]' | sed 's/^.*\\] //'; exit 1; fi`,
  ].join(" ");
}

/** Put a backup back (the current file becomes a backup itself, so this can be undone too). */
export function restoreCommand(backup: string): string {
  if (!BACKUP.test(backup)) throw new Error(`not a torrc backup: ${backup}`);
  return [
    `if out=$(sudo tor --verify-config -f /etc/tor/${backup} 2>&1); then`,
    `sudo cp -p ${TORRC} "${TORRC}.bak-$(date +%Y%m%d-%H%M%S)" && sudo cp /etc/tor/${backup} ${TORRC}`,
    `&& { ! systemctl is-active -q tor.service || sudo systemctl reload-or-restart tor.service; } && echo "The torrc from ${backup.slice(10)} is back.";`,
    `else echo "Tor refuses that backup now:"; printf '%s\\n' "$out" | grep -E '\\[(warn|err)\\]'; exit 1; fi`,
  ].join(" ");
}
