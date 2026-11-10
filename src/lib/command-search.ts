// "Describe it, get the command": the reverse of the explainer. Ranks every command the app
// knows — the curated knowledge base, what this machine's own --help taught it, and a short
// list of everyday Arch tasks — against a plain-words description. Offline, no model needed:
// the knowledge base already says in words what each flag does; this matches words to words.
//
// ─── Perfected for fresh Arch beginners ─────────────────────────────────────
//   • RECIPES expanded from 27 → 42, covering the pain points a freshly-installed
//     Arch box hits in its first week: no internet, no sound, wrong resolution,
//     missing fonts, broken bootloader, no video playback, wrong locale/keymap,
//     keyring errors, slow mirrors, hot CPU, full RAM, Bluetooth, "what's my IP".
//   • Each recipe carries `tags` (beginner / network / packages / system /
//     troubleshoot / sound / display / boot / security) used by the new
//     beginner-first tiebreak, so a beginner-tagged task wins ties.
//   • Every existing test still passes (orphan removal, "update everything"
//     top-2, mkdir/df/ss/tar landings, typo tolerance, "bake a chocolate cake"
//     returns [], learned-flag lookup, <30 ms budget).

import { KNOWN_BINARIES, levenshtein, type KbItem } from "./arch-kb";
import { CATALOG, catalogueVersion } from "./commands/catalog";

export interface Match {
  command: string;
  meaning: string;
  tool: string;
  score: number; // 0..1, how much of the description it covers
}

/** Everyday tasks people describe in words, with the command an Arch user would reach for.
 *  `tags` drive the beginner-first tiebreak and (later) the panel's task filter. */
export interface Recipe {
  say: string;
  command: string;
  meaning: string;
  tool: string;
  tags?: string[];
}

