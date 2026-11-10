// USB sticks, USB disks and SD cards — a three-way switch:
//   Allow  as Arch and KDE come: plug it in, open it, no password.
//   Ask    opening one asks for your password (a polkit rule for udisks, which KDE's Disks &
//          Devices and Dolphin use). Fluff recommends it.
//   Block  their drivers refused (modprobe.d), and opening one refused.
// What it covers, exactly: udisks's
// actions for a drive that isn't the computer's own — the computer's own disks have their own
// actions (…-system), which the rule leaves alone — and the drivers usb_storage, uas and mmc_block.
// Not covered: a phone's or camera's files (MTP and PTP use no storage driver), disks plugged in by
// Thunderbolt or eSATA (they are NVMe or SATA to the kernel), root mounting by hand, and other USB
// devices — USBGuard is for those. A driver in use when Block is chosen keeps working until the
// stick or card is taken out.
// Each command: refuses to write over or remove a file that isn't TuxCopilot's; copies the old
// files first; writes through a .new file; checks polkit's own answer for every action, and
// modprobe's own rules; and when anything fails, puts back exactly what was there before — and says
// so, or says what it couldn't put back. Block is refused when the system starts from USB or SD, or
// when a driver is built into the kernel (no rule can refuse it then).

import { inv } from "./host";

export interface StorageControl {
  mount: "yes" | "ask" | "no" | "mixed" | ""; // mixed: opening and unlocking answered differently
  driverRule: boolean;
  loaded: string[];
  systemRemovable: boolean;
}
export const storageControl = () => inv<StorageControl>("storage_control");

export type StorageMode = "allow" | "ask" | "block";
export const POLKIT_RULE = "/etc/polkit-1/rules.d/00-tuxcopilot-storage.rules";
export const POLKIT_DIRS = ["/etc/polkit-1/rules.d", "/usr/share/polkit-1/rules.d"]; // where polkit reads rules
export const DRIVER_RULE = "/etc/modprobe.d/tuxcopilot-storage.conf"; // devices.rs DRIVER_RULE
export const STORAGE_DRIVERS = ["usb_storage", "uas", "mmc_block"]; // devices.rs STORAGE_DRIVERS
export const PROC_MODULES = "/proc/modules"; // the kernel's loaded modules
export const SAVED = "/tmp/tuxcopilot-storage.XXXXXX"; // the old files' copies, while a command runs

export const STORAGE_MODES: Array<{ id: StorageMode; label: string; what: string }> = [
  { id: "allow", label: "Allow", what: "Plug in a USB stick or SD card and open it, no password — as Arch and KDE come." },
  {
    id: "ask",
    label: "Ask",
    what: "Opening a USB stick, USB disk or SD card asks for your password, so no program can open one behind your back. Your computer's own disks are left as they are.",
  },
  {
    id: "block",
    label: "Block",
    what: "USB sticks, USB disks and SD cards don't work: their drivers are refused, and opening one is refused. Keyboards, mice, headsets and printers still work. Not stopped: a phone's or camera's files, and disks plugged in by Thunderbolt or eSATA.",
  },
];

/** What the switch shows now, from polkit's own answer and the driver rule. */
export function storageMode(s: StorageControl): StorageMode | null {
  if (s.driverRule && s.mount === "no") return "block";
  if (s.mount === "ask" && !s.driverRule) return "ask";
  if (s.mount === "yes" && !s.driverRule) return "allow";
  return null; // half way (or polkit didn't answer): the panel says what is
}

// udisks's actions for a drive that isn't the computer's own (USB, SD): opening it, and unlocking an
// encrypted one — on this seat, and on another. The first two are the ones Arch allows without a password.
const ACTIONS = ["filesystem-mount", "encrypted-unlock", "filesystem-mount-other-seat", "encrypted-unlock-other-seat"].map((a) => `org.freedesktop.udisks2.${a}`);
export const OWN_SEAT = ACTIONS.slice(0, 2); // devices.rs reads these two

