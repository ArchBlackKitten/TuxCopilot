// Curated Arch Linux knowledge base for the "Arch Commands" explainer.
// Merged at runtime with entries discovered from the machine itself
// (`<tool> --help` parsing in arch-sync.ts → the kb_entry table).

export type KbKind = "flag" | "sub";

export interface KbItem {
  token: string; // "-S", "--sync", "clone", "enable", "mkinitcpio", …
  kind: KbKind;
  meaning: string;
  example?: string;
}

export interface ToolKb {
  binary: string; // as typed in a shell
  label: string;
  blurb: string;
  color: string;
  bundledShortFlags: boolean; // pacman-style: -Syu == -S -y -u
  subFirst: boolean; // git/systemctl style: subcommand is the first arg
  items: KbItem[];
}

export const KNOWN_BINARIES: ToolKb[] = [
  {
    binary: "pacman",
    label: "pacman",
    blurb: "Arch's package manager — official repositories",
    color: "text-sky-400",
    bundledShortFlags: true,
    subFirst: false,
    items: [
      { token: "-S", kind: "flag", meaning: "sync — install package(s) from the repositories", example: "sudo pacman -Syu --needed git" },
      { token: "-y", kind: "flag", meaning: "refresh — download fresh package databases from servers" },
      { token: "-yy", kind: "flag", meaning: "force-refresh the databases even if they appear current (fixes stale/inconsistent db files)" },
      { token: "-u", kind: "flag", meaning: "sysupgrade — upgrade every installed package" },
      { token: "-uu", kind: "flag", meaning: "upgrade, and allow DOWNGRADES to match the sync databases (recovery / repo switching)" },
      { token: "-Syu", kind: "flag", meaning: "refresh databases + full-system upgrade — the normal full update" },
      { token: "-Syy", kind: "flag", meaning: "force-refresh databases (no upgrades)" },
      { token: "-Syyu", kind: "flag", meaning: "force refresh + full upgrade" },
      { token: "-Syyuu", kind: "flag", meaning: "force refresh + upgrade/downgrade as needed to match sync dbs — recovery, not routine" },
      { token: "-s", kind: "flag", meaning: "search the remote repositories (name + description)" },
      { token: "-i", kind: "flag", meaning: "show info about a package" },
      { token: "-w", kind: "flag", meaning: "download only — don't install" },
      { token: "-q", kind: "flag", meaning: "quiet — print names only" },
      { token: "-c", kind: "flag", meaning: "clean old packages from the cache (-cc clears everything)" },
      { token: "-R", kind: "flag", meaning: "remove package(s)" },
      { token: "-n", kind: "flag", meaning: "with -R: also remove config files that would be saved (.pacsave)" },
      { token: "-Q", kind: "flag", meaning: "query the local (installed) package database" },
      { token: "-e", kind: "flag", meaning: "explicitly installed packages (not pulled as deps)" },
      { token: "-d", kind: "flag", meaning: "restrict to dependencies" },
      { token: "-t", kind: "flag", meaning: "packages not required by anything (use with -Qdt for orphans)" },
      { token: "-l", kind: "flag", meaning: "list files owned by a package" },
      { token: "-o", kind: "flag", meaning: "which package owns this file?" },
      { token: "-x", kind: "flag", meaning: "regex match (with -Q or -S)" },
      { token: "-F", kind: "flag", meaning: "query the files database — find which package provides a file" },
      { token: "-U", kind: "flag", meaning: "install/upgrade from a local .pkg.tar.zst file" },
      { token: "-D", kind: "flag", meaning: "modify the install database (e.g. --asdeps / --asexplicit)" },
      { token: "-T", kind: "flag", meaning: "dependency test — check if deps are satisfied, install nothing" },
      { token: "-h", kind: "flag", meaning: "help" },
      { token: "--sync", kind: "flag", meaning: "long form of -S" },
      { token: "--refresh", kind: "flag", meaning: "long form of -y" },
      { token: "--sysupgrade", kind: "flag", meaning: "long form of -u" },
      { token: "--search", kind: "flag", meaning: "long form of -s" },
      { token: "--info", kind: "flag", meaning: "long form of -i" },
      { token: "--remove", kind: "flag", meaning: "long form of -R" },
      { token: "--query", kind: "flag", meaning: "long form of -Q" },
      { token: "--clean", kind: "flag", meaning: "long form of -c" },
      { token: "--list", kind: "flag", meaning: "long form of -l" },
      { token: "--owns", kind: "flag", meaning: "long form of -o" },
      { token: "--upgrade", kind: "flag", meaning: "long form of -U (local file install)" },
      { token: "--needed", kind: "flag", meaning: "skip packages that are already up to date" },
      { token: "--asdeps", kind: "flag", meaning: "install but mark as dependency" },
      { token: "--asexplicit", kind: "flag", meaning: "mark package as explicitly installed" },
      { token: "--noconfirm", kind: "flag", meaning: "answer yes to every prompt (scripted installs)" },
      { token: "--force", kind: "flag", meaning: "overwrite conflicting files — risky, use only when sure" },
      { token: "--dbonly", kind: "flag", meaning: "touch only the database, not the filesystem" },
      { token: "--ignore", kind: "flag", meaning: "skip a package during this operation", example: "--ignore linux" },
      { token: "--overwrite", kind: "flag", meaning: "overwrite files matching a glob", example: "--overwrite '/usr/share/*'" },
      { token: "--assume-installed", kind: "flag", meaning: "pretend a dependency is installed" },
      { token: "--disable-download-timeout", kind: "flag", meaning: "no timeout on downloads (slow mirrors)" },
    ],
  },
  {
    binary: "yay",
    label: "yay",
    blurb: "AUR helper — repos + Arch User Repository",
    color: "text-amber-400",
    bundledShortFlags: true,
    subFirst: false,
    items: [
      { token: "-S", kind: "flag", meaning: "install from repos + AUR (pacman -S superset)", example: "yay -Syu --needed google-chrome" },
      { token: "-y", kind: "flag", meaning: "refresh repo databases + AUR" },
      { token: "-u", kind: "flag", meaning: "upgrade all installed packages (repos + AUR)" },
      { token: "-Syu", kind: "flag", meaning: "full-system update including AUR — the normal yay update" },
      { token: "-Sua", kind: "flag", meaning: "upgrade AUR packages only" },
      { token: "-a", kind: "flag", meaning: "AUR-only scope (as in -Sua)" },
      { token: "-s", kind: "flag", meaning: "search repos + AUR at once" },
      { token: "-i", kind: "flag", meaning: "show package info" },
      { token: "-c", kind: "flag", meaning: "with -Y: remove unneeded dependencies (autoremove)" },
      { token: "-Y", kind: "flag", meaning: "yay-mode: yay-specific operations (clean, stats…)" },
      { token: "-P", kind: "flag", meaning: "print — -Ps shows system stats, -Pw shows Arch news" },
      { token: "-G", kind: "flag", meaning: "download a PKGBUILD from the AUR", example: "yay -G brave-bin" },
      { token: "-B", kind: "flag", meaning: "build/download queue operations (-Bd build from queue)" },
      { token: "-Ps", kind: "flag", meaning: "print installed-packages / system statistics" },
      { token: "-Pw", kind: "flag", meaning: "print recent Arch news (read before updating!)" },
      { token: "-Yc", kind: "flag", meaning: "remove unneeded dependencies (AUR autoremove)" },
      { token: "-Bi", kind: "flag", meaning: "build a local PKGBUILD directory and install the result" },
      { token: "--repo", kind: "flag", meaning: "restrict to official repos only" },
      { token: "--aur", kind: "flag", meaning: "restrict to AUR only" },
      { token: "--devel", kind: "flag", meaning: "also check -git/-svn/-hg development packages" },
      { token: "--needed", kind: "flag", meaning: "skip packages that are already up to date" },
      { token: "--noconfirm", kind: "flag", meaning: "answer prompts automatically" },
      { token: "--editmenu", kind: "flag", meaning: "offer to edit PKGBUILDs before building" },
      { token: "--answerdiff", kind: "flag", meaning: "auto-answer the diff prompt (e.g. --answerdiff None)" },
      { token: "--answerclean", kind: "flag", meaning: "auto-answer the clean-build prompt" },
      { token: "--removemake", kind: "flag", meaning: "remove make dependencies after the build" },
      { token: "--save", kind: "flag", meaning: "persist these flags into yay's config" },
      { token: "--mend", kind: "flag", meaning: "re-run and fix the previous yay operation" },
    ],
  },
  {
    binary: "git",
    label: "git",
    blurb: "version control (and how GitHub apps get cloned)",
    color: "text-violet-400",
    bundledShortFlags: false,
    subFirst: true,
    items: [
      { token: "init", kind: "sub", meaning: "create an empty repository in the current folder" },
      { token: "clone", kind: "sub", meaning: "download a repository (e.g. from GitHub) with full history", example: "git clone https://github.com/user/repo" },
      { token: "add", kind: "sub", meaning: "stage files for the next commit" },
      { token: "commit", kind: "sub", meaning: "record staged changes as a snapshot", example: "git commit -m \"msg\"" },
      { token: "status", kind: "sub", meaning: "show staged/modified/untracked files" },
      { token: "log", kind: "sub", meaning: "show commit history" },
      { token: "diff", kind: "sub", meaning: "show what changed (unstaged by default)" },
      { token: "push", kind: "sub", meaning: "upload local commits to the remote", example: "git push origin main" },
      { token: "pull", kind: "sub", meaning: "fetch + merge the remote into your branch" },
      { token: "fetch", kind: "sub", meaning: "download remote changes without merging" },
      { token: "merge", kind: "sub", meaning: "merge another branch into the current one" },
      { token: "rebase", kind: "sub", meaning: "replay commits on top of another base" },
      { token: "branch", kind: "sub", meaning: "list / create / delete branches" },
      { token: "checkout", kind: "sub", meaning: "switch branches or restore files (classic form)" },
      { token: "switch", kind: "sub", meaning: "switch branches (modern form)" },
      { token: "restore", kind: "sub", meaning: "discard working-tree changes" },
      { token: "reset", kind: "sub", meaning: "move HEAD and optionally rewrite the working tree" },
      { token: "revert", kind: "sub", meaning: "undo a commit with a new inverse commit (safe)" },
      { token: "cherry-pick", kind: "sub", meaning: "apply one specific commit onto the current branch" },
      { token: "stash", kind: "sub", meaning: "park dirty changes and get a clean tree (stash pop to restore)" },
      { token: "tag", kind: "sub", meaning: "create / list tags (release points)" },
      { token: "remote", kind: "sub", meaning: "manage the URLs remotes point to" },
      { token: "show", kind: "sub", meaning: "show one commit / object in detail" },
      { token: "blame", kind: "sub", meaning: "who last touched each line" },
      { token: "rm", kind: "sub", meaning: "remove tracked files" },
      { token: "mv", kind: "sub", meaning: "move/rename tracked files" },
      { token: "config", kind: "sub", meaning: "get/set configuration (user.name, …)" },
      { token: "gc", kind: "sub", meaning: "garbage-collect and compact the repo" },
      { token: "worktree", kind: "sub", meaning: "check out multiple working trees at once" },
      { token: "bisect", kind: "sub", meaning: "binary-search the commit that introduced a bug" },
      { token: "submodule", kind: "sub", meaning: "manage nested repositories" },
      { token: "-m", kind: "flag", meaning: "message (commit -m \"text\")" },
      { token: "-a", kind: "flag", meaning: "all (stage every tracked change)" },
      { token: "-d", kind: "flag", meaning: "delete (branch -d)" },
      { token: "-u", kind: "flag", meaning: "set-upstream (push -u origin main)" },
      { token: "-b", kind: "flag", meaning: "create+switch new branch" },
      { token: "--amend", kind: "flag", meaning: "fold changes into the last commit" },
      { token: "--force", kind: "flag", meaning: "overwrite remote/history — destructive" },
      { token: "--force-with-lease", kind: "flag", meaning: "force but abort if someone else pushed meanwhile (safer)" },
      { token: "--no-ff", kind: "flag", meaning: "keep a merge commit even if fast-forward possible" },
      { token: "--ff-only", kind: "flag", meaning: "refuse to merge unless fast-forward" },
      { token: "--squash", kind: "flag", meaning: "combine branch commits into one" },
      { token: "--hard", kind: "flag", meaning: "reset working tree too — discards changes" },
      { token: "--soft", kind: "flag", meaning: "keep changes staged after reset" },
      { token: "--staged", kind: "flag", meaning: "operate on staged content only" },
      { token: "--cached", kind: "flag", meaning: "staged content (same as --staged)" },
      { token: "--global", kind: "flag", meaning: "user-level config (~/.gitconfig)" },
      { token: "--prune", kind: "flag", meaning: "drop remote-tracking refs that vanished" },
      { token: "--rebase", kind: "flag", meaning: "pull with rebase instead of merge" },
      { token: "--depth", kind: "flag", meaning: "shallow clone N commits (--depth 1 = fast)" },
      { token: "--graph", kind: "flag", meaning: "draw branch topology in log" },
      { token: "--oneline", kind: "flag", meaning: "one line per commit" },
      { token: "--all", kind: "flag", meaning: "all refs/branches" },
      { token: "--dry-run", kind: "flag", meaning: "show what would happen, do nothing" },
      { token: "--continue", kind: "flag", meaning: "resume after resolving (rebase/merge/cherry-pick)" },
      { token: "--abort", kind: "flag", meaning: "cancel the in-progress operation" },
      { token: "--set-upstream", kind: "flag", meaning: "link branch to its remote (long form of -u)" },
    ],
  },
  {
    binary: "systemctl",
    label: "systemctl",
    blurb: "control systemd services (units)",
    color: "text-emerald-400",
    bundledShortFlags: false,
    subFirst: true,
    items: [
      { token: "start", kind: "sub", meaning: "start a unit now", example: "sudo systemctl start NetworkManager" },
      { token: "stop", kind: "sub", meaning: "stop a running unit" },
      { token: "restart", kind: "sub", meaning: "stop then start a unit" },
      { token: "reload", kind: "sub", meaning: "re-read the unit's config without restarting" },
      { token: "status", kind: "sub", meaning: "is it running? last logs, enabled state" },
      { token: "enable", kind: "sub", meaning: "start automatically at boot" },
      { token: "disable", kind: "sub", meaning: "no longer start at boot" },
      { token: "mask", kind: "sub", meaning: "completely forbid a unit from starting (even manually)" },
      { token: "unmask", kind: "sub", meaning: "undo a mask" },
      { token: "is-active", kind: "sub", meaning: "scriptable: is the unit running?" },
      { token: "is-enabled", kind: "sub", meaning: "scriptable: will it start at boot?" },
      { token: "list-units", kind: "sub", meaning: "list loaded units and their state" },
      { token: "list-unit-files", kind: "sub", meaning: "list installed unit files" },
      { token: "list-timers", kind: "sub", meaning: "list timer units (cron-like)" },
      { token: "daemon-reload", kind: "sub", meaning: "reload unit files after editing .service files" },
      { token: "cat", kind: "sub", meaning: "print the unit file contents" },
      { token: "edit", kind: "sub", meaning: "open a drop-in override for the unit" },
      { token: "show", kind: "sub", meaning: "show low-level unit properties" },
      { token: "kill", kind: "sub", meaning: "send a signal to the unit's processes" },
      { token: "reboot", kind: "sub", meaning: "reboot the machine" },
      { token: "poweroff", kind: "sub", meaning: "power the machine off" },
      { token: "suspend", kind: "sub", meaning: "suspend to RAM" },
      { token: "hibernate", kind: "sub", meaning: "suspend to disk" },
      { token: "--now", kind: "flag", meaning: "also start/stop immediately (enable --now = enable + start)" },
      { token: "--user", kind: "flag", meaning: "operate on your user units, not system ones" },
      { token: "--failed", kind: "flag", meaning: "show only failed units" },
      { token: "--type", kind: "flag", meaning: "filter by unit type (-t service/timer/socket)" },
      { token: "--state", kind: "flag", meaning: "filter by state (active, failed…)" },
      { token: "--all", kind: "flag", meaning: "include inactive units too" },
      { token: "--no-pager", kind: "flag", meaning: "print without less" },
      { token: "--full", kind: "flag", meaning: "don't truncate long lines (-l)" },
    ],
  },
  {
    binary: "journalctl",
    label: "journalctl",
    blurb: "read the systemd journal (logs)",
    color: "text-orange-400",
    bundledShortFlags: false,
    subFirst: false,
    items: [
      { token: "-x", kind: "flag", meaning: "add helpful explanations to log lines" },
      { token: "-e", kind: "flag", meaning: "jump to the end of the journal" },
      { token: "-xe", kind: "flag", meaning: "end of journal + explanations — the classic 'why did it fail' command" },
      { token: "-u", kind: "flag", meaning: "logs of one unit", example: "journalctl -u sddm" },
      { token: "-f", kind: "flag", meaning: "follow — live tail like tail -f" },
      { token: "-b", kind: "flag", meaning: "this boot (-b -1 = previous boot)" },
      { token: "-k", kind: "flag", meaning: "kernel messages only" },
      { token: "-p", kind: "flag", meaning: "priority filter (-p err = errors and worse)" },
      { token: "-n", kind: "flag", meaning: "number of lines to show (-n 50)" },
      { token: "-r", kind: "flag", meaning: "reverse — newest first" },
      { token: "-o", kind: "flag", meaning: "output format (-o json, -o short-precise)" },
      { token: "--since", kind: "flag", meaning: "start time (--since today / '2024-01-01 10:00')" },
      { token: "--until", kind: "flag", meaning: "end time" },
      { token: "--disk-usage", kind: "flag", meaning: "how much space the journal occupies" },
      { token: "--vacuum-time", kind: "flag", meaning: "delete journal entries older than X (--vacuum-time 2weeks)" },
      { token: "--vacuum-size", kind: "flag", meaning: "shrink journal to a size cap" },
      { token: "--no-pager", kind: "flag", meaning: "print without less" },
    ],
  },
  {
    binary: "system",
    label: "arch environment",
    blurb: "core Arch system tools — initramfs, mirrors, disks, networking",
    color: "text-rose-400",
    bundledShortFlags: false,
    subFirst: false,
    items: [
      { token: "mkinitcpio", kind: "sub", meaning: "regenerate the initramfs (after kernel or hook changes)", example: "sudo mkinitcpio -P" },
      { token: "-P", kind: "flag", meaning: "build all presets (all kernels)" },
      { token: "-p", kind: "flag", meaning: "build one preset (-p linux)" },
      { token: "reflector", kind: "sub", meaning: "rank and refresh pacman mirrors", example: "sudo reflector --country US --latest 10 --sort rate --save /etc/pacman.d/mirrorlist" },
      { token: "--country", kind: "flag", meaning: "limit mirror countries" },
      { token: "--latest", kind: "flag", meaning: "use the N most recently synced mirrors" },
      { token: "--sort", kind: "flag", meaning: "order by rate/age/score" },
      { token: "--save", kind: "flag", meaning: "write result to a file (usually /etc/pacman.d/mirrorlist)" },
      { token: "pacman-key", kind: "sub", meaning: "manage pacman's PGP keyring", example: "sudo pacman-key --init" },
      { token: "--init", kind: "flag", meaning: "initialize the keyring (fresh installs)" },
      { token: "--populate", kind: "flag", meaning: "reload official keyring keys (fixes signature errors)" },
      { token: "--recv-keys", kind: "flag", meaning: "fetch a missing key from a keyserver" },
      { token: "paccache", kind: "sub", meaning: "smart pacman cache cleaner", example: "sudo paccache -rk1" },
      { token: "-r", kind: "flag", meaning: "remove old cached versions" },
      { token: "-k", kind: "flag", meaning: "keep N versions (-rk1 keeps one)" },
      { token: "-ruk0", kind: "flag", meaning: "delete all cached versions of uninstalled packages" },
      { token: "pacdiff", kind: "sub", meaning: "review .pacnew/.pacsave config conflicts after updates" },
      { token: "checkupdates", kind: "sub", meaning: "list available updates WITHOUT touching the databases (from pacman-contrib)" },
      { token: "makepkg", kind: "sub", meaning: "build a package from a PKGBUILD", example: "makepkg -si" },
      { token: "-si", kind: "flag", meaning: "build, install, and pull missing deps" },
      { token: "namcap", kind: "sub", meaning: "lint a built package / PKGBUILD" },
      { token: "pacstrap", kind: "sub", meaning: "install packages into a new root (arch install step)" },
      { token: "genfstab", kind: "sub", meaning: "generate /etc/fstab from mounted filesystems (-U for UUIDs)" },
      { token: "arch-chroot", kind: "sub", meaning: "chroot into an installed system (rescue/installs)" },
      { token: "lsblk", kind: "sub", meaning: "list block devices and partitions as a tree" },
      { token: "blkid", kind: "sub", meaning: "show UUIDs/filesystems of block devices" },
      { token: "fdisk", kind: "sub", meaning: "partition a disk (interactive; -l to list)" },
      { token: "cfdisk", kind: "sub", meaning: "curses partition editor (friendlier fdisk)" },
      { token: "mount", kind: "sub", meaning: "attach a filesystem to a mountpoint" },
      { token: "umount", kind: "sub", meaning: "detach a filesystem" },
      { token: "df", kind: "sub", meaning: "free space per filesystem (-h human-readable)" },
      { token: "du", kind: "sub", meaning: "disk usage of a folder (-h, -sh for summary)" },
      { token: "free", kind: "sub", meaning: "RAM usage (-h human-readable)" },
      { token: "ip", kind: "sub", meaning: "network: 'ip a' addresses, 'ip r' routes" },
      { token: "ping", kind: "sub", meaning: "test reachability (ping -c 4 archlinux.org)" },
      { token: "ss", kind: "sub", meaning: "socket stats — 'ss -tulpn' shows listening ports" },
      { token: "localectl", kind: "sub", meaning: "set keyboard layout / locale" },
      { token: "timedatectl", kind: "sub", meaning: "set timezone / NTP", example: "sudo timedatectl set-ntp true" },
      { token: "hostnamectl", kind: "sub", meaning: "set the machine hostname" },
      { token: "bootctl", kind: "sub", meaning: "manage systemd-boot (status/update)" },
      { token: "dmesg", kind: "sub", meaning: "kernel ring buffer (hardware/driver messages)" },
      { token: "lspci", kind: "sub", meaning: "list PCI devices (GPU/network…)" },
      { token: "lsusb", kind: "sub", meaning: "list USB devices" },
      { token: "uname", kind: "sub", meaning: "system info (-r kernel release, -a everything)" },
      { token: "htop", kind: "sub", meaning: "interactive process monitor" },
      { token: "btop", kind: "sub", meaning: "resource monitor with graphs" },
      { token: "sudo", kind: "sub", meaning: "run the next command as root" },
    ],
  },
];

