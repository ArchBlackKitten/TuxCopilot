// A command's page when its program isn't on this computer: which package has it, and the
// line that installs it (copied, not run — the Commands section is for learning).

/** The help box said the program isn't installed here. */
export const notInstalled = (help: string) => /is not installed on this computer/.test(help);
/** "yay (AUR)" → yay; "bash (built in)" → null (nothing to install). */
export const packageOf = (pkg: string): string | null => (/\(built in\)/.test(pkg) ? null : pkg.replace(/\s*\(.*\)\s*$/, "").trim() || null);
/** How to install it — the rule: -Syu --needed; the AUR's with yay, never sudo. */
export function installLine(pkg: string): string | null {
  const p = packageOf(pkg);
  if (!p || !/^[a-z0-9@._+-]+$/.test(p)) return null;
  return /\(AUR\)/.test(pkg) ? `yay -Syu --needed ${p}` : `sudo pacman -Syu --needed ${p}`;
}