export function polkitRuleText(mode: "ask" | "block"): string[] {
  return [
    `// TuxCopilot: USB sticks, USB disks and SD cards (drives other than the ones built in) — ${mode === "ask" ? "opening one asks for your password" : "opening one is refused"} (Security). Delete this file to undo.`,
    "polkit.addRule(function (action, subject) {",
    `  if (${ACTIONS.map((a) => `action.id == "${a}"`).join(" || ")}) {`,
    `    return polkit.Result.${mode === "ask" ? "AUTH_ADMIN" : "NO"};`,
    "  }",
    "});",
  ];
}

export const DRIVER_RULE_TEXT = [
  "# TuxCopilot: the drivers for USB sticks, USB disks and SD cards refused (Security, Block). Delete this file to undo.",
  ...STORAGE_DRIVERS.map((d) => `install ${d} /bin/false`),
];

const FILES = [POLKIT_RULE, DRIVER_RULE];
/** A file there that isn't TuxCopilot's (its first line says) is never written over or removed. */
const ours = (f: string) =>
  `{ ! sudo test -e ${f} || sudo head -n1 ${f} | grep -qE '^(//|#) TuxCopilot:' || { echo "Fluff: ${f} is there and isn't TuxCopilot's: Fluff won't write over it or remove it." >&2; false; }; }`;
const save = (f: string, i: number) => `{ ! sudo test -e ${f} || sudo cp -a ${f} "$kept/${i}"; }`;
/** Written whole, then moved into place: polkit and modprobe never read half a file. */
const put = (lines: string[], f: string) =>
  `printf '%s\\n' ${lines.map((l) => `'${l}'`).join(" ")} | sudo tee ${f}.new >/dev/null && sudo chmod 644 ${f}.new && sudo mv -f ${f}.new ${f}`;
/** After a failure: each file as it was — the old one back, or one this command made removed. */
const putBack = FILES.map(
  (f, i) => `{ sudo rm -f ${f}.new; if sudo test -e "$kept/${i}"; then sudo mv -f "$kept/${i}" ${f}; else sudo rm -f ${f}; fi; } || { echo "Fluff: couldn't put ${f} back as it was." >&2; left=1; }`,
).join("; ");
const drop = `sudo rm -f ${FILES.map((_, i) => `"$kept/${i}"`).join(" ")} && sudo rmdir "$kept"`;
const forget = `{ ${drop}; } || echo "Fluff: the copy of the old files is left in $kept (it goes at the next restart)."`;

const CODE = { yes: 0, no: 1, ask: 2 } as const;
/** polkit reads its rules again by itself: up to 5 s until it answers as asked, for every action. */
const polkitSays = (want: keyof typeof CODE, actions: string[]) =>
  `{ ok=; for i in 1 2 3 4 5; do bad=; for a in ${actions.join(" ")}; do pkcheck --action-id "$a" --process $$ >/dev/null 2>&1; r=$?; [ "$r" = ${CODE[want]} ] || { bad=$a; break; }; done; [ -z "$bad" ] && ok=1 && break; sleep 1; done; [ -n "$ok" ] || { case $r in 0) w=yes;; 1) w=no;; 2) w="ask for a password";; *) w="nothing (it didn't answer)";; esac; echo "Fluff: polkit says $w for $bad, not ${want === "ask" ? "ask for a password" : want}." >&2; false; }; }`;

