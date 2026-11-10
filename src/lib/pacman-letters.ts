// pacman's options mean different things in different operations: -s searches with -Q and -S,
// but with -R it also removes dependencies nothing else needs; -c is the changelog with -Q,
// cleaning the cache with -S, and removing what depends on it with -R. Said per operation, from
// pacman's own manual (man pacman), so a bundle like -Rns or -Qqm reads right.

const OP: Record<string, string> = {
  S: "install from the repositories (sync)",
  Q: "look in what is installed (query)",
  R: "remove",
  U: "install a package file",
  D: "change the database's record (database)",
  F: "search the files database: which package has a file",
  T: "check which dependencies are missing",
};

const COMMON: Record<string, string> = {
  b: "use another database folder (--dbpath)",
  r: "use another root folder (--root)",
  v: "say more about what it does (--verbose)",
  h: "show the help for this operation",
};

const LETTERS: Record<string, Record<string, string>> = {
  Q: {
    c: "show the package's changelog",
    d: "only packages installed as dependencies",
    e: "only packages you installed on purpose (explicitly)",
    g: "list the packages in a group",
    i: "show a package's details",
    ii: "show a package's details, and its backup files",
    k: "check that the package's files are all there",
    kk: "check the package's files, and whether any changed since install",
    l: "list the files a package installed",
    m: "only packages not in any repository (usually from the AUR)",
    n: "only packages from the repositories (native)",
    o: "which installed package owns this file",
    p: "read a package file instead of the database",
    q: "names only (quiet)",
    s: "search what is installed (name and description)",
    t: "only packages nothing else needs",
    tt: "only packages nothing needs, not even optionally",
    u: "only packages that have an update waiting",
  },
  S: {
    c: "clean old package files from the cache",
    cc: "clean every package file from the cache",
    d: "skip dependency checks (risky)",
    dd: "skip all dependency checks (riskier)",
    g: "list the packages in a group",
    i: "show a package's details from the repositories",
    ii: "show a package's details, and what needs it",
    l: "list a repository's packages",
    p: "print what would be done, and do nothing",
    q: "names only (quiet)",
    s: "search the repositories (name and description)",
    u: "upgrade every installed package (sysupgrade)",
    uu: "upgrade, and allow downgrades to match the repositories",
    w: "download only, don't install",
    y: "download fresh package lists",
    yy: "download fresh package lists, even if they look current",
  },
  R: {
    c: "also remove every package that needs it (risky: can take much with it)",
    d: "skip dependency checks (risky)",
    dd: "skip all dependency checks (riskier)",
    n: "also remove its settings files (no .pacsave kept)",
    p: "print what would be removed, and do nothing",
    s: "also remove the dependencies nothing else needs",
    ss: "also remove dependencies, even ones you installed on purpose",
    u: "only remove packages nothing needs",
  },
  U: { d: "skip dependency checks (risky)", p: "print what would be done, and do nothing" },
  D: { k: "check the local database is consistent", kk: "check it against the repositories too", q: "quiet" },
  F: { l: "list the files of a package", x: "search with a regular expression", y: "download fresh files lists", yy: "download fresh files lists, even if they look current", q: "names only (quiet)" },
  T: {},
};

/** A bundle like -Rns or -Qqm in words, or null when it isn't one (or a letter is unknown there). */
export function pacmanBundle(flag: string): { meaning: string; expanded: string[] } | null {
  const m = flag.match(/^-([DFQRSTU])([a-zA-Z]*)$/);
  if (!m) return null;
  const [, op, rest] = m;
  const parts = [OP[op]];
  const expanded = [`-${op}`];
  for (let i = 0; i < rest.length; ) {
    const two = rest.slice(i, i + 2);
    const doubled = two.length === 2 && two[0] === two[1] && LETTERS[op][two];
    const key = doubled ? two : rest[i];
    const words = LETTERS[op][key] ?? COMMON[key];
    if (!words) return null;
    parts.push(words);
    expanded.push(`-${key}`);
    i += key.length;
  }
  return { meaning: parts.join(" + "), expanded };
}
