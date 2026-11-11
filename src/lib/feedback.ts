// The Feedback section: Fluff hatched not long ago, so it may have bugs and get things wrong —
// and it is open to feedback. What you write becomes a GitHub issue for its creator, shown in
// full before anything leaves: TuxCopilot sends nothing itself. Your browser opens GitHub's
// "new issue" page filled in, and it is sent only when you press Submit there. What you choose
// to add (this copy, this computer, the last thing that failed) has your home folder and user
// name taken out.

import { inv } from "./host";
import type { OriginalFacts } from "./original";
import type { RunLogRow } from "./api";
import { scrub as scrubNames, type ReportNames } from "./report";

export const ISSUES = "https://github.com/ArchBlackKitten/TuxCopilot/issues/new";
/** Past this, the browser or GitHub may cut the link: the text goes by the clipboard instead. */
export const URL_LIMIT = 7000;

export interface FeedbackContext {
  kernel: string;
  home: string;
  user: string;
}
export const feedbackContext = () => inv<FeedbackContext>("feedback_context");

export type Kind = "bug" | "idea" | "words" | "other";
export const KINDS: Array<{ id: Kind; label: string; note: string; label1: string; label2: string; github: string }> = [
  { id: "bug", label: "Something went wrong", note: "a bug: it failed, froze, or did the wrong thing", label1: "What happened?", label2: "What did you expect? (and how to make it happen again, if you know)", github: "bug" },
  { id: "idea", label: "An idea", note: "something TuxCopilot could do, or do better", label1: "Your idea", label2: "What would it help you with?", github: "enhancement" },
  { id: "words", label: "Something said wrong", note: "a message that is wrong, unclear, or not for beginners", label1: "What did it say, and where?", label2: "What should it say?", github: "documentation" },
  { id: "other", label: "Something else", note: "anything you'd like Fluff's creator to know", label1: "What would you like to say?", label2: "Anything to add?", github: "" },
];

export interface Machine {
  os: string;
  desktop: string | null;
  sessionType: string | null;
}

export interface FeedbackInput {
  kind: Kind;
  title: string;
  where?: string[]; // the sections of TuxCopilot it is about, as ticked
  first: string;
  second: string;
  copy: OriginalFacts | null; // added when ticked
  machine: Machine | null;
  kernel: string | null;
  failed: RunLogRow | null;
  logs?: Logs | null; // added when ticked: anonymized (logsCleaned), for review later
}

// ── anonymized logs, for review later ─────────────────────────────────────

export interface Logs {
  runs: Array<Pick<RunLogRow, "label" | "status" | "dryRun" | "createdAt">>; // newest first
  failed: Array<{ label: string; output: string }>; // what the last failed runs printed
  errors: string[]; // the journal's errors since this start
  report: string | null; // the helper's report (report.ts), already cleaned
  names: ReportNames; // what to take out: your user name, home folder, computer name
  networks: string[]; // …and your networks' names
}

/** Everything a log line can carry that is yours: your names and addresses (report.ts), the names of
 *  your networks, and the names of your own files (a path in your home folder keeps only "~/"). */
