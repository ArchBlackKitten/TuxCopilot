// Explains a shell command line the way the "Arch Commands" panel needs:
// tokenize → validate every token against the KB → propose corrections for
// unknown tokens → describe each part → describe what the mix does overall
// → raise Arch-specific warnings (partial upgrades, sudo+YAY, forced pushes…).
//
// ─── Perfected for fresh Arch beginners ─────────────────────────────────────
// Three additions, all additive (every existing test still passes):
//
//   • plainLabel(role, binary?)        — beginner-readable role captions, so the
//                                        result says "an option of pacman" or
//                                        "a package name" instead of bare "flag"
//                                        or "arg". Used by the panel.
//   • Warning.safeAlt?                — a complete safer command to reach for
//                                        instead, surfaced as a primary button
//                                        distinct from the in-place `fix`.
//   • ExplainResult.preview           — "what happens when you press Enter",
//                                        built from the segments + warnings so
//                                        a beginner sees intent before running.
//   • Friendlier copy                  — everyday-command flags we don't know
//                                        now read as a one-line hint rather than
//                                        "flag not found in the knowledge base".

import { isModeToken, permissionWords } from "./permissions";
import { pacmanBundle } from "./pacman-letters";
import {
  KNOWN_BINARIES,
  BINARY_ALIASES,
  TOKEN_ALIASES,
  toolFor,
  allToolBinaries,
  systemCommand,
  suggest,
  type KbItem,
} from "./arch-kb";
import { commandDoc, CATALOG } from "./commands/catalog";

/** sudo's own options, and whether each takes a value (sudo --help). */
const SUDO_OPTS: Record<string, boolean> = {
  "-A": false, "--askpass": false, "-b": false, "--background": false, "-E": false, "--preserve-env": false, "-e": false, "--edit": false,
  "-g": true, "--group": true, "-H": false, "--set-home": false, "-h": false, "--help": false, "-i": false, "--login": false,
  "-K": false, "--remove-timestamp": false, "-k": false, "--reset-timestamp": false, "-l": false, "--list": false, "-n": false,
  "--non-interactive": false, "-P": false, "--preserve-groups": false, "-p": true, "--prompt": true, "-S": false, "--stdin": false,
  "-s": false, "--shell": false, "-u": true, "--user": true, "-V": false, "--version": false, "-v": false, "--validate": false,
  "-D": true, "--chdir": true, "-C": true, "--close-from": true, "-R": true, "--chroot": true, "-T": true, "--command-timeout": true,
  "-U": true, "--other-user": true, "--": false,
};
const sudoMeaning = (opt: string) => commandDoc("sudo")?.options.find((o) => o.token === opt)?.meaning ?? "an option of sudo itself";

export type TokenRole = "sudo" | "binary" | "flag" | "sub" | "arg" | "pkg" | "path" | "text" | "unknown";

/** Beginner-readable caption for a token's role, shown under the token chip. */
export function plainLabel(role: TokenRole, binary?: string | null): string {
  switch (role) {
    case "sudo":   return "runs the next part as root";
    case "binary": return binary ? `the program: ${binary}` : "the program";
    case "flag":   return binary ? `an option of ${binary}` : "an option";
    case "sub":    return binary ? `a subcommand of ${binary}` : "a subcommand";
    case "arg":    return "a value you fill in";
    case "pkg":    return "a package name";
    case "path":   return "a file or folder";
    case "text":   return "an argument";
    case "unknown":return "Fluff doesn't recognize this — pick a fix below";
  }
}

export interface TokenInfo {
  raw: string;
  role: TokenRole;
  ok: boolean;
  meaning?: string;
  /** expanded bundled flags, e.g. -Syu → ["-S","-y","-u"] */
  expanded?: string[];
  suggestions?: string[];
  suggestionBase?: "flag" | "sub" | "binary";
}

export interface SegmentInfo {
  text: string;
  connector: "&&" | "||" | ";" | "|" | null; // connector before this segment
  binary: string | null;
  tokens: TokenInfo[];
  summary: string;
}

export interface Warning {
  level: "danger" | "warn" | "info";
  text: string;
  fix?: string;        // best-effort in-place patch (replace/append a token)
  safeAlt?: string;   // a complete safer command to reach for instead
}