/** modprobe takes the first rule for a driver: TuxCopilot's must be the one it takes. */
const MODPROBE_REFUSES = `{ bad=; c=$(sudo modprobe --showconfig) && bad=$(for d in ${STORAGE_DRIVERS.join(" ")}; do [ "$(printf '%s\\n' "$c" | grep -m1 "^install $d ")" = "install $d /bin/false" ] || echo "$d"; done | xargs) && [ -z "$bad" ] || { echo "Fluff: modprobe doesn't refuse \${bad:-the drivers} (it couldn't read its rules, or another rule for it comes first)." >&2; false; }; }`;
/** A driver built into the kernel can't be refused by any rule. */
const NOT_BUILT_IN = `{ b=$(for d in ${STORAGE_DRIVERS.join(" ")}; do [ "$(modinfo -F filename "$d" 2>/dev/null)" != "(builtin)" ] || echo "$d"; done | xargs); [ -z "$b" ] || { echo "Fluff: $b is built into this kernel, so no rule can refuse it: Block can't be done here. Ask still works." >&2; false; }; }`;
// the loaded ones go now; one in use (a stick or card is in) is said, never hidden: it keeps working until it is taken out
const UNLOAD = `for d in ${[...STORAGE_DRIVERS].reverse().join(" ")}; do ! grep -q "^$d " ${PROC_MODULES} || sudo modprobe -r "$d" || echo "Fluff: $d is in use now (a USB stick, disk or SD card is in): it keeps working until you take it out, and not again after."; done`;
/** Other polkit rules that speak about drives: named (polkit's answer for these actions is checked above). */
const OTHERS = `o=$(sudo find ${POLKIT_DIRS.join(" ")} -name '*.rules' ! -name ${POLKIT_RULE.split("/").pop()} -exec grep -l udisks2 {} + 2>/dev/null | xargs); [ -z "$o" ] || echo "Fluff: other polkit rules also speak about drives: $o. For USB sticks and SD cards polkit answers as TuxCopilot's rule says — checked just now."`;

/** The command that sets the switch. */
export function storageModeCommand(to: StorageMode, now: StorageControl): string {
  if (to === "block" && now.systemRemovable) throw new Error("Your system starts from a USB disk or an SD card: Block would stop it from starting. Ask keeps them asking for your password.");
  const change =
    to === "allow"
      ? [`sudo rm -f ${POLKIT_RULE} ${DRIVER_RULE}`, polkitSays("yes", OWN_SEAT)]
      : to === "ask"
        ? [put(polkitRuleText("ask"), POLKIT_RULE), `sudo rm -f ${DRIVER_RULE}`, polkitSays("ask", ACTIONS)]
        : [put(polkitRuleText("block"), POLKIT_RULE), put(DRIVER_RULE_TEXT, DRIVER_RULE), MODPROBE_REFUSES, polkitSays("no", ACTIONS)];
  const ready = [...(to === "block" ? [NOT_BUILT_IN] : []), ...FILES.map(ours), ...FILES.map(save)].join(" && ");
  const after = [forget, ...(to === "block" ? [UNLOAD] : []), ...(to === "allow" ? [] : [OTHERS])].join("; ");
  return [
    `( kept=$(sudo mktemp -d ${SAVED}) || exit 1`,
    `{ ${ready}; } || { r=$?; ${drop}; exit $r; }`, // nothing changed yet
    `if ${change.join(" && ")}; then ${after}; else r=$?; left=; ${putBack}; [ -n "$left" ] || { ${drop}; echo "Fluff: nothing changed — put back as it was." >&2; }; exit $r; fi )`,
  ].join("; ");
}

/** Said under the switch: what is true right now. */
export function storageNotes(s: StorageControl): string[] {
  const out: string[] = [];
  if (s.mount === "") out.push("Fluff couldn't ask polkit how it answers you now.");
  if (s.mount === "mixed") out.push("polkit answers differently for opening a drive and for unlocking an encrypted one: choose again to set both.");
  if (s.driverRule && s.loaded.length) out.push(`A USB stick, disk or SD card is in now (${s.loaded.join(", ")} loaded): it keeps working until you take it out.`);
  if (s.driverRule && s.mount !== "no") out.push("The drivers are refused, but opening isn't: choose Block again to finish it.");
  if (s.systemRemovable) out.push("Your system starts from a USB disk or an SD card, so Block isn't offered.");
  return out;
}