export function cleanLog(text: string, names: ReportNames, networks: string[]): string {
  // script(1)'s header and footer, kept in runs from before the runner left them out: their date
  // carries this computer's timezone
  let t = scrubNames(text.replace(/^Script (?:started|done) on [^\n]* \[COMMAND[^\n]*(?:\n|$)/gm, ""), names);
  for (const n of [...networks].filter((x) => x.trim().length > 1).sort((a, b) => b.length - a.length)) t = t.replaceAll(n, "[a network]");
  return t.replace(/~\/[^\s'"`)\]]+/g, "~/[a file]");
}

/** The logs, every line cleaned, in folded sections (GitHub shows them closed until clicked). */
export function logsSection(l: Logs): string {
  const c = (s: string) => cleanLog(s, l.names, l.networks).replaceAll("```", "'''"); // a fence inside would end the block
  const fold = (summary: string, body: string) => `<details><summary>${summary}</summary>\n\n\`\`\`\n${body.trim() || "(nothing)"}\n\`\`\`\n\n</details>`;
  const parts = [
    fold(`TuxCopilot's last ${l.runs.length} runs`, l.runs.map((r) => `${r.createdAt.slice(0, 16).replace("T", " ")}  ${r.dryRun ? "dry-run" : r.status}  ${c(r.label)}`).join("\n")),
    ...l.failed.map((f) => fold(`What a failed run printed (the end): ${c(f.label)}`, c(tail(f.output, 15)))),
    fold(`Errors since this start (the system's journal): ${l.errors.length}`, c(l.errors.join("\n"))),
    ...(l.report ? [`<details><summary>How this computer stands (TuxCopilot's report)</summary>\n\n${c(l.report)}\n</details>`] : []),
  ];
  return `### Logs (anonymized, for review later)\n\nNames, addresses, networks and my own files' names are taken out.\n\n${parts.join("\n\n")}`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Your home folder becomes ~ and your user name <you>, wherever they appear. */
export function scrub(text: string, ctx: Pick<FeedbackContext, "home" | "user">): string {
  let t = text;
  if (ctx.home.length > 1) t = t.replace(new RegExp(`${escapeRe(ctx.home.replace(/\/+$/, ""))}(?=/|\\b|$)`, "g"), "~");
  if (ctx.user.length > 1) t = t.replace(new RegExp(`(?<![\\w.-])${escapeRe(ctx.user)}(?![\\w-])`, "g"), "<you>");
  return t;
}

/** The last lines of what a run printed. */
const tail = (s: string, n = 30) => s.split("\n").slice(-n).join("\n").trim();

/** The issue's text, in GitHub's Markdown. */
export function issueBody(i: FeedbackInput): string {
  const k = KINDS.find((x) => x.id === i.kind)!;
  const parts: string[] = [];
  if (i.where?.length) parts.push(`### Where in TuxCopilot\n\n${i.where.map((w) => `- ${w}`).join("\n")}`);
  if (i.first.trim()) parts.push(`### ${k.label1}\n\n${i.first.trim()}`);
  if (i.second.trim()) parts.push(`### ${k.label2}\n\n${i.second.trim()}`);
  if (i.failed) {
    const out = tail(i.failed.output ?? "");
    parts.push(
      `### The last thing that failed\n\n${i.failed.label} (${i.failed.createdAt.slice(0, 16).replace("T", " ")})\n\n\`\`\`\n${i.failed.commands.trim()}\n\`\`\`` +
        (out ? `\n\nWhat it printed (the end):\n\n\`\`\`\n${out}\n\`\`\`` : ""),
    );
  }
  if (i.logs) parts.push(logsSection(i.logs));
  const about: string[] = [];
  if (i.copy) {
    const c = i.copy;
    about.push(
      `- TuxCopilot ${c.version}${c.releaseTag ? ` (release ${c.releaseTag})` : ""}, built from ${c.builtFrom === "git" ? "a git folder" : c.builtFrom === "release" ? "a release" : "somewhere Fluff can't tell"}${c.commit ? `, commit ${c.commit.slice(0, 12)}` : ""}`,
    );
    if (c.isCreators === false) about.push(`- a fork: ${c.origin}`);
    if (c.changedFiles.length || c.localCommits) about.push("- changed on this computer");
    if (c.package) about.push(`- installed with pacman as ${c.package}`);
  }
  if (i.machine) about.push(`- ${i.machine.os}; desktop: ${i.machine.desktop ?? "unknown"}${i.machine.sessionType ? ` (${i.machine.sessionType})` : ""}${i.kernel ? `; kernel ${i.kernel}` : ""}`);
  if (about.length) parts.push(`### About\n\n${about.join("\n")}`);
  parts.push("<sub>Written in TuxCopilot's Feedback section.</sub>");
  return parts.join("\n\n");
}

/** GitHub's new-issue page with it filled in; when too long for a link, the text goes by the clipboard. */
export function issueLink(kind: Kind, title: string, body: string): { url: string; viaClipboard: boolean } {
  const label = KINDS.find((x) => x.id === kind)!.github;
  const q = (b: string) => `${ISSUES}?${new URLSearchParams({ title: title.trim(), body: b, ...(label ? { labels: label } : {}) }).toString()}`;
  const url = q(body);
  return url.length <= URL_LIMIT ? { url, viaClipboard: false } : { url: q("(The text is on my clipboard: paste it here, then delete this line.)"), viaClipboard: true };
}

/** The sections to tick that are not in the side menu. */
export const OTHER_PLACES = ["The top bar (Apply, Undo, Ask Fluff)", "Everywhere, or I'm not sure where"];

/** The document to upload to GitHub: the title, then the message — what the screen shows. */
export const issueDocument = (title: string, body: string) => `# ${title.trim()}\n\n${body.trim()}\n`;

/** Its file name: the date and the title's first words, e.g. fluff-feedback-2026-11-03-play-froze.md */
export function documentName(title: string, today: Date = new Date()): string {
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const words = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 6).join("-");
  return `fluff-feedback-${day}${words ? `-${words}` : ""}.md`;
}
