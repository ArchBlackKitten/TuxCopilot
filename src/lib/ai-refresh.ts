// "Ask AI to refresh" (Commands): the prompt you give an AI of your choice, the reading of its
// answer, and the list of what it would add. The rule: a command is only updated where its
// information is missing or its help gained something new, and always when you choose. So the
// answer only ever adds — a gap filled, an option or example the
// catalogue lacks, a command it doesn't have — and what you integrate waits in pending
// changes until Apply. You choose where the prompt goes: a model Ollama runs here, an AI's
// API, or an AI's page in a terminal browser; the prompt is shown before it is sent.

import { CATALOG, commandDoc, validCommand, type CatalogueAdditions, type CommandDoc } from "./commands/catalog";
import { explainCommand } from "./arch-explain";
import { inv } from "./host";
import { machineLine, type Machine } from "./brain";

/** Opens your terminal with a terminal browser (carbonyl, or browsh) on the AI's link. */
export const browseInTerminal = (url: string) => inv<string>("browse_in_terminal", { url });
/** The terminal browser installed (carbonyl, browsh), or null: said before you press Send. */
export const terminalBrowser = () => inv<string | null>("terminal_browser");
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
/** A chat with a model Ollama runs on this computer; its answer. */
export const askOllama = (model: string, messages: ChatMessage[]) => inv<string>("ask_fluff", { model, messages });
/** A chat with an AI's chat API (OpenAI-compatible); its answer. The key is used once, never kept. */
export const askApi = (url: string, key: string, model: string, messages: ChatMessage[]) => inv<string>("ask_api", { url, key, model, messages });
/** The clipboard's text, read once when you ask for it. */
export const clipboardText = () => inv<string>("clipboard_text");

export type AskWith = "ollama" | "api" | "browser";

/** The prompt: the computer, what the catalogue has and lacks, how the section uses it, and the answer's shape. */
export function buildPrompt(machine: Machine | null): string {
  const gaps = CATALOG.map((c) => ({
    name: c.name,
    what: c.what,
    has: { caution: Boolean(c.caution), examples: c.examples.length, options: c.options.map((o) => o.token) },
  }));
  const payload = {
    the_computer: machine ? machineLine(machine) : "unknown (assume plain Arch Linux)",
    intent:
      "Refresh the command knowledge of TuxCopilot, an Arch Linux helper for people who just installed Arch. Fill the template ONLY for commands that (a) lack something in the current catalogue, or (b) have options in their real --help that the catalogue doesn't list yet, and for everyday Arch commands the catalogue doesn't have at all. Never repeat or rewrite what is already there: only fill gaps and add.",
    how_the_section_uses_it:
      "Each command has a page (what it does, how it is used, examples, options, what it is often used with, what needs it, its real --help). The explainer reads a typed command token by token; the search finds commands from plain words, so `words` should be the words a beginner would type.",
    template: {
      refreshed_commands: [
        { name: "<a command the catalogue has>", add_options: [{ token: "--flag", meaning: "what it does" }], add_examples: [{ command: "<example>", meaning: "what it does" }], add_caution: "<one line, only if it has none>", add_words: ["search", "words"] },
      ],
      new_commands: [
        {
          name: "<command>", pkg: "<Arch package>", group: "<an existing group>", what: "<one plain sentence>", usage: "<command> [options] <thing>",
          words: ["search", "words"], examples: [{ command: "<example>", meaning: "what it does" }], options: [{ token: "<flag>", meaning: "what it does" }],
          caution: "<optional one line>", oftenWith: ["<catalogue names>"], neededBy: ["<catalogue names>"],
        },
      ],
    },
    rules: [
      "Answer with the JSON only, in the template's shape.",
      `Everything must be right for this computer's OS (${machine?.os ?? "Arch Linux"}): its package names, repositories and tools. Arch-based systems (CachyOS, EndeavourOS, Manjaro…) add their own repositories and tools — when a command or package exists only there, say so in its "what".`,
      `The desktop matters as much (${machine?.desktop ?? "unknown"}${machine?.sessionType ? `, ${machine.sessionType}` : ""}): Hyprland is not KDE Plasma is not GNOME — each has its own settings, tools and config files (hyprctl and hyprland.conf; kwriteconfig6 and System Settings; gsettings), and Wayland is not X11 (xrandr is X11 only). When a command only fits one desktop or one of them, say so in its "what".`,
      "Only options that really appear in the command's --help or man page. Don't invent.",
      "Every oftenWith / neededBy name must be a catalogue name below, or a command added in the same answer.",
      "Plain English, one sentence per meaning, for someone new to Linux.",
      "Installing is always `sudo pacman -Syu --needed <package>` (or `yay -Syu --needed <package>` for the AUR, never with sudo).",
      "No paths or names from anyone's own computer: this knowledge is kept in the user's TuxCopilot and moves with it to a new computer (Relocate Fluff).",
    ],
    groups: [...new Set(CATALOG.map((c) => c.group))],
    catalogue: gaps,
  };
  return JSON.stringify(payload, null, 2);
}