export const RECIPES: Recipe[] = [
  // ── the everyday Arch tasks (original 27, now tagged) ──────────────────────
  { say: "update upgrade whole system everything", command: "sudo pacman -Syu", meaning: "refresh the package lists and upgrade every installed package", tool: "pacman", tags: ["beginner", "packages", "system"] },
  { say: "update upgrade system aur everything", command: "yay -Syu", meaning: "full update including AUR packages", tool: "yay", tags: ["beginner", "packages"] },
  { say: "install package", command: "sudo pacman -Syu --needed <package>", meaning: "install a package from the official repositories", tool: "pacman", tags: ["beginner", "packages"] },
  { say: "install aur package", command: "yay -Syu --needed <package>", meaning: "install a package from the AUR", tool: "yay", tags: ["beginner", "packages"] },
  { say: "remove package dependency config", command: "sudo pacman -Rns <package>", meaning: "remove a package, the dependencies only it needed, and its backup config files", tool: "pacman", tags: ["beginner", "packages"] },
  { say: "remove orphan package nothing need", command: "sudo pacman -Rns $(pacman -Qtdq)", meaning: "remove every orphan: packages installed as dependencies that nothing needs any more", tool: "pacman", tags: ["beginner", "packages", "troubleshoot"] },
  { say: "list orphan package nothing need", command: "pacman -Qtdq", meaning: "list orphans: installed as dependencies, needed by nothing", tool: "pacman", tags: ["beginner", "packages"] },
  { say: "list explicit package install myself", command: "pacman -Qqe", meaning: "list the packages you installed on purpose", tool: "pacman", tags: ["beginner", "packages"] },
  { say: "list aur foreign package", command: "pacman -Qqm", meaning: "list packages not from the official repositories (AUR and manual installs)", tool: "pacman", tags: ["beginner", "packages"] },
  { say: "mark package explicit keep", command: "sudo pacman -D --asexplicit <package>", meaning: "mark a package as installed on purpose, so no orphan clean-up removes it", tool: "pacman", tags: ["beginner", "packages"] },
  { say: "mark package dependency", command: "sudo pacman -D --asdeps <package>", meaning: "mark a package as a dependency (it becomes an orphan if nothing needs it)", tool: "pacman", tags: ["beginner", "packages"] },
  { say: "which package own file", command: "pacman -Qo <file>", meaning: "find the installed package that owns a file", tool: "pacman", tags: ["beginner", "packages"] },
  { say: "list file package", command: "pacman -Ql <package>", meaning: "list every file an installed package put on the system", tool: "pacman", tags: ["beginner", "packages"] },
  { say: "package info detail version depend", command: "pacman -Qi <package>", meaning: "show an installed package's details: version, dependencies, what requires it", tool: "pacman", tags: ["beginner", "packages"] },
  { say: "search package find name", command: "pacman -Ss <words>", meaning: "search the official repositories by name and description", tool: "pacman", tags: ["beginner", "packages"] },
  { say: "clean cache old package space", command: "sudo paccache -rk2", meaning: "delete cached package files, keeping the two newest versions of each", tool: "system", tags: ["beginner", "packages", "troubleshoot"] },
  { say: "clean cache uninstalled package", command: "sudo paccache -ruk0", meaning: "delete cached files of packages that are no longer installed", tool: "system", tags: ["beginner", "packages"] },
  { say: "mirror fast refresh rank", command: "sudo reflector --latest 10 --sort rate --save /etc/pacman.d/mirrorlist", meaning: "pick the fastest recent mirrors and save them", tool: "system", tags: ["beginner", "packages", "troubleshoot"] },
  { say: "rebuild initramfs kernel boot image", command: "sudo mkinitcpio -P", meaning: "rebuild the boot image for every installed kernel", tool: "system", tags: ["beginner", "boot"] },
  { say: "service start enable boot now", command: "sudo systemctl enable --now <service>", meaning: "start a service now and every boot", tool: "systemctl", tags: ["beginner", "system"] },
  { say: "service stop disable boot", command: "sudo systemctl disable --now <service>", meaning: "stop a service and keep it from starting at boot", tool: "systemctl", tags: ["beginner", "system"] },
  { say: "service status running", command: "systemctl status <service>", meaning: "show whether a service is running, with its latest log lines", tool: "systemctl", tags: ["beginner", "system"] },
  { say: "service fail broken list", command: "systemctl --failed", meaning: "list services that failed to start", tool: "systemctl", tags: ["beginner", "system", "troubleshoot"] },
  { say: "log service error boot", command: "journalctl -u <service> -b", meaning: "show a service's log since this boot", tool: "journalctl", tags: ["beginner", "system", "troubleshoot"] },
  { say: "log error boot", command: "journalctl -p err -b", meaning: "show only errors logged since this boot", tool: "journalctl", tags: ["beginner", "system", "troubleshoot"] },
  { say: "disk space usage", command: "df -h", meaning: "show free and used space on every mounted disk", tool: "system", tags: ["beginner", "system"] },
  { say: "keyring fix signature key", command: "sudo pacman -Sy archlinux-keyring && sudo pacman -Syu", meaning: "get the newest keys pacman uses to check package signatures, then update everything (the keys go first, so the update can be checked)", tool: "pacman", tags: ["beginner", "packages", "security", "troubleshoot"] },

  // ── fresh-Arch pain points (new, 15) ────────────────────────────────────────
  // networking & connectivity
  { say: "no internet wifi connect network", command: "nmcli device wifi list", meaning: "list the Wi-Fi networks around you, with signal strength", tool: "system", tags: ["beginner", "network", "troubleshoot"] },
  { say: "ethernet cable no internet network", command: "ip link", meaning: "show every network interface and whether it is up or down", tool: "system", tags: ["beginner", "network", "troubleshoot"] },
  { say: "what is my ip address", command: "ip -br a", meaning: "show each network interface with its address, one per line", tool: "system", tags: ["beginner", "network"] },
  { say: "bluetooth not connecting", command: "systemctl status bluetooth", meaning: "check whether the Bluetooth service is running, with its last log lines", tool: "systemctl", tags: ["beginner", "network", "troubleshoot"] },
  // audio
  { say: "no sound audio mute", command: "wpctl status", meaning: "list audio devices and which output is the default (PipeWire)", tool: "system", tags: ["beginner", "sound", "troubleshoot"] },
  // display
  { say: "screen resolution display wrong", command: "xrandr", meaning: "list displays and the resolutions each supports", tool: "system", tags: ["beginner", "display", "troubleshoot"] },
  { say: "fonts missing ugly look", command: "fc-list | head", meaning: "list the fonts installed on the system (first ten)", tool: "system", tags: ["beginner", "display"] },
  // boot
  { say: "bootloader systemd-boot status", command: "bootctl status", meaning: "check whether systemd-boot is installed and which entries it sees", tool: "system", tags: ["beginner", "boot", "troubleshoot"] },
  // media
  { say: "video playback mp4 codec missing", command: "sudo pacman -Syu --needed gstreamer gst-plugins-good gst-plugins-bad gst-plugins-ugly gst-libav", meaning: "install the common GStreamer codecs so most video and audio files play", tool: "pacman", tags: ["beginner", "packages"] },
  // locale / keymap
  { say: "locale keyboard wrong language", command: "localectl status", meaning: "show the current locale and keyboard layout", tool: "system", tags: ["beginner", "system", "troubleshoot"] },
  // keyring & mirrors
  { say: "keyring signature gpg invalid error", command: "sudo pacman-key --init && sudo pacman-key --populate", meaning: "re-initialise pacman's keyring and reload the official keys (fixes signature errors)", tool: "system", tags: ["beginner", "packages", "security", "troubleshoot"] },
  { say: "download slow mirror speed", command: "sudo reflector --latest 20 --sort rate --save /etc/pacman.d/mirrorlist", meaning: "pick the 20 fastest recent mirrors and save them as pacman's mirror list", tool: "system", tags: ["beginner", "packages", "troubleshoot"] },
  // performance
  { say: "high cpu slow hot fan", command: "top", meaning: "show what is using the computer right now, busiest first (q quits)", tool: "system", tags: ["beginner", "system", "troubleshoot"] },
  { say: "memory ram full swap", command: "free -h", meaning: "show memory and swap usage in G and M", tool: "system", tags: ["beginner", "system", "troubleshoot"] },
  // file-package lookup (when -Qo can't help, the file isn't installed)
  { say: "which package provides file", command: "pacman -F <file>", meaning: "search the files database for the package that provides a file (sync db)", tool: "pacman", tags: ["beginner", "packages"] },
];

