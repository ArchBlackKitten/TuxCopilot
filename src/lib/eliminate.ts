// App Manager — removal plans.
//
// The user's point: "not all of them can be done with just -Rns". Right —
// pacman only removes files it owns, flatpaks carry their own data in
// ~/.var/app, AUR builds leave a cache, AppImages are just files, and
// make-installed software needs `make uninstall`. So each install source
// gets its own Full / Mid / Partial plan with the exact commands.

import type { EliminationPlan } from "./types";

/** Only safe package/app names ever reach the shell. */
export function sanitizeAppName(app: string): string {
  return app.replace(/[^a-zA-Z0-9_.+-]/g, "").slice(0, 64);
}

/**
 * A name is only planned for when it starts with a letter, digit, `_` or `+`. That shuts out
 * `.` and `..` (`rm -rf ~/.config/..` would be `rm -rf ~`), dot-names that would point at
 * other hidden folders, and `-names` that pacman or rm would read as options.
 */
export function isPlannableName(app: string): boolean {
  return /^[a-zA-Z0-9_+][a-zA-Z0-9_.+-]*$/.test(app) && !/^\.+$/.test(app);
}

/** Every place in your home named after the app: settings, cache, data, autostart entry. */
const HOME_PATHS = (app: string) =>
  `~/.config/${app} ~/.cache/${app} ~/.local/share/${app} ~/.config/autostart/${app}.desktop`;

/**
 * The Full plan as ONE command, for this app only. Different from the step list on purpose:
 * - nothing system-wide (no orphan sweep of the whole machine, no whole-cache clean),
 * - non-interactive (Run has no terminal; the "Are you sure?" prompts are the confirmation),
 * - `&&` after the uninstall, so your data is only deleted once the app really is gone.
 */
export function allInOne(app: string, source: string): string {
  // its callers check the name too; the function that builds rm -rf ~/.config/<app> refuses
  // a bad one itself
  if (!isPlannableName(app)) throw new Error(`not a name Fluff builds a removal for: ${app}`);
  const stopService = `systemctl --user disable --now ${app}.service 2>/dev/null;`;
  switch (source) {
    case "flatpak":
      return `flatpak uninstall -y --delete-data ${app}`;
    case "snap":
      return `sudo snap remove --purge ${app} && rm -rf ~/snap/${app}`;
    case "aur":
      return `${stopService} yay -Rns --noconfirm ${app} && rm -rf ~/.cache/yay/${app} ${HOME_PATHS(app)}`;
    case "appimage":
      return `rm -f ~/Applications/${app}*.AppImage ~/.local/bin/${app}*.AppImage ~/.local/share/applications/${app}.desktop && rm -rf ${HOME_PATHS(app)} && update-desktop-database ~/.local/share/applications`;
    case "git":
      return `${stopService} cd ~/src/${app} && sudo make uninstall && cd ~ && rm -rf ~/src/${app} ${HOME_PATHS(app)}`;
    default:
      return `${stopService} sudo pacman -Rns --noconfirm ${app} && rm -rf ${HOME_PATHS(app)}`;
  }
}

const HOME_SWEEP = (app: string) =>
  `rm -ri ~/.config/${app} ~/.cache/${app} ~/.local/share/${app}`;

/**
 * Several apps removed in a row (the domino). Each app's all-in-one runs in its own ( … ) so
 * the `;` inside one cannot carry on past a failure: if any uninstall fails, nothing after it
 * runs.
 */
export function chainRemoval(apps: Array<{ app: string; source: string }>): string {
  return apps
    .filter((a) => isPlannableName(sanitizeAppName(a.app)))
    .map((a) => `(${allInOne(sanitizeAppName(a.app), a.source)})`)
    .join(" && ");
}

export function buildEliminationPlans(rawApp: string, rawSource: string): EliminationPlan[] {
  const app = sanitizeAppName(rawApp);
  if (!app || !isPlannableName(app)) return [];
  const plans = stepPlans(app, rawSource);
  const full = plans.find((p) => p.level === "full");
  full?.commands.push({
    command: allInOne(app, rawSource),
    note: `All of the above in one go, for ${app} only: uninstalls it with the dependencies only it needed, then deletes its settings, cache and data. Your data is only deleted if the uninstall succeeds. Nothing else on the system is touched.`,
    allInOne: true,
  });
  return plans;
}

