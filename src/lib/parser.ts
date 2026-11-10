// Lenient XML-ish parser for pasted docs.
// Accepts <section>xyz</section>, nested tags like HTML, attributes
// (name, category, source, content, enabled), and bare text lines
// inside a container (each line becomes an item of that container).

import type { Category, ParseResult, ParsedNode, Source } from "./types";

const COMMAND_TAGS = new Set(["command", "cmd", "shell", "sh", "bash"]);
const DOWNLOAD_TAGS = new Set(["pkg", "package", "app", "download", "install"]);
const SOURCE_TAGS: Record<string, Source> = {
  pacman: "pacman",
  paco: "pacman",
  yay: "yay",
  aur: "yay",
  github: "github",
  repo: "github",
  ollama: "ollama",
  llama: "ollama",
  llm: "ollama",
  flatpak: "flatpak",
  flathub: "flatpak",
  snap: "snap",
};

interface RawNode {
  tag: string;
  attrs: Record<string, string>;
  text: string;
  children: RawNode[];
}

type Token =
  | { type: "text"; value: string }
  | { type: "open"; tag: string; attrs: Record<string, string>; self: boolean }
  | { type: "close"; tag: string };

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseAttrs(str: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_][\w:-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str))) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? "");
  }
  return attrs;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let text = "";
  const flush = () => {
    if (text) {
      tokens.push({ type: "text", value: text });
      text = "";
    }
  };
  let i = 0;
  const n = input.length;
  while (i < n) {
    const ch = input[i];
    if (ch === "<") {
      // Comment
      if (input.startsWith("<!--", i)) {
        const end = input.indexOf("-->", i + 4);
        flush();
        i = end === -1 ? n : end + 3;
        continue;
      }
      // Doctype / processing instruction
      if (input.startsWith("<!", i) || input.startsWith("<?", i)) {
        const end = input.indexOf(">", i);
        flush();
        i = end === -1 ? n : end + 1;
        continue;
      }
      // Only treat as a tag when a name or '/' follows (else literal '<')
      const next = input[i + 1];
      if (!next || (!/[a-zA-Z/]/.test(next) && next !== "_")) {
        text += ch;
        i++;
        continue;
      }
      flush();
      // Close tag
      if (next === "/") {
        const end = input.indexOf(">", i);
        const inner = end === -1 ? input.slice(i + 2) : input.slice(i + 2, end);
        tokens.push({ type: "close", tag: inner.trim().toLowerCase() });
        i = end === -1 ? n : end + 1;
        continue;
      }
      // Open tag — scan to '>' respecting quoted attribute values
      let j = i + 1;
      let quote: string | null = null;
      while (j < n) {
        const c = input[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
          quote = c;
        } else if (c === ">") {
          break;
        }
        j++;
      }
      const inner = input.slice(i + 1, j === n ? n : j);
      const self = inner.trimEnd().endsWith("/");
      const body = self ? inner.trimEnd().slice(0, -1) : inner;
      const nameMatch = body.match(/^[a-zA-Z_][\w:-]*/);
      const tag = (nameMatch ? nameMatch[0] : "unknown").toLowerCase();
      const attrs = parseAttrs(body.slice(tag.length));
      tokens.push({ type: "open", tag, attrs, self });
      i = j === n ? n : j + 1;
      continue;
    }
    text += ch;
    i++;
  }
  flush();
  return tokens;
}

function buildTree(tokens: Token[], errors: string[]): RawNode[] {
  const roots: RawNode[] = [];
  const stack: RawNode[] = [];
  let strayText = "";
  for (const tk of tokens) {
    if (tk.type === "text") {
      const top = stack[stack.length - 1];
      if (top) top.text += tk.value;
      else strayText += tk.value;
      continue;
    }
    if (tk.type === "open") {
      const node: RawNode = { tag: tk.tag, attrs: tk.attrs, text: "", children: [] };
      const top = stack[stack.length - 1];
      if (top) top.children.push(node);
      else roots.push(node);
      if (!tk.self) stack.push(node);
      continue;
    }
    // close
    const idx = [...stack].reverse().findIndex((s) => s.tag === tk.tag);
    if (idx === -1) {
      errors.push(`Stray closing tag </${tk.tag}> ignored`);
      continue;
    }
    const popped = stack.splice(stack.length - 1 - idx);
    if (popped.length > 1) {
      errors.push(
        `Unclosed tag${popped.length > 2 ? "s" : ""} <${popped
          .slice(0, -1)
          .map((p) => p.tag)
          .join(", ")}> auto-closed`
      );
    }
  }
  if (stack.length > 0) {
    errors.push(
      `Unclosed tag${stack.length > 1 ? "s" : ""} at end of document: ${stack
        .map((s) => `<${s.tag}>`)
        .join(" ")} (auto-closed)`
    );
  }
  if (strayText.trim() && roots.length > 0) {
    errors.push("Text outside of tags was ignored");
  }
  return roots;
}