/** Words that mean the same thing for this purpose, folded to one. */
const SYNONYMS: Record<string, string> = {
  uninstall: "remove", delete: "remove", erase: "remove", purge: "remove", rid: "remove", drop: "remove",
  upgrade: "update", refresh: "update", sync: "update", newest: "update", latest: "update",
  add: "install", get: "install", download: "install", setup: "install",
  clear: "clean", wipe: "clean", tidy: "clean", free: "clean", cleanup: "clean",
  unused: "orphan", unneeded: "orphan", leftover: "orphan", orphaned: "orphan", abandoned: "orphan",
  show: "list", display: "list", see: "list", print: "list", view: "list",
  find: "search", look: "search", lookup: "search",
  app: "package", apps: "package", program: "package", software: "package", pkg: "package", application: "package",
  daemon: "service", unit: "service", units: "service",
  journal: "log", logs: "log",
  manually: "explicit", purpose: "explicit", explicitly: "explicit", deliberately: "explicit",
  deps: "dependency", dependencies: "dependency", depend: "dependency", requires: "dependency",
  owns: "own", owner: "own", belong: "own", belongs: "own",
  everything: "system", all: "system",
  broken: "fail", failed: "fail", crash: "fail",
  storage: "disk", space: "disk",
  directory: "folder", directories: "folder", dir: "folder", dirs: "folder",
  make: "create", mk: "create", new: "create", creating: "create",
  rename: "move",
  permission: "permission", permissions: "permission", rights: "permission", access: "permission",
  superuser: "root", administrator: "root", admin: "root",
  internet: "network", online: "network", wifi: "network", wireless: "network",
  ram: "memory",
  extract: "unpack", decompress: "unpack", uncompress: "unpack",
};

const STOP = new Set([
  "a", "an", "the", "to", "of", "and", "or", "for", "in", "on", "my", "me", "i", "it", "is", "that", "this", "with",
  "how", "do", "can", "want", "would", "like", "please", "from", "which", "what", "every", "any", "some", "its",
  "be", "by", "as", "at", "so", "only", "not", "no", "them", "they", "you", "your", "are", "was", "will", "then",
]);

/** A word's root, the same for its forms: file/files, package/packages, update/updated/updating,
 *  fix/fixes, process/processes. (Dropping "es" whole made "files" fil but "file" file.) */
export function stem(w: string): string {
  let s = w;
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  if (s.length > 3 && s.endsWith("e")) s = s.slice(0, -1);
  return s;
}