/** Chat pages take a short message better than a long one (some refuse a long one, or answer
 * only its start), and a short answer is less often cut off: the prompt goes in parts of at most
 * this many characters, each cut only between whole commands. */
export const PART_LIMIT = 1000;

export interface PromptPart {
  title: string; // "Part 2 of 7"
  text: string;
  answer: "ready" | "json"; // the first part is answered with "ready"; the others with JSON
}

const REFRESHED_SHAPE = '{"refreshed_commands":[{"name":"","add_options":[{"token":"","meaning":""}],"add_examples":[{"command":"","meaning":""}],"add_caution":"","add_words":[""]}]}';
const NEW_SHAPE = '{"new_commands":[{"name":"","pkg":"","group":"","what":"","usage":"","words":[""],"examples":[{"command":"","meaning":""}],"options":[{"token":"","meaning":""}],"caution":"","oftenWith":[""],"neededBy":[""]}]}';

/** One line of what a command already has: its options, how many examples, whether it has a caution. */
const hasLine = (c: CommandDoc) =>
  `- ${c.name}: has ${c.options.map((o) => o.token).join(" ") || "no options"}; ${c.examples.length} example${c.examples.length === 1 ? "" : "s"}${c.caution ? "; a caution" : ""}`;

/** Whole pieces, packed into as few groups as fit `room` characters once joined with `sep`. */
function pack(pieces: string[], room: number, sep: string): string[][] {
  const groups: string[][] = [];
  for (const p of pieces) {
    const last = groups[groups.length - 1];
    if (last && [...last, p].join(sep).length <= room) last.push(p);
    else groups.push([p]);
  }
  return groups;
}

/** The prompt in parts: what to do and the computer first, then the catalogue a few commands at a
 * time (each answered on its own), then a question for the commands it lacks. `withNames` sends
 * the catalogue's names (answered "ready") just before that question — for Ollama and an API,
 * which are asked each part on its own; a chat page has seen them in the parts before. */
export function promptParts(machine: Machine | null, { limit = PART_LIMIT, withNames = false } = {}): PromptPart[] {
  const computer = machine ? machineLine(machine) : "plain Arch Linux (nothing more is known)";
  const desktop = machine?.desktop ? ` and its desktop (${machine.desktop}${machine.sessionType ? `, ${machine.sessionType}` : ""})` : "";
  const head = (k: number, n: number) => `Part ${k} of ${n}. `;
  const headRoom = head(99, 99).length;
  // the catalogue, a whole command at a time, in parts that fit the limit with their own words
  const known = "Commands already known:\n";
  const ask = "\nFor these only, answer with JSON only: what is missing, nothing they have.";
  const batches = pack(CATALOG.map(hasLine), limit - headRoom - known.length - ask.length, "\n");
  const listed = "The commands in the list: ";
  const ready = ". Answer only: ready";
  const nameParts = withNames ? pack(CATALOG.map((c) => c.name), limit - headRoom - listed.length - ready.length, ", ") : [];
  const n = 1 + batches.length + nameParts.length + 1;
  const groups = [...new Set(CATALOG.map((c) => c.group))].join(", ");
  const at = (k: number, answer: PromptPart["answer"], text: string): PromptPart => ({ title: `Part ${k} of ${n}`, answer, text: `${head(k, n)}${text}` });
  return [
    at(
      1,
      "ready",
      `You help TuxCopilot, an app for people who just installed Arch Linux, learn commands. The computer: ${computer}. ` +
        `I'll send ${n - 1} more parts; answer each on its own with JSON only (unless it asks for "ready"), shaped like ${REFRESHED_SHAPE}. ` +
        `Rules: only add what is missing — options really in the command's --help or man page, examples, a caution if it has none, words a beginner would search with. Never repeat or rewrite. ` +
        `Plain English, one sentence each. Right for this OS${desktop}: Hyprland is not Plasma is not GNOME; Wayland is not X11. ` +
        `Installing is sudo pacman -Syu --needed <package>, or yay -Syu --needed <package> without sudo. No paths or names from anyone's computer. Now answer only: ready`,
    ),
    ...batches.map((b, i) => at(i + 2, "json", `${known}${b.join("\n")}${ask}`)),
    ...nameParts.map((names, i) => at(batches.length + i + 2, "ready", `${listed}${names.join(", ")}${ready}`)),
    at(
      n,
      "json",
      `Which everyday commands a beginner on this computer needs are missing from the list? Answer with JSON only, at most 5, shaped like ${NEW_SHAPE}. ` +
        `group is one of: ${groups}. oftenWith and neededBy name only commands from the list or ones you add.`,
    ),
  ];
}