// Hand-written typo aliases (beyond edit distance)
export const TOKEN_ALIASES: Record<string, string> = {
  clon: "clone",
  comit: "commit",
  commmit: "commit",
  psuh: "push",
  pul: "pull",
  statu: "status",
  stauts: "status",
  syu: "-Syu",
  syy: "-Syy",
  need: "--needed",
  neede: "--needed",
  needeed: "--needed",
  nconfirm: "--noconfirm",
};

// Common "did you mean" candidates at binary level
export const BINARY_ALIASES: Record<string, string> = {
  apt: "pacman",
  "apt-get": "pacman",
  dnf: "pacman",
  yum: "pacman",
  brew: "pacman",
  choco: "pacman",
  yaourt: "yay",
  paru: "yay",
  pamac: "yay",
  service: "systemctl",
  chkconfig: "systemctl",
  "system-control": "systemctl",
};

export function toolFor(binary: string): ToolKb | undefined {
  return KNOWN_BINARIES.find((t) => t.binary === binary);
}

/** Everyday system tools that aren't in the catalogue yet: what each is, in plain words. */
export const SYSTEM_COMMANDS: Record<string, string> = {
  wpctl: "WirePlumber's control: your sound devices and their volume (wpctl status lists them)",
  bootctl: "systemd-boot's tool: the boot loader's state and entries",
  localectl: "your language and keyboard layout settings",
  timedatectl: "your clock, time zone and network time",
  hostnamectl: "this computer's name and what it runs",
  resolvectl: "DNS: who answers lookups, and asking it directly",
  nmcli: "NetworkManager from the terminal: Wi-Fi, connections, devices",
  loginctl: "who is logged in, and their sessions",
  "pacman-key": "the keys pacman uses to check that packages are genuine",
};