/** The synonym a word means, forgiving one typo in longer words ("uninstal" → remove). */
function fold(w: string): string {
  // a synonym's word goes through stem too, like every word it must meet ("remove" → remov)
  const exact = SYNONYMS[w] ?? SYNONYMS[stem(w)];
  if (exact) return stem(exact);
  if (w.length >= 6) {
    const near = Object.keys(SYNONYMS).find((k) => k.length >= 6 && levenshtein(k, w) <= 1);
    if (near) return stem(SYNONYMS[near]);
  }
  return stem(w);
}

export function terms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+-]+/)
    .filter((w) => w && !STOP.has(w) && !w.startsWith("-"))
    .map(fold);
}

interface Doc {
  command: string;
  meaning: string;
  tool: string;
  words: Set<string>;
  tags: Set<string>;
  complete: number; // 2 = an everyday task, 1 = a knowledge-base example, 0 = a bare flag
  said?: Set<string>; // a recipe's own phrase ("install package"): what it is FOR, not words in its description
}

function corpus(dynamic: Record<string, KbItem[]>): Doc[] {
  const docs: Doc[] = RECIPES.map((r) => ({
    ...r,
    words: new Set(terms(`${r.say} ${r.meaning}`)),
    tags: new Set(r.tags ?? []),
    complete: 2,
    said: new Set(terms(r.say)),
  }));
  // the catalogue: each command itself (what it does, the words people use), and its examples
  for (const c of CATALOG) {
    const words = `${c.name} ${c.what} ${c.words.join(" ")}`;
    // the bare name ranks like an example: a ready everyday task comes first
    docs.push({ command: c.name, meaning: c.what, tool: c.name, words: new Set(terms(words)), tags: new Set(), complete: 1 });
    for (const e of c.examples) {
      docs.push({ command: e.command, meaning: e.meaning, tool: c.name, words: new Set(terms(`${e.meaning} ${c.words.join(" ")} ${c.name}`)), tags: new Set(), complete: 1 });
    }
  }
  for (const tool of KNOWN_BINARIES) {
    const items = [...tool.items, ...(dynamic[tool.binary] ?? [])];
    for (const it of items) {
      const command = it.example ?? (tool.binary === "system" ? it.token : `${tool.binary} ${it.token}`);
      docs.push({
        command,
        meaning: it.meaning,
        tool: tool.label,
        // a subcommand's own name is a word people search with ("clone", "enable")
        words: new Set(terms(`${it.meaning} ${tool.binary} ${it.kind === "sub" ? it.token : ""}`)),
        tags: new Set(),
        complete: it.example ? 1 : 0,
      });
    }
  }
  return docs;
}

interface Index {
  docs: Doc[];
  df: Map<string, number>; // how many commands mention each word
}

// built once per set of learned flags, not on every keystroke
const indexes = new WeakMap<Record<string, KbItem[]>, Index & { v: number }>();
const EMPTY: Record<string, KbItem[]> = {};

function indexFor(dynamic: Record<string, KbItem[]>): Index {
  let ix = indexes.get(dynamic);
  if (!ix || ix.v !== catalogueVersion()) {
    const docs = corpus(dynamic);
    const df = new Map<string, number>();
    for (const d of docs) for (const w of d.words) df.set(w, (df.get(w) ?? 0) + 1);
    ix = { docs, df, v: catalogueVersion() };
    indexes.set(dynamic, ix);
  }
  return ix;
}

/**
 * What the words name exactly: a command (`which`, `pacman`), a flag (`-Syyu`, `--needed`;
 * case counts: -S is not -s) or a subcommand of a tool Fluff knows (`clone`). A flag may be
 * typed without its dashes when it is the only word (`Syyu`, `needed`).
 */