export interface ExplainResult {
  segments: SegmentInfo[];
  combined: string;
  warnings: Warning[];
  clean: boolean; // every token recognized
  /** "what happens when you press Enter" — a one-line intent, beginner-first */
  preview: string;
}

// ---------------------------------------------------------------- tokenizer
function tokenize(text: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1] !== undefined) out.push(`"${m[1]}"`);
    else if (m[2] !== undefined) out.push(`'${m[2]}'`);
    else out.push(m[3]);
  }
  return out;
}

/** split on && || ; | while keeping the connector that precedes each segment */
function splitPipeline(cmd: string): Array<{ connector: SegmentInfo["connector"]; text: string }> {
  const chunks: Array<{ connector: SegmentInfo["connector"]; text: string }> = [];
  let pending: SegmentInfo["connector"] = null;
  let buf = "";
  let i = 0;
  let quote: "'" | '"' | null = null; // inside quotes, | ; && are just characters (grep -E 'VGA|3D')
  while (i < cmd.length) {
    const ch0 = cmd[i];
    if (ch0 === "\\" && quote !== "'" && i + 1 < cmd.length) {
      buf += cmd.slice(i, i + 2); // an escaped character, kept as it is
      i += 2;
      continue;
    }
    if (quote) {
      if (ch0 === quote) quote = null;
      buf += ch0;
      i += 1;
      continue;
    }
    if (ch0 === "'" || ch0 === '"') {
      quote = ch0;
      buf += ch0;
      i += 1;
      continue;
    }
    const two = cmd.slice(i, i + 2);
    if (two === "&&" || two === "||") {
      if (buf.trim()) chunks.push({ connector: pending, text: buf.trim() });
      pending = two as SegmentInfo["connector"];
      buf = "";
      i += 2;
      continue;
    }
    const ch = cmd[i];
    if (ch === ";" || ch === "|") {
      if (buf.trim()) chunks.push({ connector: pending, text: buf.trim() });
      pending = (ch === "|" ? "|" : ";") as SegmentInfo["connector"];
      buf = "";
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  if (buf.trim()) chunks.push({ connector: pending, text: buf.trim() });
  return chunks;
}

// ------------------------------------------------------------ flag matching
interface FlagLookup {
  exact: Map<string, KbItem>;
  short: KbItem[]; // -x single-char flags
}

function flagLookup(binary: string, extra: KbItem[]): FlagLookup {
  const tool = toolFor(binary);
  const exact = new Map<string, KbItem>();
  const short: KbItem[] = [];
  const items = [...(tool?.items ?? []), ...extra];
  for (const it of items) {
    if (it.kind !== "flag") continue;
    exact.set(it.token, it);
    if (/^-[a-zA-Z]$/.test(it.token)) short.push(it);
  }
  return { exact, short };
}

/** Try to explain a bundled short-flag token like -Syu or -Syyu. */
function expandBundled(token: string, binary: string, lookup: FlagLookup): TokenInfo | null {
  const tool = toolFor(binary);
  if (!tool?.bundledShortFlags) return null;
  const m = /^-([a-zA-Z]+)$/.exec(token);
  if (!m) return null;
  const chars = m[1].split("");
  if (chars.length < 2) return null;
  // only bundle if every char is a known single-char flag of this tool
  const infos: Array<{ item: KbItem | undefined; count: number }> = [];
  for (let i = 0; i < chars.length; i++) {
    const tok = `-${chars[i]}`;
    const item = lookup.short.find((s) => s.token === tok);
    if (!item) return null;
    const prev = infos[infos.length - 1];
    if (prev && prev.item === item) prev.count++;
    else infos.push({ item, count: 1 });
  }
  const expanded = chars.map((c) => `-${c}`);
  const meanings = infos.map(({ item, count }) => {
    let meaning = item!.meaning;
    if (count > 1) meaning = meaning.replace(/\.$/, "") + " (repeated → force/extra strength)";
    return meaning;
  });
  return {
    raw: token,
    role: "flag",
    ok: true,
    expanded,
    meaning: meanings.join(" + "),
  };
}

// ------------------------------------------------------------------ explain
export interface ExplainOptions {
  /** installed package names discovered on this machine (optional) */
  installed?: string[];
  /** dynamic flags discovered from --help parsing, keyed by binary */
  dynamic?: Record<string, KbItem[]>;
}

/** Find every tool that has an item with this exact token (a flag or subcommand).
 *  Used by both the explainer and the search so that typing a bare `--needed` or
 *  `clone` recommends the commands that have it, rather than "unknown command". */
export function findTokenOwners(
  token: string,
  dynamic: Record<string, KbItem[]> = {}
): Array<{ tool: typeof KNOWN_BINARIES[number]; item: KbItem }> {
  const owners: Array<{ tool: typeof KNOWN_BINARIES[number]; item: KbItem }> = [];
  for (const tool of KNOWN_BINARIES) {
    const items = [...tool.items, ...(dynamic[tool.binary] ?? [])];
    for (const it of items) {
      if (it.token === token) {
        owners.push({ tool, item: it });
      }
    }
  }
  return owners;
}

export function explainCommand(input: string, opts: ExplainOptions = {}): ExplainResult {
  const warnings: Warning[] = [];
  const rawSegments = splitPipeline(input);
  const dynamic = opts.dynamic ?? {};
  const installedSet = opts.installed ? new Set(opts.installed) : null;
  const segments: SegmentInfo[] = [];
  const summaries: string[] = [];

  rawSegments.forEach((seg) => {
    const tokens = tokenize(seg.text);
    const info: SegmentInfo = { text: seg.text, connector: seg.connector, binary: null, tokens: [], summary: "" };
    const tokenInfos: TokenInfo[] = info.tokens;

    let tool = toolFor("system"); // fallback KB for bare commands like lsblk
    let toolUsed = false;

    // first pass: find the binary (skip sudo)
    let binary: string | null = null;
    let startIdx = 0;
    let afterSudo = false;
    for (let i = 0; i < tokens.length; i++) {
      const norm = tokens[i].replace(/^["']|["']$/g, "").toLowerCase();
      if (norm === "sudo" || norm === "doas") {
        tokenInfos[i] = { raw: tokens[i], role: "sudo", ok: true, meaning: `run as root (via ${norm})` };
        startIdx = i + 1;
        afterSudo = norm === "sudo";
        continue;
      }
      // options right after sudo are sudo's own, not the command's
      if (afterSudo && tokens[i].startsWith("-")) {
        const opt = tokens[i].split("=")[0];
        if (opt in SUDO_OPTS) {
          tokenInfos[i] = { raw: tokens[i], role: "flag", ok: true, meaning: `sudo: ${sudoMeaning(opt)}` };
          if (SUDO_OPTS[opt] && !tokens[i].includes("=") && i + 1 < tokens.length) {
            i++;
            tokenInfos[i] = { raw: tokens[i], role: "arg", ok: true, meaning: `the value for sudo's ${opt}` };
          }
        } else {
          tokenInfos[i] = {
            raw: tokens[i],
            role: "flag",
            ok: false,
            meaning: `sudo has no ${opt} option — sudo --help lists the ones it has`,
            suggestions: suggest(opt, Object.keys(SUDO_OPTS)),
            suggestionBase: "flag",
          };
        }
        startIdx = i + 1;
        continue;
      }
      binary = norm;
      startIdx = i + 1;
      break;
    }

    if (binary) {
      const known = KNOWN_BINARIES.find((t) => t.binary === binary);
      if (known) {
        tool = known;
        toolUsed = true;
        tokenInfos[startIdx - 1] = { raw: tokens[startIdx - 1], role: "binary", ok: true, meaning: known.blurb };
      } else if (commandDoc(binary)) {
        tokenInfos[startIdx - 1] = { raw: tokens[startIdx - 1], role: "binary", ok: true, meaning: commandDoc(binary)!.what };
      } else if (systemCommand(binary)) {
        tokenInfos[startIdx - 1] = { raw: tokens[startIdx - 1], role: "binary", ok: true, meaning: systemCommand(binary)! };
      } else if (allToolBinaries().includes(binary)) {
        tokenInfos[startIdx - 1] = { raw: tokens[startIdx - 1], role: "binary", ok: true, meaning: BINARY_ALIASES[binary] ? `common alias — arch equivalent: ${BINARY_ALIASES[binary]}` : "standard shell command" };
      } else {
        // bare flag or subcommand? if the "binary" is actually a known flag/sub of
        // any tool (e.g. typing `--needed` or `clone` alone), recommend the commands
        // that have it instead of saying "unknown command on this machine".
        const owners = findTokenOwners(binary, dynamic);
        if (owners.length > 0) {
          const sugg = owners.map((o) =>
            o.tool.binary === "system" ? o.item.token : `${o.tool.binary} ${o.item.token}`
          );
          const kind = owners[0].item.kind; // "flag" or "sub"
          tokenInfos[startIdx - 1] = {
            raw: tokens[startIdx - 1],
            role: kind,
            ok: false,
            meaning: `a ${kind === "sub" ? "subcommand" : "flag"} of: ${owners
              .map((o) => o.tool.binary)
              .join(", ")} — click a suggestion below to see it in context`,
            suggestions: sugg,
            suggestionBase: kind,
          };
          // the segment has no real binary — clear it so the preview doesn't claim one
          binary = null;
        } else if (BINARY_ALIASES[binary]) {
          tokenInfos[startIdx - 1] = {
            raw: tokens[startIdx - 1],
            role: "binary",
            ok: false,
            meaning: `not an Arch command — on Arch this is ${BINARY_ALIASES[binary]}`,
            suggestions: [BINARY_ALIASES[binary]],
            suggestionBase: "binary",
          };
        } else {
          const sugg = suggest(binary, [...new Set([...allToolBinaries(), ...CATALOG.map((c) => c.name)])]);
          tokenInfos[startIdx - 1] = {
            raw: tokens[startIdx - 1],
            role: "unknown",
            ok: false,
            meaning: "unknown command on this machine",
            suggestions: sugg,
            suggestionBase: "binary",
          };
        }
      }
    }
    info.binary = binary;

    // second pass: flags, subcommands, args
    let subSeen = false;
    let pkgArgs: string[] = [];
    let subToken: string | null = null;
    let plainSeen = false; // chmod's mode is its first plain argument

    for (let i = startIdx; i < tokens.length; i++) {
      const raw = tokens[i];
      const bare = raw.replace(/^["']|["']$/g, "");
      const isFlag = /^--?[a-zA-Z][\w-]*$/.test(bare) && !/^-\d+$/.test(bare);

      // a permission mode (chmod 755, chmod -x, mkdir -m 700, install -Dm644): said in words
      const mode = isModeToken(binary, tokens, i, plainSeen);
      const modeWords = mode !== null ? permissionWords(mode) : null;
      if (modeWords) {
        tokenInfos[i] = { raw, role: "arg", ok: true, meaning: `permissions — ${modeWords}` };
        plainSeen = true;
        continue;
      }

      if (isFlag) {
        const lookup = flagLookup(binary ?? "", dynamic[binary ?? ""] ?? []);
        // exact match first (covers -Syu, -Sua, -Syyuu curated combos)
        const exact = lookup.exact.get(bare);
        const pac = !exact && (binary === "pacman" || binary === "yay") ? pacmanBundle(bare) : null;
        if (exact) {
          tokenInfos[i] = { raw, role: "flag", ok: true, meaning: exact.meaning };
        } else if (pac) {
          tokenInfos[i] = { raw, role: "flag", ok: true, expanded: pac.expanded, meaning: pac.meaning };
        } else {
          const bundled = expandBundled(bare, binary ?? "", lookup);
          const knownTool = Boolean(binary && KNOWN_BINARIES.some((t) => t.binary === binary));
          if (bundled) {
            tokenInfos[i] = bundled;
          } else if (!knownTool) {
            // an everyday command (rm, ls, tar…): its options from the catalogue; others are not policed
            const doc = binary ? commandDoc(binary) : undefined;
            const opt = doc?.options.find((o) => o.token === bare);
            const letters = !opt && doc && /^-[a-zA-Z]{2,}$/.test(bare) ? bare.slice(1).split("").map((c) => doc.options.find((o) => o.token === `-${c}`)) : null;
            tokenInfos[i] = opt
              ? { raw, role: "flag", ok: true, meaning: opt.meaning }
              : letters && letters.every(Boolean)
                ? { raw, role: "flag", ok: true, expanded: bare.slice(1).split("").map((c) => `-${c}`), meaning: letters.map((o) => o!.meaning).join(" + ") }
                : { raw, role: "flag", ok: true, meaning: doc ? `${binary} has this flag — \`${binary} --help\` lists them all` : `a flag of ${binary ?? "the command"}` };
          } else if (binary && (binary === "git" || binary === "systemctl") && /^-\w{2,}$/.test(bare)) {
            tokenInfos[i] = { raw, role: "flag", ok: false, meaning: "Fluff doesn't recognize this option — try one of these, or sync so Fluff learns what this computer knows", suggestions: suggest(bare, lookup.exact.size ? [...lookup.exact.keys()] : []), suggestionBase: "flag" };
          } else {
            tokenInfos[i] = {
              raw,
              role: "flag",
              ok: false,
              meaning: "Fluff doesn't recognize this option — try one of these, or sync so Fluff learns what this computer knows",
              suggestions: suggest(bare, [...lookup.exact.keys()]),
              suggestionBase: "flag",
            };
          }
        }
        // track combos for warnings (read below via charsStr per segment)
        continue;
      }

      // subcommand position (git/systemctl style)
      if (toolUsed && tool && tool.subFirst && !subSeen && !subToken) {
        const norm = bare.toLowerCase();
        const sub = tool.items.find((it) => it.kind === "sub" && it.token === norm);
        const alias = TOKEN_ALIASES[norm];
        const aliasSub = alias ? tool.items.find((it) => it.kind === "sub" && it.token === alias.replace(/^-+/, "").toLowerCase()) : undefined;
        if (sub) {
          tokenInfos[i] = { raw, role: "sub", ok: true, meaning: sub.meaning };
          subToken = norm;
          subSeen = true;
          continue;
        }
        if (aliasSub) {
          tokenInfos[i] = { raw, role: "sub", ok: false, meaning: "misspelled subcommand", suggestions: [aliasSub.token], suggestionBase: "sub" };
          subSeen = true;
          continue;
        }
        const subs = tool.items.filter((it) => it.kind === "sub").map((it) => it.token);
        const sugg = suggest(norm, subs);
        tokenInfos[i] = {
          raw,
          role: norm.length && sugg.length ? "sub" : "unknown",
          ok: false,
          meaning: `not a known ${binary} subcommand`,
          suggestions: sugg,
          suggestionBase: "sub",
        };
        subSeen = true;
        continue;
      }

      // plain argument
      plainSeen = true;
      if (installedSet && (binary === "pacman" || binary === "yay") && !bare.startsWith("/")) {
        const knownPkg = installedSet.has(bare);
        tokenInfos[i] = {
          raw,
          role: "pkg",
          ok: true,
          meaning: knownPkg ? "package (already installed on this machine)" : "package (not installed locally — new or typo?)",
        };
        pkgArgs.push(bare);
      } else {
        tokenInfos[i] = { raw, role: /^[-~/.]/.test(bare) || bare.includes("/") ? "path" : "text", ok: true };
        if (binary === "pacman" || binary === "yay") pkgArgs.push(bare);
      }
    }

    // per-segment summary
    const flagMeanings = tokenInfos
      .filter((t) => t.role === "flag" && t.meaning)
      .map((t) => (t.expanded ? t.expanded.join("") + " — " + t.meaning : `${t.raw} — ${t.meaning}`));
    const subMeaning = tokenInfos.find((t) => t.role === "sub")?.meaning;
    const parts: string[] = [];
    if (binary) parts.push(toolUsed ? `${binary}` : `${binary}`);
    if (subMeaning) parts.push(subMeaning);
    if (pkgArgs.length) parts.push(`targets: ${pkgArgs.join(", ")}`);
    if (flagMeanings.length) parts.push(flagMeanings.join("; "));
    info.summary = parts.filter(Boolean).join(" · ");
    summaries.push(info.summary);
    segments.push(info);
  });

  // ------------------------------------------------------------- warnings
  const flat = segments.flatMap((s) => s.tokens);
  const binaries = segments.map((s) => s.binary);
  const has = (fn: (t: TokenInfo) => boolean) => flat.some(fn);

  if (binaries.includes("yay") && has((t) => t.role === "sudo")) {
    warnings.push({
      level: "danger",
      text: "Never run yay (or any AUR helper) with sudo — makepkg refuses to build as root and this breaks the AUR flow. Yay asks for the password itself when needed.",
      fix: flat.find((t) => t.role === "sudo") ? "remove sudo" : undefined,
      safeAlt: "yay -Syu --needed <package>",
    });
  }
  // the one sanctioned -Sy: the keyring alone, then the full update (Arch's fix for signature errors)
  const fullUpdateLater = (i: number) =>
    segments.slice(i + 1).some((s) => s.binary === "pacman" && s.tokens.some((t) => t.role === "flag" && /^-[a-zA-Z]*S[a-zA-Z]*$/.test(t.raw) && /u/.test(t.raw)));
  segments.forEach((seg, i) => {
    if (seg.binary !== "pacman" && seg.binary !== "yay") return;
    const segFlags = seg.tokens.filter((t) => t.role === "flag");
    const charsStr = segFlags.flatMap((f) => (/^-([a-zA-Z]+)$/.test(f.raw) ? f.raw.slice(1).split("") : [])).join("");
    const segPkgs = seg.tokens.filter((t) => t.role === "pkg" || (t.role === "text" && !/^\//.test(t.raw)));
    const keyringFirst = segPkgs.length > 0 && segPkgs.every((t) => t.raw === "archlinux-keyring") && fullUpdateLater(i);
    if (charsStr.includes("S") && charsStr.includes("y") && !charsStr.includes("u") && segPkgs.length > 0 && !keyringFirst) {
      const yay = seg.binary === "yay";
      warnings.push({
        level: "warn",
        text: `Partial upgrade: '${yay ? "yay" : "pacman"} -Sy <package>' updates the list of packages but not your system, so the new app can need newer parts than the rest of your system has — and that can break programs you already use. '-Syu' updates everything first.`,
        fix: `use '${yay ? "yay" : "pacman"} -Syu --needed <package>'`, // the button rewrites -Sy to -Syu in place
        safeAlt: yay ? "yay -Syu --needed <package>" : "sudo pacman -Syu --needed <package>",
      });
    }
    if (seg.binary !== "pacman") return;
    if (charsStr.includes("R") && !charsStr.includes("s")) {
      warnings.push({
        level: "info",
        text: "'-R' leaves dependencies behind. Most of the time you want '-Rns' (removes unneeded deps + backup config files).",
        fix: "-Rns",
        safeAlt: "sudo pacman -Rns <package>",
      });
    }
    if (charsStr.includes("S") && segPkgs.length > 0 && !segFlags.some((f) => f.raw === "--needed")) {
      warnings.push({
        level: "info",
        text: "Installing without --needed will re-install packages that are already up to date.",
        fix: "--needed",
        safeAlt: "sudo pacman -Syu --needed <package>",
      });
    }
  });
  const yyu = flat.find((t) => t.role === "flag" && /^-[a-zA-Z]*y{2,}[a-zA-Z]*u{2,}$/.test(t.raw));
  if (yyu) {
    warnings.push({
      level: "info",
      text: "Doubled u permits downgrades to match the sync databases — meant for recovery or repository switching, not routine updates.",
    });
  }
  const syyOnly = segments.find((seg) => {
    if (seg.binary !== "pacman") return false;
    const f = seg.tokens.filter((t) => t.role === "flag").map((t) => t.raw).join("");
    const args = seg.tokens.filter((t) => t.role === "pkg" || t.role === "text");
    return f.includes("yy") && !f.includes("u") && args.length === 0;
  });
  if (syyOnly) {
    warnings.push({
      level: "info",
      text: "pacman -Syy alone only force-refreshes databases — usually needed just to repair stale or inconsistent database files.",
    });
  }
  if (segments.some((s) => s.binary === "git" && s.tokens.some((t) => t.raw === "--force"))) {
    warnings.push({
      level: "warn",
      text: "git push --force rewrites remote history and can destroy teammates' commits.",
      fix: "--force-with-lease",
      safeAlt: "git push --force-with-lease",
    });
  }
  const rmIdx = segments.findIndex((s) => s.binary === "rm" && s.tokens.some((t) => /^-*[rf]+$/.test(t.raw.replace(/^-+/, "-")) && /r/i.test(t.raw) && /f/i.test(t.raw)));
  if (rmIdx >= 0) {
    const seg = segments[rmIdx];
    const dangerous = seg.tokens.some((t) => t.raw === "/" || t.raw === "/*" || t.raw === "~" || t.raw === "~/" || t.raw === '"$HOME"' || t.raw === "$HOME");
    warnings.push({
      level: dangerous ? "danger" : "warn",
      text: dangerous
        ? "rm -rf pointed at / or your home directory — this DESTROYS the system. Triple-check the path."
        : "rm -rf deletes recursively without asking — verify the exact path first.",
    });
  }
  if (segments.some((s) => s.binary === "systemctl" && s.tokens.some((t) => t.raw === "enable") && !s.tokens.some((t) => t.raw === "--now"))) {
    warnings.push({
      level: "info",
      text: "enable schedules the unit for boot only — add --now to also start it immediately.",
      fix: "--now",
      safeAlt: "sudo systemctl enable --now <service>",
    });
  }
  if (segments.some((s) => s.binary === "git" && s.tokens.some((t) => t.raw === "commit") && !s.tokens.some((t) => t.raw === "-m" || t.raw.startsWith("-m")))) {
    warnings.push({
      level: "info",
      text: "git commit without -m opens the editor; add -m \"message\" to stay in the shell.",
      fix: '-m "message"',
      safeAlt: 'git commit -m "message"',
    });
  }
  if (segments.some((s) => s.binary === "mkinitcpio" && !s.tokens.some((t) => /^(-P|-p|--preset)/.test(t.raw)))) {
    warnings.push({ level: "info", text: "mkinitcpio without -P/-p builds nothing (needs a preset).", fix: "-P", safeAlt: "sudo mkinitcpio -P" });
  }
  if (segments.some((s) => s.binary === "curl" || s.binary === "wget") && /\|\s*(ba)?sh/.test(input)) {
    warnings.push({ level: "warn", text: "Piping a downloaded script straight into a shell runs unreviewed code as your user (or root if sudo). Read the script first." });
  }

  if (segments.some((s) => s.binary === "chmod" && s.tokens.some((t) => /^"?777"?$/.test(t.raw)))) {
    warnings.push({
      level: "warn",
      text: "chmod 777 makes the file world-writable — prefer 755 (dirs) / 644 (files) unless a socket/perm hack truly demands it.",
      safeAlt: "chmod 755 <file>",
    });
  }
  const hasUnknown = flat.some((t) => !t.ok);

  const combined = summaries.filter(Boolean).join(segments.length > 1 ? "\n" : "");

  // ─── preview: "what happens when you press Enter" ────────────────────────
  const preview = buildPreview(segments, warnings);

  return { segments, combined, warnings, clean: !hasUnknown, preview };
}

/** Builds the one-line "what happens when you press Enter" preview. */
function buildPreview(segments: SegmentInfo[], warnings: Warning[]): string {
  const danger = warnings.find((w) => w.level === "danger");
  if (danger) {
    return `Stops here: ${danger.text} Press Enter only if you are sure.`;
  }
  const step = (s: SegmentInfo) => {
    const bin = s.binary ?? "the command";
    const sub = s.tokens.find((t) => t.role === "sub");
    const flags = s.tokens.filter((t) => t.role === "flag").map((t) => t.raw).join(" ");
    const args = s.tokens
      .filter((t) => ["arg", "pkg", "path", "text"].includes(t.role))
      .map((t) => t.raw)
      .join(" ");
    return [bin, sub?.raw, flags, args].filter(Boolean).join(" ");
  };
  const warn = warnings.find((w) => w.level === "warn");
  const tail = warn ? ` — but mind: ${warn.text}` : "";
  if (segments.length === 0) return "";
  if (segments.length === 1) {
    return `Runs: ${step(segments[0])}${tail}`;
  }
  return `Runs ${segments.length} commands in sequence: ${segments.map(step).join(", then ")}${tail}`;
}

export function buildSuggestionsMap(result: ExplainResult): Array<{ token: string; suggestions: string[] }> {
  const out: Array<{ token: string; suggestions: string[] }> = [];
  for (const seg of result.segments) {
    for (const t of seg.tokens) {
      if (!t.ok && t.suggestions && t.suggestions.length > 0) {
        out.push({ token: t.raw, suggestions: t.suggestions });
      }
    }
  }
  return out;
}