/** The "system" entries that are whole commands (mkinitcpio, reflector…), with their meaning. */
export function systemCommand(name: string): string | null {
  if (SYSTEM_COMMANDS[name]) return SYSTEM_COMMANDS[name];
  const sys = KNOWN_BINARIES.find((t) => t.binary === "system");
  const item = sys?.items.find((it) => it.token === name && !name.startsWith("-"));
  return item?.meaning ?? null;
}

export function allToolBinaries(): string[] {
  return [
    ...KNOWN_BINARIES.map((t) => t.binary),
    "echo", "cat", "ls", "cd", "mkdir", "rm", "cp", "mv", "touch", "grep", "sed", "awk",
    "chmod", "chown", "ln", "tar", "unzip", "curl", "wget", "nano", "vim", "nvim", "less",
    "man", "which", "whoami", "id", "ps", "kill", "bash", "sh", "xargs", "find", "head", "tail",
  ];
}

// --- Levenshtein distance -------------------------------------------------
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

export function maxDistance(token: string): number {
  if (token.length <= 3) return 1;
  if (token.length <= 6) return 2;
  return 3;
}

/** Closest matches for an unknown token among candidates. */
export function suggest(token: string, candidates: string[], limit = 3): string[] {
  const t = token.toLowerCase();
  const alias = TOKEN_ALIASES[t];
  const scored = candidates
    .filter((c) => c !== token)
    .map((c) => ({ c, d: levenshtein(t, c.toLowerCase()) }))
    .filter(({ c, d }) => d <= Math.max(maxDistance(t), maxDistance(c)) || c.toLowerCase().startsWith(t.slice(0, 3)))
    .sort((a, b) => a.d - b.d || a.c.length - b.c.length);
  const out = scored.map((s) => s.c);
  if (alias && !out.includes(alias)) out.unshift(alias);
  return out.slice(0, limit);
}
