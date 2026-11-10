// A way back if an update breaks starting. Arch updates the
// kernel often; when one won't start, a second kernel in the start menu — the long-term one — and the
// snapshots you can start from are the way back. Fluff says what this computer has, recommends a
// second kernel when there is one only, and says how to choose another one when the computer starts.
// What the start menu itself lists sits in /boot, which only root may read: "Check the start menu"
// reads its names only (never a kernel's options), as a command shown first like any other.

import { inv } from "./host";

export interface BootKernel {
  package: string;
  version: string;
}
export interface BootFacts {
  kernels: BootKernel[];
  running: string | null;
  loader: "limine" | "grub" | "refind" | "";
  snapshotMenu: boolean;
  snapper: boolean;
  headers: boolean;
  cachyos: boolean;
}
export const bootFacts = () => inv<BootFacts>("boot_facts"); // boot.rs

export const LOADER_NAMES: Record<BootFacts["loader"], string> = { limine: "Limine", grub: "GRUB", refind: "rEFInd", "": "your start menu" };

/** The second kernel Fluff recommends (and its headers when a kernel's are installed): the
 *  long-term one, or the main one when only the long-term one is there. None with two already. */
export function secondKernel(f: BootFacts): string[] | null {
  if (f.kernels.length !== 1) return null;
  const has = f.kernels[0].package;
  const [main, lts] = f.cachyos ? ["linux-cachyos", "linux-cachyos-lts"] : ["linux", "linux-lts"];
  const pick = has === lts ? main : lts;
  return f.headers ? [pick, `${pick}-headers`] : [pick];
}

/** Installed (always -Syu: never half an update), the menu told where it needs it, then checked: in place. */
export function secondKernelCommand(f: BootFacts): string {
  const pkgs = secondKernel(f);
  if (!pkgs) throw new Error("This computer already has a second kernel, or Fluff couldn't find its kernels.");
  const k = pkgs[0];
  return [
    `sudo pacman -Syu --needed ${pkgs.join(" ")}`,
    // Limine's hook and rEFInd find a new kernel by themselves; GRUB's menu is written again
    ...(f.loader === "grub" ? ["sudo grub-mkconfig -o /boot/grub/grub.cfg"] : []),
    `{ d=$(grep -lx '${k}' /usr/lib/modules/*/pkgbase | head -n1); [ -n "$d" ] && [ -f "\${d%/pkgbase}/vmlinuz" ] || { echo "Fluff: ${k} isn't in place after the install." >&2; false; }; }`,
    `echo "Fluff: ${k} is in place. Check the start menu (here) to see it listed, and choose it once at the next start, to know it works."`,
  ].join(" && ");
}

/** How to choose another kernel, or a snapshot, when the computer starts. */
export function howToChoose(f: Pick<BootFacts, "loader" | "snapshotMenu">): string {
  const snaps = f.snapshotMenu ? " Your snapshots are there too, under Snapshots: one starts the system as it was before an update." : "";
  switch (f.loader) {
    case "limine":
      return `When the computer starts, Limine shows its menu for a few seconds: press ↓ or ↑ to choose the other kernel, then Enter.${snaps}`;
    case "grub":
      return `When the computer starts, hold Shift (or tap Esc) to see GRUB's menu; the other kernel is under "Advanced options".${snaps}`;
    case "refind":
      return "When the computer starts, rEFInd shows its icons: choose the other kernel with ← or →, then Enter (F2 shows more choices).";
    default:
      return "Most start menus show for a few seconds when the computer starts, or when you hold Space (systemd-boot), hold Shift or tap Esc.";
  }
}

// each start menu's names, as root (inside '…': no quote of its own); only the names, never options
const MENU_NAMES: Record<BootFacts["loader"], string> = {
  limine: `e=$(sed -n "s/^ESP_PATH=\\"\\{0,1\\}\\([^\\"]*\\)\\"\\{0,1\\}$/\\1/p" /etc/default/limine /etc/limine-entry-tool.conf 2>/dev/null | head -n1); for c in "\${e:-/boot}/limine.conf" /boot/limine/limine.conf /boot/EFI/limine/limine.conf; do [ -f "$c" ] && { grep -E "^[[:space:]]*/" "$c" | sed -E "s|^[[:space:]]*/+||"; break; }; done`,
  // GRUB quotes its names with ' (written \x27 here, inside '…') or "
  grub: `grep -E "^[[:space:]]*(menuentry|submenu) " /boot/grub/grub.cfg | sed -E "s/^[[:space:]]*(menuentry|submenu) [\\x27\\"]?([^\\x27\\"]*).*/\\2/"`,
  refind: `ls /boot | grep -E "^vmlinuz-"`,
  "": `bootctl list --no-pager | sed -n -E "s/^[[:space:]]*title: //p"`,
};

/** Reads the start menu's names as root, and says for each kernel whether the menu names it. */
export function menuCheckCommand(f: BootFacts): string {
  const said = f.kernels
    .map((k) => `if printf "%s\\n" "$t" | grep -Eq "(^|[^a-z0-9-])${k.package}([^a-z0-9-]|$)"; then echo "Fluff: in the menu: ${k.package}"; else echo "Fluff: not found by name in the menu: ${k.package} — look at the names above."; fi`)
    .join("; ");
  return [
    `t=$(sudo sh -c '${MENU_NAMES[f.loader]}')`,
    `[ -n "$t" ] || { echo "Fluff couldn't read the start menu's names (${LOADER_NAMES[f.loader]})." >&2; false; }`,
    `{ echo "The start menu lists:"; printf "%s\\n" "$t" | sed "s/^/  /"; ${said}; ! printf "%s\\n" "$t" | grep -qi fallback || echo "Fluff: a fallback start is there too (it starts with every driver, for when the usual start won't)."; }`,
  ].join(" && ");
}

export interface BootFinding {
  level: "ok" | "warn" | "info";
  title: string;
  detail: string;
}

/** What Fluff says about this computer's way back. */
export function bootFindings(f: BootFacts): BootFinding[] {
  const out: BootFinding[] = [];
  const names = f.kernels.map((k) => `${k.package}${k.package === f.running ? " (running now)" : ""}`).join(" and ");
  if (f.kernels.length === 0) out.push({ level: "info", title: "Fluff couldn't find the kernels", detail: "Nothing in /usr/lib/modules names its kernel package." });
  else if (f.kernels.length === 1)
    out.push({
      level: "warn",
      title: "One kernel only",
      detail: `${names}. If an update breaks it, there is no other to start. Fluff recommends a second one: ${secondKernel(f)![0]} — it takes about 150 MB in /boot and updates with everything else.`,
    });
  else out.push({ level: "ok", title: `${f.kernels.length} kernels`, detail: `${names}. If an update breaks one, start another.` });
  if (f.snapshotMenu) out.push({ level: "ok", title: "Snapshots in the start menu", detail: "One starts the system as it was before an update (snapper takes one before each)." });
  else if (f.snapper && (f.loader === "limine" || f.loader === "grub"))
    out.push({ level: "info", title: "Snapshots aren't in the start menu", detail: `snapper takes them, but ${LOADER_NAMES[f.loader]} doesn't list them: ${f.loader === "limine" ? "limine-snapper-sync" : "grub-btrfs"} would (from the repos).` });
  return out;
}