export function named(description: string, dynamic: Record<string, KbItem[]> = EMPTY): Match[] {
  const words = description.trim().split(/\s+/).filter(Boolean);
  const out: Match[] = [];
  const add = (m: Match) => out.some((x) => x.command === m.command) || out.push(m);
  // a sentence ("which package owns this file") names no command; one word, or a command
  // followed by its flags ("pacman -Syyu"), does
  const commandLike = words.length === 1 || words.slice(1).some((w) => w.startsWith("-"));
  for (const w of words) {
    const doc = commandLike ? CATALOG.find((c) => c.name === w.toLowerCase()) : undefined;
    if (doc) add({ command: doc.name, meaning: doc.what, tool: doc.name, score: 1 });
    const tool = commandLike ? KNOWN_BINARIES.find((t) => t.binary === w.toLowerCase()) : undefined;
    if (tool && !doc) add({ command: tool.binary, meaning: tool.label, tool: tool.binary, score: 1 });
    const forms = w.startsWith("-") ? [w] : words.length === 1 && /^[A-Za-z][A-Za-z-]*$/.test(w) ? [w, `-${w}`, `--${w}`] : [w];
    for (const t of KNOWN_BINARIES)
      for (const it of [...t.items, ...(dynamic[t.binary] ?? [])])
        if (forms.includes(it.token) && (it.token.startsWith("-") || (commandLike && it.kind === "sub")))
          add({ command: t.binary === "system" ? it.token : `${t.binary} ${it.token}`, meaning: it.meaning, tool: t.binary, score: 1 });
  }
  return out;
}

export function searchCommands(description: string, dynamic: Record<string, KbItem[]> = EMPTY, limit = 6): Match[] {
  const exact = named(description, dynamic);
  const rest = described(description, dynamic, limit).filter((m) => !exact.some((e) => e.command === m.command));
  return [...exact, ...rest].slice(0, Math.max(limit, Math.min(exact.length, 12)));
}

/** The plain-words search: every command the app knows, ranked against the description. */
function described(description: string, dynamic: Record<string, KbItem[]>, limit: number): Match[] {
  const q = [...new Set(terms(description))];
  if (!q.length) return [];
  const { docs, df } = indexFor(dynamic);
  // rarer words say more: weight each query word by how few commands mention it
  const weight = new Map(q.map((w) => [w, Math.log(1 + docs.length / (1 + (df.get(w) ?? 0)))]));
  const total = [...weight.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  // a near spelling counts only for a word no command uses as it is ("clone" is not "close")
  const fuzzy = new Set(q.filter((w) => w.length >= 5 && !df.has(w)));

  const hit = (doc: Doc, w: string) =>
    doc.words.has(w) || (fuzzy.has(w) && [...doc.words].some((d) => d.length >= 5 && levenshtein(d, w) <= 1));
  // the words typed that are in the command itself ("git clone …" for "clone")
  // (the command's words go through the same stem as the typed ones: "<package>" meets "packages")
  const literal = (d: Doc) => {
    const own = d.command.toLowerCase().split(/[^a-z0-9-]+/).map(stem);
    return q.filter((w) => own.includes(w)).length;
  };
  // beginner-tagged recipes win ties — a fresh archer's "no internet" should outrank a stray flag match
  const beginnerBonus = (d: Doc) => (d.tags.has("beginner") ? 1 : 0);
  // the words typed that are what a recipe is for ("install package" is the install recipe's
  // phrase; "installed" in -Ql's description stems to "install" too, but -Ql is for listing)
  // how much of the recipe's phrase was typed: "install package" is all of the install
  // recipe's phrase, but only two of "install aur package"'s three words
  const said = (d: Doc) => (d.said?.size ? q.filter((w) => d.said!.has(w)).length / d.said.size : 0);

  const seen = new Set<string>();
  return docs
    .map((d) => {
      const covered = q.filter((w) => hit(d, w));
      return { d, score: covered.reduce((s, w) => s + (weight.get(w) ?? 0), 0) / total };
    })
    .filter((x) => x.score > 0.2)
    // on a tie: beginner-tagged first, then words typed in the command itself,
    // then a runnable task, an example, a lone flag; then the shorter
    .sort(
      (a, b) =>
        b.score - a.score ||
        said(b.d) - said(a.d) ||
        beginnerBonus(b.d) - beginnerBonus(a.d) ||
        literal(b.d) - literal(a.d) ||
        b.d.complete - a.d.complete ||
        a.d.command.length - b.d.command.length
    )
    .filter((x) => !seen.has(x.d.command) && seen.add(x.d.command))
    .slice(0, limit)
    .map((x) => ({ command: x.d.command, meaning: x.d.meaning, tool: x.d.tool, score: Math.round(x.score * 100) / 100 }));
}
