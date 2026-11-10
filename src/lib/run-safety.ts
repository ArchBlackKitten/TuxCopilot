// Stopping a run while a package manager changes the system can leave it half-updated (and
// pacman's lock file behind). Stop asks first then — in plain words.

/** The same list the runner never stops by a limit (runner.rs PACKAGE_WORK). */
export const PACKAGE_WORK = ["pacman", "yay", "paru", "makepkg", "pacman-key", "pacstrap", "mkinitcpio", "dracut", "flatpak", "snap"];

/** The package manager at work in a run (its programs now), or null. */
export function packageWork(activity: string[] | undefined | null): string | null {
  return activity?.find((p) => PACKAGE_WORK.includes(p)) ?? null;
}
