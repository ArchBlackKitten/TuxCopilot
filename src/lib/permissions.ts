// Permission modes said in words (chmod 700 / 755 / 644, u+x, go-w): who may read, change and
// run (or, for a folder, open) a file. Each digit is one "who": you (the owner), your group,
// everyone else; 4 = read + 2 = change + 1 = run. A fourth digit in front is for special cases.

const WHO = { u: "you", g: "your group", o: "everyone else" } as const;

/** One digit, e.g. 5 → "read and run". */
function digitWords(d: number): string {
  const can = [d & 4 && "read", d & 2 && "change", d & 1 && "run"].filter(Boolean) as string[];
  return can.length ? and(can) : "nothing";
}

const and = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

const SPECIAL: Array<[number, string]> = [
  [4, "it runs with its owner's rights, whoever starts it (setuid)"],
  [2, "it runs with its group's rights; in a folder, new files get the folder's group (setgid)"],
  [1, "in a folder, only a file's owner can delete it, as in /tmp (sticky)"],
];

/** Who letters → words: "go" → "your group and everyone else"; "" or "a" → "everyone". */
function whoWords(who: string): string {
  if (!who || who.includes("a") || ["u", "g", "o"].every((w) => who.includes(w))) return "everyone";
  return and([...new Set(who.split(""))].map((w) => WHO[w as keyof typeof WHO]));
}

const LETTER: Record<string, string> = { r: "read", w: "change", x: "run", X: "run (folders, and what is already runnable)", s: "run with its owner's or group's rights", t: "keep others from deleting its files (sticky)" };

/** A mode in words, or null when it isn't one: "755" → "you: read, change and run · your group: read and run · everyone else: read and run". */
export function permissionWords(mode: string): string | null {
  const m = mode.replace(/^["']|["']$/g, "");
  if (/^[0-7]{3,4}$/.test(m)) {
    const digits = m.split("").map(Number);
    const special = digits.length === 4 ? digits.shift()! : 0;
    const parts = (["u", "g", "o"] as const).map((w, i) => `${WHO[w]}: ${digitWords(digits[i])}`);
    const extra = SPECIAL.filter(([bit]) => special & bit).map(([, words]) => words);
    return [...parts, ...extra].join(" · ") + " (run means open, for a folder)";
  }
  const clauses = m.split(",");
  if (!clauses.every((c) => /^[ugoa]*[-+=][rwxXst]*$/.test(c))) return null;
  return clauses
    .map((c) => {
      const [, who, op, perms] = c.match(/^([ugoa]*)([-+=])([rwxXst]*)$/)!;
      const subject = whoWords(who);
      const can = and(perms.split("").map((p) => LETTER[p]));
      if (op === "=") return perms ? `${subject}: only ${can}` : `${subject}: nothing`;
      if (!perms) return `${subject}: unchanged`;
      return op === "+" ? `${subject} can now ${can} it` : `${subject} can no longer ${can} it`;
    })
    .join(" · ");
}

/** The mode a command sets, if this token is it: chmod's first plain argument; mkdir's and install's -m / --mode. */
export function isModeToken(binary: string | null, tokens: string[], i: number, firstArgSeen: boolean): string | null {
  const t = tokens[i].replace(/^["']|["']$/g, "");
  if (binary === "chmod" && !firstArgSeen) return t;
  if (binary === "mkdir" || binary === "install") {
    const prev = tokens[i - 1] ?? "";
    if (prev === "--mode" || /^-[a-zA-Z]*m$/.test(prev)) return t; // -m 700, -pm 700
    if (t.startsWith("--mode=")) return t.slice(7);
    const joined = t.match(/^-[a-zA-Z]*m([0-7]{3,4})$/); // -m700, install -Dm644
    if (joined) return joined[1];
  }
  return null;
}
