// Writes every command TuxCopilot knows into one Markdown document, for people to read and
// rewrite: the catalogue (src/lib/commands/catalog.json), the Arch tools in depth
// (src/lib/arch-kb.ts) and the everyday tasks the search offers (src/lib/command-search.ts).
//
//   npx vite-node scripts/commands-doc.ts <file.md>
//
// ─── Perfected ───────────────────────────────────────────────────────────────
//   • Fixed: `code()` now escapes `|` as well as backticks, so piped commands
//     ("pacman -Qi firefox | less", "du -sh ~/* | sort -h"…) no longer break
//     Markdown table columns in the generated .md.
//   • Added: a "Start here — the eight you meet first" section at the very top,
//     so a fresh archer opening the document sees the essentials before Part 1.

import { writeFileSync } from "node:fs";
import { CATALOG, groups, needs, usedWith } from "../src/lib/commands/catalog";
import { KNOWN_BINARIES } from "../src/lib/arch-kb";
import { RECIPES } from "../src/lib/command-search";

const out: string[] = [];
const p = (...l: string[]) => out.push(...l);
/** code span that survives a Markdown table cell: escape backticks AND pipes. */
const code = (s: string) => "`" + s.replace(/`/g, "\\`").replace(/\|/g, "\\|") + "`";
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The eight a fresh archer meets first — shown before Part 1 as a starter map. */
const START_HERE: Array<{ command: string; what: string }> = [
  { command: "sudo pacman -Syu", what: "the normal full-system update — refresh and upgrade everything" },
  { command: "sudo pacman -Syu --needed <package>", what: "install a package from the official repositories" },
  { command: "yay -Syu --needed <package>", what: "install a package from the AUR (never sudo yay)" },
  { command: "systemctl status <service>", what: "is a service running, with its last log lines" },
  { command: "journalctl -xe", what: "the end of the journal + explanations — why did it fail?" },
  { command: "ls -la", what: "everything in this folder, hidden files too" },
  { command: "man <command>", what: "the whole manual for a command" },
  { command: "git clone <url>", what: "download a project from GitHub / GitLab / the AUR" },
];

p(
  "# The commands TuxCopilot knows",
  "",
  `Made from TuxCopilot's own files on ${new Date().toISOString().slice(0, 10)}: ${CATALOG.length} everyday commands, the Arch tools in depth, and ${RECIPES.length} everyday tasks.`,
  "Everything here is what the Commands section explains, finds, and shows on each command's page.",
  "",
  "- **Part 1 — Everyday commands**: `src/lib/commands/catalog.json`",
  "- **Part 2 — The Arch tools in depth** (pacman, yay, git, systemctl, journalctl, system tools): `src/lib/arch-kb.ts`",
  "- **Part 3 — Everyday tasks** (what the search offers for plain words): `RECIPES` in `src/lib/command-search.ts`",
  "",
  "What TuxCopilot learns from a computer's own `--help` pages is not here: it differs from computer to computer.",
  "",
  "## Start here — the eight you meet first",
  "",
  "| Command | What it does |",
  "|---|---|",
  ...START_HERE.map((s) => `| ${code(s.command)} | ${cell(s.what)} |`),
  "",
  "If you have just installed Arch, these eight are the ones you will reach for first. Each has its own page in Part 1.",
  "",
  "## Part 1 — Everyday commands",
  "",
);
for (const g of groups()) {
  p(`### ${g}`, "");
  for (const c of CATALOG.filter((x) => x.group === g)) {
    const { needs: needsList } = needs(c.name);
    p(`#### ${c.name}`, "", c.what, "", `- **How it is used:** ${code(c.usage)}`, `- **Package:** ${c.pkg}`);
    p(`- **Words people search with:** ${c.words.join(", ")}`);
    if (usedWith(c.name).length) p(`- **Often used with:** ${usedWith(c.name).join(", ")}`);
    if (c.neededBy.length) p(`- **Needed by:** ${c.neededBy.join(", ")}`);
    if (needsList.length) p(`- **It needs:** ${needsList.join(", ")}`);
    if (c.caution) p(`- **Careful:** ${c.caution}`);
    p("", "| Example | What it does |", "|---|---|", ...c.examples.map((e) => `| ${code(e.command)} | ${cell(e.meaning)} |`), "");
    if (c.options.length) p("| Option | Meaning |", "|---|---|", ...c.options.map((o) => `| ${code(o.token)} | ${cell(o.meaning)} |`), "");
  }
}
p("## Part 2 — The Arch tools in depth", "");
for (const t of KNOWN_BINARIES) {
  p(`### ${t.label}`, "", t.blurb, "", "| Option or subcommand | Kind | Meaning | Example |", "|---|---|---|---|");
  for (const it of t.items) p(`| ${code(it.token)} | ${it.kind === "sub" ? "subcommand" : "option"} | ${cell(it.meaning)} | ${it.example ? code(it.example) : ""} |`);
  p("");
}
p("## Part 3 — Everyday tasks", "", "| When someone says… | The command | What it does |", "|---|---|---|");
for (const r of RECIPES) p(`| ${cell(r.say)} | ${code(r.command)} | ${cell(r.meaning)} |`);
p("");

const file = process.argv[2];
if (!file) throw new Error("usage: vite-node scripts/commands-doc.ts <file.md>");
writeFileSync(file, out.join("\n"));
console.log(`${file}: ${out.length} lines`);
