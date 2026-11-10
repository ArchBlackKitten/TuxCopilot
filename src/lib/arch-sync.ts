// "Arch Commands" self-update: pulls fresh flag/subcommand documentation straight from the
// tools installed on THIS machine (`pacman --help`, `yay --help`, `git help -a`,
// `systemctl --help`) plus the installed package list (`pacman -Qq`), and merges it into
// the knowledge base. Everything is read-only; nothing is installed or modified.

import { execRaw, inv } from "./host";

interface Parsed {
  token: string;
  kind: "flag" | "sub";
  meaning: string;
}

/** execFile with "ok when it exited cleanly or printed anything" — help output often exits 1. */
async function run(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  const r = await execRaw(cmd, args, 20_000);
  if (!r) return { ok: false, out: "" };
  if (r.code !== 0 && !r.stdout) return { ok: false, out: r.stderr };
  return { ok: true, out: `${r.stdout}${r.stderr}` };
}

/** Parse "  -S, --sync  description" style help blocks. */
export function parseFlagHelp(out: string): Parsed[] {
  const out2: Parsed[] = [];
  const seen = new Set<string>();
  for (const line of out.split("\n")) {
    // long flags with description on same line
    let m = /^\s+(-\w,\s+)?(--[\w-]+)\s\s+(.+?)\s*$/.exec(line);
    if (m) {
      const long = m[2];
      const meaning = m[3];
      if (!seen.has(long)) {
        seen.add(long);
        out2.push({ token: long, kind: "flag", meaning });
      }
      // short flag on the same line often maps to the long one
      if (m[1]) {
        const short = `-${m[1].charAt(1)}`;
        if (!seen.has(short) && !out2.some((p) => p.token === short)) {
          seen.add(short);
          out2.push({ token: short, kind: "flag", meaning: `${meaning} (long form --${long.slice(2)})` });
        }
      }
      continue;
    }
    // short-only flags with description
    m = /^\s+(-\w)\s\s+(.+?)\s*$/.exec(line);
    if (m && !m[1].startsWith("--")) {
      const tok = m[1];
      if (!seen.has(tok) && !out2.some((p) => p.token === tok)) {
        seen.add(tok);
        out2.push({ token: tok, kind: "flag", meaning: m[2] });
      }
    }
  }
  return out2;
}

/** Parse `git help -a` subcommand lists. */
export function parseGitSubs(out: string): Parsed[] {
  const out2: Parsed[] = [];
  const known = new Set(["init", "clone", "add", "status", "push", "pull", "commit", "branch", "checkout", "merge", "rebase", "log", "fetch"]);
  for (const line of out.split("\n")) {
    if (/^ {3,}[\w.-]+(\s{2,}\S.*)?$/.test(line) && !line.includes("--")) {
      const tokens = line.trim().split(/\s+/);
      if (tokens.length >= 1 && /^[a-z][\w-]*$/.test(tokens[0])) {
        if (known.has(tokens[0])) continue; // curated already covers the classics with better text
        out2.push({ token: tokens[0], kind: "sub", meaning: tokens.slice(1).join(" ") || "git subcommand (from this machine's git)" });
      }
    }
  }
  return out2;
}

const setSetting = (key: string, value: string) => inv("setting_set", { key, value });

export async function archSync() {
  const found: string[] = [];
  const missing: string[] = [];
  let totalNew = 0;

  const jobs: Array<{ tool: string; cmd: string; args: string[]; parse: (o: string) => Parsed[] }> = [
    { tool: "pacman", cmd: "pacman", args: ["--help"], parse: parseFlagHelp },
    { tool: "yay", cmd: "yay", args: ["--help"], parse: parseFlagHelp },
    { tool: "git", cmd: "git", args: ["help", "-a"], parse: parseGitSubs },
    { tool: "systemctl", cmd: "systemctl", args: ["--help"], parse: parseFlagHelp },
    { tool: "journalctl", cmd: "journalctl", args: ["--help"], parse: parseFlagHelp },
  ];

  for (const job of jobs) {
    const { ok, out } = await run(job.cmd, job.args);
    if (!ok) {
      missing.push(job.tool);
      continue;
    }
    found.push(job.tool);
    const entries = job
      .parse(out)
      .filter((p) => p.token.length >= 2 && p.token.length <= 40 && p.meaning.length > 3)
      .slice(0, 120)
      .map((p) => ({ ...p, meaning: p.meaning.slice(0, 300) }));
    try {
      totalNew += await inv<number>("kb_upsert", { tool: job.tool, entries });
    } catch {
      // a failed merge for one tool leaves the others intact
    }
  }

  // installed package names (used to validate package arguments)
  let installedCount = 0;
  let installedNote = "";
  const q = await run("pacman", ["-Qq"]);
  if (q.ok) {
    const pkgs = q.out.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 5000);
    installedCount = pkgs.length;
    try {
      await setSetting("installed.packages", JSON.stringify(pkgs));
    } catch {
      installedNote = " (could not cache package list)";
    }
  } else {
    missing.push("pacman -Qq");
  }

  const uname = await run("uname", ["-r"]);
  const kernel = uname.ok ? uname.out.trim() : null;
  try {
    await setSetting("kb.lastSync", JSON.stringify({ at: new Date().toISOString(), found, missing, kernel }));
  } catch {
    // best effort
  }

  return {
    ok: true,
    found,
    missing,
    installedCount,
    newEntries: totalNew,
    kernel,
    note:
      missing.length > 0
        ? `Not available on this machine: ${missing.join(", ")}. The curated knowledge base still applies.${installedNote}`
        : installedNote,
  };
}

/** The dynamic knowledge base: entries learned from this machine + installed packages + last sync. */
export async function archKb() {
  try {
    const entries = await inv<Array<{ tool: string; token: string; kind: string; meaning: string }>>("kb_list");
    const dynamic: Record<string, Array<{ token: string; kind: string; meaning: string }>> = {};
    for (const e of entries) (dynamic[e.tool] ??= []).push({ token: e.token, kind: e.kind, meaning: e.meaning });

    const parse = async <T>(key: string, fallback: T): Promise<T> => {
      try {
        const v = await inv<string | null>("setting_get", { key });
        return v ? (JSON.parse(v) as T) : fallback;
      } catch {
        return fallback;
      }
    };
    const installed = await parse<string[]>("installed.packages", []);
    const lastSync = await parse<{ at: string; found: string[]; missing: string[]; kernel: string | null } | null>("kb.lastSync", null);
    return { dynamic, installed, lastSync, dynamicCount: entries.length };
  } catch {
    return { dynamic: {}, installed: [], lastSync: null, dynamicCount: 0 };
  }
}
