// Fluff's weekly checkup, only with your permission.
// Off until you switch it on, and switching it on is a command shown first ("Are you sure?" is
// the permission): two files of yours in ~/.config/systemd/user and a timer, no password. Once a
// week — or at your next login, if the computer was off — it runs `tuxcopilot --weekly-checkup`,
// which only reads and sends a notification only when something needs you (weekly.rs).

import { inv } from "./host";

export interface WeeklyState {
  on: boolean;
  files: boolean;
  exe: string | null;
  last: string | null;
}
export const weeklyState = () => inv<WeeklyState>("weekly_state");

export const UNIT = "tuxcopilot-checkup"; // weekly.rs UNIT
export const UNIT_DIR = "$HOME/.config/systemd/user";

export function unitFiles(exe: string): { service: string[]; timer: string[] } {
  if (!/^\/[\w./+-]+$/.test(exe)) throw new Error(`Fluff can't name this TuxCopilot in a timer: ${exe}`);
  return {
    service: ["[Unit]", "Description=TuxCopilot: the weekly checkup by Fluff (it only reads)", "", "[Service]", "Type=oneshot", `ExecStart=${exe} --weekly-checkup`],
    timer: ["[Unit]", "Description=TuxCopilot: the weekly checkup by Fluff", "", "[Timer]", "OnCalendar=weekly", "Persistent=true", "RandomizedDelaySec=1h", "", "[Install]", "WantedBy=timers.target"],
  };
}

const write = (lines: string[], name: string) => `printf '%s\\n' ${lines.map((l) => `'${l}'`).join(" ")} > "${UNIT_DIR}/${name}"`;

/** On: the two files, then the timer switched on. Yours: no password. */
export function weeklyOnCommand(exe: string): string {
  const f = unitFiles(exe);
  return [
    `mkdir -p "${UNIT_DIR}"`,
    write(f.service, `${UNIT}.service`),
    write(f.timer, `${UNIT}.timer`),
    "systemctl --user daemon-reload",
    `systemctl --user enable --now ${UNIT}.timer`,
    `{ systemctl --user is-enabled -q ${UNIT}.timer && systemctl --user is-active -q ${UNIT}.timer || { echo "Fluff: the weekly checkup's timer isn't on." >&2; false; }; }`,
  ].join(" && ");
}

/** Off: the timer switched off (only if it is there — nothing hidden), its two files gone, and checked. */
export const weeklyOffCommand = (): string =>
  [
    `{ ! systemctl --user cat ${UNIT}.timer >/dev/null 2>&1 || systemctl --user disable --now ${UNIT}.timer; }`,
    `rm -f "${UNIT_DIR}/${UNIT}.service" "${UNIT_DIR}/${UNIT}.timer"`,
    "systemctl --user daemon-reload",
    `{ ! systemctl --user is-active -q ${UNIT}.timer || { echo "Fluff: the weekly checkup's timer is still on." >&2; false; }; }`,
  ].join(" && ");

export const WEEKLY_WORDS =
  "Once a week Fluff can look at your system even with TuxCopilot closed — failed services, settings files waiting, a pacman lock left behind, a disk filling up — and tell you with a notification, only when something needs you. It only reads. It needs your permission: a timer of yours (no password), and you can switch it off here.";
