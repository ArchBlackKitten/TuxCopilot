// The rule: a command mentioned anywhere is clickable, and can be searched.
// Text is cut into pieces, each command Fluff has a page for marked, so the screen can make it
// a link to that page. In a command line, the commands are the words in command position (the
// first, and after a pipe, &&, ||, ;, sudo, xargs…). In a sentence, command names are links —
// except names that are also everyday words ("free space", "find a file"), which are links
// only inside `backticks`, where they are code.

import { commandDoc } from "./commands/catalog";

export interface Piece {
  text: string;
  command?: string; // the page it opens
  code?: boolean; // it was written `like this`
}

/** Command names that are also everyday English words. */
export const WORDY = new Set(["cat", "diff", "echo", "file", "find", "free", "groups", "head", "id", "kill", "less", "man", "mount", "sort", "tail", "top", "touch", "which", "zip", "ping", "su"]);

/** Words after which the next word is a command again. */
const RUNS_NEXT = new Set(["|", "||", "&&", ";", "sudo", "xargs", "torsocks", "watch", "time", "nohup", "exec", "then", "do", "env"]);

const known = (w: string, skip?: string) => (w !== skip && commandDoc(w) ? w : null);

/** A command line: its commands are links. `skip`: the page this is shown on (no link to itself). */
export function lineLinks(line: string, skip?: string): Piece[] {
  const out: Piece[] = [];
  let next = true; // the first word is a command
  for (const part of line.split(/(\s+|\|\||&&|[|;])/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      out.push({ text: part, code: true });
      continue;
    }
    // sudo's own options (-u alice) keep the next real word a command
    const name = next && !part.startsWith("-") ? known(part, skip) : null;
    out.push(name ? { text: part, command: name, code: true } : { text: part, code: true });
    if (RUNS_NEXT.has(part)) next = true;
    else if (!part.startsWith("-") || !next) next = false;
  }
  return merge(out);
}

/** A sentence: command names are links (everyday-word names only inside backticks). */
export function textLinks(text: string, skip?: string): Piece[] {
  const out: Piece[] = [];
  text.split(/(`[^`]+`)/).forEach((chunk) => {
    if (!chunk) return;
    if (chunk.startsWith("`") && chunk.endsWith("`") && chunk.length > 2) {
      out.push(...lineLinks(chunk.slice(1, -1), skip).map((p) => ({ ...p, code: true })));
      return;
    }
    for (const part of chunk.split(/([A-Za-z][A-Za-z0-9._+-]*[A-Za-z0-9]|[A-Za-z])/)) {
      if (!part) continue;
      const name = !WORDY.has(part) ? known(part, skip) : null;
      out.push(name ? { text: part, command: name } : { text: part });
    }
  });
  return merge(out);
}

/** Neighbouring plain pieces as one. */
function merge(ps: Piece[]): Piece[] {
  const out: Piece[] = [];
  for (const p of ps) {
    const last = out[out.length - 1];
    if (last && !last.command && !p.command && !!last.code === !!p.code) last.text += p.text;
    else out.push({ ...p });
  }
  return out;
}