/** True when what was copied is the prompt itself (or one of its parts), not the AI's answer. */
export function isPrompt(text: string, parts: PromptPart[]): boolean {
  const t = text.trim();
  return t.length > 0 && parts.some((p) => p.text.trim() === t || (t.length > 80 && p.text.includes(t)));
}

/** JSON as a terminal copies it: lines broken at the window's width, also inside a string. */
function unwrap(json: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (inString && (ch === "\n" || ch === "\r")) {
      // a break inside a string: the terminal's, not the AI's — drop it with the spaces around it
      out = out.replace(/ +$/, "");
      while (json[i + 1] === " " || json[i + 1] === "\n" || json[i + 1] === "\r") i++;
      out += " ";
      continue;
    }
    out += ch;
    if (ch === "\\" && inString) out += json[++i] ?? "";
    else if (ch === '"') inString = !inString;
  }
  return out;
}

/** Every JSON object in the text (fenced or not), whole, outermost only. */
function objects(text: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"' && depth > 0) inString = true;
    else if (ch === "{") {
      if (depth++ === 0) start = i;
    } else if (ch === "}" && depth > 0 && --depth === 0) found.push(text.slice(start, i + 1));
  }
  return found;
}

/** Reads the answers in the box — one per part, in any order, each bare, fenced or with words
 * around it — as one. Says which it couldn't read; the others still count. */
export function readAnswers(text: string): { answer: { refreshed_commands: unknown[]; new_commands: unknown[] }; read: number; unreadable: number } {
  const answer = { refreshed_commands: [] as unknown[], new_commands: [] as unknown[] };
  let read = 0;
  let unreadable = 0;
  for (const o of objects(text)) {
    let a: ReturnType<typeof readAnswer> | null = null;
    for (const t of [o, unwrap(o)])
      try {
        a = readAnswer(t);
        break;
      } catch {
        /* the next way */
      }
    if (!a || (a.refreshed_commands === undefined && a.new_commands === undefined)) {
      unreadable++;
      continue;
    }
    read++;
    answer.refreshed_commands.push(...(a.refreshed_commands ?? []));
    answer.new_commands.push(...(a.new_commands ?? []));
  }
  if (!read) throw new Error(unreadable ? "its JSON is broken (the AI's answer may have been cut off)" : "there is no JSON in it");
  return { answer, read, unreadable };
}

export interface Proposal {
  kind: "option" | "example" | "caution" | "word" | "command";
  command: string;
  label: string;
  detail: string;
  additions: CatalogueAdditions; // this one item, ready to join the others
}

/** Reads the AI's answer: JSON, also when a chat wraps it in ``` fences or adds a line around it. */
export function readAnswer(text: string): { refreshed_commands?: unknown[]; new_commands?: unknown[] } {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const v = JSON.parse(body.trim()) as unknown;
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("the answer is not the template (an object with refreshed_commands / new_commands)");
  const o = v as Record<string, unknown>;
  for (const k of ["refreshed_commands", "new_commands"]) if (o[k] !== undefined && !Array.isArray(o[k])) throw new Error(`${k} should be a list`);
  return o as { refreshed_commands?: unknown[]; new_commands?: unknown[] };
}

const isPair = (x: unknown, a: string, b: string): x is Record<string, string> =>
  typeof x === "object" && x !== null && typeof (x as Record<string, unknown>)[a] === "string" && (x as Record<string, string>)[a].trim() !== "" && typeof (x as Record<string, unknown>)[b] === "string";