const MAX_NODES = 500;
let nodeCount = 0;

function nonEmptyLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function firstLine(s: string): string {
  return nonEmptyLines(s)[0] ?? s.trim();
}

function makeItem(
  content: string,
  category: Category,
  source: Source | null,
  attrs: Record<string, string>
): ParsedNode {
  const trimmed = content.trim();
  return {
    name: attrs.name?.trim() || firstLine(trimmed).slice(0, 120),
    category,
    source: category === "download" ? source : null,
    content: trimmed.slice(0, 8000),
    enabled: attrs.enabled ? !/^(false|0|no|off)$/i.test(attrs.enabled) : true,
    children: [],
  };
}

function finalize(
  raw: RawNode,
  inheritedCategory: Category,
  inheritedSource: Source | null,
  isRoot: boolean,
  errors: string[]
): ParsedNode | null {
  if (nodeCount >= MAX_NODES) {
    errors.push(`Document truncated at ${MAX_NODES} nodes`);
    return null;
  }
  const tag = raw.tag;
  const attrs = raw.attrs;

  const explicitCategory =
    attrs.category === "download" || attrs.category === "command"
      ? (attrs.category as Category)
      : null;
  const explicitSource =
    attrs.source && ["pacman", "yay", "github", "ollama"].includes(attrs.source)
      ? (attrs.source as Source)
      : null;
  const tagSource = SOURCE_TAGS[tag] ?? null;

  const source = explicitSource ?? tagSource ?? inheritedSource;
  let category: Category =
    explicitCategory ??
    (tagSource || DOWNLOAD_TAGS.has(tag)
      ? "download"
      : COMMAND_TAGS.has(tag)
        ? "command"
        : inheritedCategory);

  const children: ParsedNode[] = [];
  for (const child of raw.children) {
    nodeCount++;
    const finalized = finalize(child, category, source, false, errors);
    if (finalized) children.push(finalized);
  }

  const text = raw.text.trim();

  // Item tags: cmd/command/shell and pkg/package/app/download
  if (COMMAND_TAGS.has(tag) || DOWNLOAD_TAGS.has(tag)) {
    const content = attrs.content?.trim() || text;
    if (!content) {
      errors.push(`Empty <${tag}> ignored`);
      return null;
    }
    nodeCount++;
    const item = makeItem(content, category, source, attrs);
    item.children = children; // rare, but keep if present
    return item;
  }

  // Container-ish tags (section/subsection/unknown/source tags)
  const prettyTag = tag.charAt(0).toUpperCase() + tag.slice(1);
  const lines = nonEmptyLines(raw.text).filter((l) => !l.startsWith("#") && !l.startsWith("//"));

  let name = attrs.name?.trim() || "";
  let itemLines = lines;
  if (!name && lines.length > 0) {
    name = lines[0].slice(0, 120);
    itemLines = lines.slice(1);
  }
  if (!name) name = isRoot ? "Imported" : prettyTag;

  // Bare text lines inside a container become items
  for (const line of itemLines) {
    if (nodeCount >= MAX_NODES) break;
    nodeCount++;
    children.push(makeItem(line, category, source, {}));
  }

  if (!attrs.name && !attrs.content && !text && children.length === 0) {
    errors.push(`Empty <${tag}> ignored`);
    return null;
  }

  return {
    name,
    category,
    source: category === "download" ? source : source ?? null,
    content: attrs.content?.trim().slice(0, 8000) ?? null,
    enabled: attrs.enabled ? !/^(false|0|no|off)$/i.test(attrs.enabled) : true,
    children,
  };
}

export function parseDocument(input: string): ParseResult {
  const errors: string[] = [];
  nodeCount = 0;
  const tokens = tokenize(input);
  const rawRoots = buildTree(tokens, errors);

  const roots: ParsedNode[] = [];
  const rootRaw: RawNode = {
    tag: "root",
    attrs: {},
    text: "",
    children: rawRoots,
  };
  const pseudo = finalize(rootRaw, "command", null, true, errors);
  if (pseudo) roots.push(...pseudo.children);

  // Bare commands with no tags at all → each line becomes a command item
  if (roots.length === 0) {
    const stray = nonEmptyLines(
      tokens
        .filter((t) => t.type === "text")
        .map((t) => (t as { value: string }).value)
        .join("\n")
    ).filter((l) => !l.startsWith("#"));
    if (stray.length > 0) {
      for (const line of stray) {
        roots.push(makeItem(line, "command", null, {}));
      }
      errors.push("No tags found — plain lines were imported as commands");
    }
  }

  return { roots, errors };
}