function stepPlans(app: string, source: string): EliminationPlan[] {

  if (source === "flatpak") {
    return [
      {
        level: "full",
        title: "Full elimination",
        tagline: "the app, its runtimes and every byte of its data — gone",
        removes: ["the flatpak", "user data in ~/.var/app", "runtimes nothing else uses"],
        keeps: [],
        commands: [
          {
            command: `flatpak uninstall --delete-data ${app}`,
            note: "uninstalls the app and deletes its data directory under ~/.var/app",
          },
          {
            command: "flatpak uninstall --unused",
            note: "drops orphaned runtimes and extensions no remaining app needs",
          },
        ],
        warning: "--delete-data is immediate — there is no bin. Export anything you care about first.",
      },
      {
        level: "mid",
        title: "Mid elimination",
        tagline: "the app goes, your data survives a reinstall",
        removes: ["the flatpak"],
        keeps: ["user data in ~/.var/app", "installed runtimes"],
        commands: [
          {
            command: `flatpak uninstall ${app}`,
            note: "removes the app but keeps its data, in case you come back",
          },
        ],
      },
      {
        level: "partial",
        title: "Partial elimination",
        tagline: "keep the app, reclaim the fat around it",
        removes: ["cached files", "orphaned runtimes"],
        keeps: ["the app itself", "settings and user data"],
        commands: [
          {
            command: "flatpak uninstall --unused",
            note: "removes runtimes not required by any installed app",
          },
          {
            command: `rm -ri ~/.var/app/${app}/cache`,
            note: "clears the app's sandboxed cache",
          },
        ],
      },
    ];
  }

  if (source === "snap") {
    return [
      {
        level: "full",
        title: "Full elimination",
        tagline: "the snap, its saved snapshots and its data in ~/snap — gone",
        removes: ["the snap", "the automatic data snapshot", "user data in ~/snap"],
        keeps: [],
        commands: [
          {
            command: `sudo snap remove --purge ${app}`,
            note: "removes the snap without keeping the data snapshot snapd would otherwise save for 31 days",
          },
          {
            command: `rm -ri ~/snap/${app}`,
            note: "the app's data in your home, which snapd leaves behind — interactive, you confirm each",
          },
        ],
        warning: "--purge is immediate — there is no snapshot to restore from afterwards.",
      },
      {
        level: "mid",
        title: "Mid elimination",
        tagline: "the snap goes, a snapshot of its data is kept",
        removes: ["the snap"],
        keeps: ["a data snapshot (`snap saved` lists it, `snap restore` brings it back)", "~/snap data"],
        commands: [
          {
            command: `sudo snap remove ${app}`,
            note: "removes the snap; snapd saves its data as a snapshot first, in case you come back",
          },
        ],
      },
      {
        level: "partial",
        title: "Partial elimination",
        tagline: "keep the app, drop the old revisions it keeps around",
        removes: ["disabled older revisions"],
        keeps: ["the app itself", "settings and user data"],
        commands: [
          {
            command: `snap list --all ${app}`,
            note: "shows every revision kept on disk; the ones marked disabled are old copies",
          },
          {
            command: `sudo snap set system refresh.retain=2`,
            note: "keeps only 2 revisions of every snap from now on (the default is 3)",
          },
        ],
      },
    ];
  }

  if (source === "aur") {
    return [
      {
        level: "full",
        title: "Full elimination",
        tagline: "package, orphans, build cache and home data — everything",
        removes: ["the package", "unneeded dependencies", "pacman's backup configs", "the AUR build dir", "home configs & data"],
        keeps: [],
        commands: [
          { command: `yay -Rns ${app}`, note: "removes the package, its now-unneeded dependencies and pacman's backup config files" },
          { command: "pacman -Qtdq | sudo pacman -Rns -", note: "sweeps up any orphans the removal left behind — review the list in the dry run first" },
          { command: `yay -Sc`, note: "cleans the package cache and the AUR build directories (~/.cache/yay)" },
          { command: HOME_SWEEP(app), note: "user-side configs, cache and data that pacman never touches — interactive, so you confirm each path" },
        ],
        warning: "The orphan sweep and the home sweep both deserve a read before you press Enter.",
      },
      {
        level: "mid",
        title: "Mid elimination",
        tagline: "app and deps gone, your files stay put",
        removes: ["the package", "unneeded dependencies"],
        keeps: ["dotfiles in $HOME", "pacman backup configs", "AUR build cache"],
        commands: [
          { command: `yay -Rs ${app}`, note: "removes the package and dependencies, keeps configuration files" },
        ],
      },
      {
        level: "partial",
        title: "Partial elimination",
        tagline: "keep it installed, just trim the bloat",
        removes: ["the AUR build directory", "cached data", "autostart entry"],
        keeps: ["the app", "your settings"],
        commands: [
          { command: `rm -ri ~/.cache/yay/${app}`, note: "removes the cloned build directory and compiled packages" },
          { command: `rm -ri ~/.cache/${app}`, note: "clears the app's own cache" },
          { command: `rm -i ~/.config/autostart/${app}.desktop`, note: "stops it launching itself at login (if it ships an autostart entry)" },
        ],
      },
    ];
  }

  if (source === "appimage") {
    return [
      {
        level: "full",
        title: "Full elimination",
        tagline: "an AppImage is only files — but files in four places",
        removes: ["the .AppImage binary", "menu entry", "home configs, cache & data"],
        keeps: [],
        commands: [
          { command: `ls ~/Applications ~/.local/bin 2>/dev/null | grep -i ${app}`, note: "locate the binary first — AppImages can live anywhere you put them" },
          { command: `rm -i ~/Applications/${app}*.AppImage`, note: "delete the binary itself (adjust the path to what ls found)" },
          { command: `rm -i ~/.local/share/applications/${app}.desktop`, note: "remove the menu entry" },
          { command: HOME_SWEEP(app), note: "configs, cache and data the AppImage dropped in your home — interactive" },
          { command: "update-desktop-database ~/.local/share/applications", note: "refresh the application menu so no ghost entry remains" },
        ],
        warning: "The ls/grep step is there on purpose: confirm the real path before any rm.",
      },
      {
        level: "mid",
        title: "Mid elimination",
        tagline: "binary and menu entry gone, data parked for later",
        removes: ["the .AppImage binary", "menu entry"],
        keeps: ["~/.config, ~/.cache, ~/.local/share data"],
        commands: [
          { command: `rm -i ~/Applications/${app}*.AppImage`, note: "delete the binary (check the path first with ls)" },
          { command: `rm -i ~/.local/share/applications/${app}.desktop`, note: "remove the menu entry" },
        ],
      },
      {
        level: "partial",
        title: "Partial elimination",
        tagline: "keep the app, free the space it hoards",
        removes: ["cached data", "autostart entry"],
        keeps: ["the .AppImage", "your settings"],
        commands: [
          { command: `rm -ri ~/.cache/${app}`, note: "AppImage apps cache aggressively — often the biggest win" },
          { command: `rm -i ~/.config/autostart/${app}.desktop`, note: "no more silent launch at login" },
        ],
      },
    ];
  }

  if (source === "git") {
    return [
      {
        level: "full",
        title: "Full elimination",
        tagline: "make-installed software needs make uninstall — pacman can't see it",
        removes: ["installed binaries", "the source tree (optional)", "home configs & data"],
        keeps: [],
        commands: [
          { command: `command -v ${app}`, note: "confirm it is on PATH and where it lives" },
          { command: `pacman -Qo "$(command -v ${app})"`, note: "check whether pacman owns it after all — if it does, use the pacman plan instead" },
          { command: `cd ~/src/${app} && sudo make uninstall`, note: "the clean way out of a make install — only works if the Makefile supports it" },
          { command: HOME_SWEEP(app), note: "user-side configs and data — interactive" },
        ],
        warning: "If `make uninstall` is not supported, remove the binaries manually (command -v shows them) — there is no database of what make install wrote.",
      },
      {
        level: "mid",
        title: "Mid elimination",
        tagline: "uninstall the program, remember your configuration",
        removes: ["installed binaries"],
        keeps: ["source tree", "dotfiles in $HOME"],
        commands: [
          { command: `cd ~/src/${app} && sudo make uninstall`, note: "removes what make install put in /usr/local" },
        ],
      },
      {
        level: "partial",
        title: "Partial elimination",
        tagline: "keep the app, drop the dead weight",
        removes: ["build artefacts", "cached data"],
        keeps: ["the installed binary", "the source tree"],
        commands: [
          { command: `cd ~/src/${app} && make clean`, note: "removes compiled objects — frees space, keeps the app runnable" },
          { command: `rm -ri ~/.cache/${app}`, note: "clears the app's cache" },
        ],
      },
    ];
  }

  // pacman — and the honest fallback for anything unclassified
  const isPacman = source === "pacman" || source === "other" || source === "simulated" || source === "sample";
  return [
    {
      level: "full",
      title: "Full elimination",
      tagline: "-Rns is the start, not the whole story",
      removes: ["the package", "unneeded dependencies", "pacman's backup configs", "home configs & data"],
      keeps: [],
      commands: [
        ...(isPacman
          ? [{ command: `sudo pacman -Rns ${app}`, note: "removes the package, its now-unneeded dependencies and pacman's backup config files" }]
          : [{ command: `pacman -Qo "$(command -v ${app})"`, note: "find out which package owns this binary — if none does, it was installed outside pacman" }]),
        { command: "pacman -Qtdq | sudo pacman -Rns -", note: "sweeps up orphans left behind — review the list first" },
        { command: HOME_SWEEP(app), note: "dotfiles, caches and data pacman never touches — interactive, you confirm each" },
      ],
      warning: "-Rns never deletes anything in your home directory; that is why the final sweep exists.",
    },
    {
      level: "mid",
      title: "Mid elimination",
      tagline: "app and dependencies gone, your files stay put",
      removes: ["the package", "unneeded dependencies"],
      keeps: ["dotfiles in $HOME", "pacman backup configs"],
      commands: [
        { command: `sudo pacman -Rs ${app}`, note: "removes the package and dependencies but keeps configuration files for a painless reinstall" },
      ],
    },
    {
      level: "partial",
      title: "Partial elimination",
      tagline: "keep it installed, just slim it down",
      removes: ["cached data", "autostart entry", "background service"],
      keeps: ["the app", "your settings"],
      commands: [
        { command: `rm -ri ~/.cache/${app}`, note: "browsers, editors and games hide gigabytes here" },
        { command: `rm -i ~/.config/autostart/${app}.desktop`, note: "stops it launching itself at login" },
        { command: `systemctl --user disable --now ${app}.service`, note: "if it ships a background service, this stops and disables it (harmless if there is none)" },
      ],
    },
  ];
}