const one = (name: string, r: CatalogueAdditions["refreshed"][string]): CatalogueAdditions => ({ refreshed: { [name]: r }, added: [] });

/** What the answer would add, one item each — nothing the catalogue already says. */
export function proposals(answer: { refreshed_commands?: unknown[]; new_commands?: unknown[] }): { items: Proposal[]; refused: string[] } {
  const items: Proposal[] = [];
  const refused: string[] = [];
  const news = (answer.new_commands ?? []).map(validCommand);
  const known = new Set([...CATALOG.map((c) => c.name), ...news.filter((c): c is CommandDoc => c !== null).map((c) => c.name)]);

  (answer.new_commands ?? []).forEach((raw, i) => {
    const c = news[i];
    const name = typeof raw === "object" && raw !== null ? String((raw as Record<string, unknown>).name ?? "?") : "?";
    if (!c) return refused.push(`${name}: a field is missing or the wrong kind`);
    if (commandDoc(c.name)) return refused.push(`${c.name}: already in the catalogue (send it as refreshed_commands)`);
    const bad = [...c.oftenWith, ...c.neededBy].filter((n) => !known.has(n));
    if (bad.length) return refused.push(`${c.name}: names commands nobody knows (${bad.join(", ")})`);
    items.push({ kind: "command", command: c.name, label: `new command: ${c.name}`, detail: c.what, additions: { refreshed: {}, added: [c] } });
  });

  for (const raw of answer.refreshed_commands ?? []) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const name = String(r.name ?? "");
    const doc = commandDoc(name);
    if (!doc) {
      refused.push(`${name || "?"}: not in the catalogue (send it as new_commands)`);
      continue;
    }
    for (const o of Array.isArray(r.add_options) ? r.add_options : [])
      if (isPair(o, "token", "meaning") && !doc.options.some((x) => x.token === o.token))
        items.push({ kind: "option", command: name, label: `${name}: option ${o.token}`, detail: o.meaning, additions: one(name, { options: [{ token: o.token, meaning: o.meaning }] }) });
    for (const e of Array.isArray(r.add_examples) ? r.add_examples : [])
      if (isPair(e, "command", "meaning") && !doc.examples.some((x) => x.command === e.command))
        items.push({ kind: "example", command: name, label: `${name}: example`, detail: `${e.command} — ${e.meaning}`, additions: one(name, { examples: [{ command: e.command, meaning: e.meaning }] }) });
    if (typeof r.add_caution === "string" && r.add_caution.trim() && !doc.caution)
      items.push({ kind: "caution", command: name, label: `${name}: a caution`, detail: r.add_caution, additions: one(name, { caution: r.add_caution }) });
    for (const w of Array.isArray(r.add_words) ? r.add_words : [])
      if (typeof w === "string" && w.trim() && !doc.words.includes(w))
        items.push({ kind: "word", command: name, label: `${name}: search word "${w}"`, detail: `the search finds ${name} when someone types "${w}"`, additions: one(name, { words: [w] }) });
  }
  return { items, refused };
}

// ── what an AI adds is marked dangerous before you integrate it ─────

export interface Risk {
  level: "danger" | "warn";
  command: string; // the example that is
  text: string; // what Fluff's explainer says about it
}

/** Every example this proposal would add. */
export const proposalCommands = (p: Pick<Proposal, "additions">): string[] => [
  ...p.additions.added.flatMap((c) => c.examples.map((e) => e.command)),
  ...Object.values(p.additions.refreshed).flatMap((r) => (r.examples ?? []).map((e) => e.command)),
];

/** The worst thing Fluff's explainer says about any example in it, or null. A dangerous one starts unticked. */
export function proposalRisk(p: Pick<Proposal, "additions">): Risk | null {
  let worst: Risk | null = null;
  for (const command of proposalCommands(p)) {
    for (const w of explainCommand(command).warnings) {
      if (w.level === "danger") return { level: "danger", command, text: w.text };
      if (w.level === "warn" && !worst) worst = { level: "warn", command, text: w.text };
    }
  }
  return worst;
}

/** The items that start unticked: the dangerous ones. */
export const startOff = (items: Array<Pick<Proposal, "additions">>): Set<number> =>
  new Set(items.flatMap((p, i) => (proposalRisk(p)?.level === "danger" ? [i] : [])));

