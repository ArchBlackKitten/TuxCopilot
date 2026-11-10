// Who may control your keyboard and mouse — a three-way switch:
//   Allow  every X11 program, without a window (KWin's XwaylandEisNoPrompt) — not recommended
//   Ask    KWin's window each time, nothing remembered (Fluff recommends)
//   Block  the deny-all KDE doesn't have: no window,
//          the answer is always No.
// The locks (inputctl.rs reads each one):
//   1. KWin's own door, which hands any program a keyboard and mouse with no window
//      (org.kde.KWin.EIS.RemoteDesktop) — refused by a session-bus rule. Ask and Block.
//   2. The portal's RemoteDesktop and InputCapture (how RustDesk and sandboxed apps ask) —
//      refused by the same rule. Block.
//   3. Xwayland started without XTEST, the X11 feature xdotool types through. Block; from the next login.
//   4. /dev/uinput closed to your account — a fake keyboard with no window at all. Block.

import { inv } from "./host";

export interface InputControl {
  noPrompt: boolean;
  allowedApps: string[];
  uinputOpen: boolean;
  uinputGivers: string[];
  ourRule: boolean;
  ydotoolOn: boolean;
  busRule: "" | "kwin" | "all";
  doorShut: boolean | null;
  xtestWrapper: boolean;
  xtestForeign: boolean;
  xtestOffNow: boolean | null;
  krdpOn: boolean;
  affected: string[];
}
export const inputControl = () => inv<InputControl>("input_control");

export type InputMode = "allow" | "ask" | "block";
export const OUR_RULE = "/etc/udev/rules.d/72-tuxcopilot-uinput.rules"; // inputctl.rs OUR_RULE
export const BUS_RULE = "/etc/dbus-1/session.d/tuxcopilot-input.conf"; // inputctl.rs BUS_RULE
export const XWAYLAND = "/usr/local/bin/Xwayland"; // inputctl.rs XWAYLAND

export const INPUT_MODES: Array<{ id: InputMode; label: string; what: string }> = [
  { id: "allow", label: "Allow", what: "Any X11 program may type and click for you, without asking. Only for a computer nobody else's programs run on." },
  {
    id: "ask",
    label: "Ask",
    what: "KDE's window asks each time a program wants to type or click for you, nothing is remembered as “always allow”, and KWin's door that has no window is shut.",
  },
  {
    id: "block",
    label: "Block",
    what: "Deny all: no program may type or click for you, and no window asks — the answer is always No. Every door shut, the hidden ones too.",
  },
];

/** What the switch shows now. Block counts only when every lock is written and nothing is always allowed. */
export function inputMode(s: InputControl): InputMode {
  if (s.noPrompt) return "allow";
  return s.ourRule && s.busRule === "all" && s.xtestWrapper && s.allowedApps.length === 0 ? "block" : "ask";
}

/** Ask without KWin's door shut (how every computer starts): pressing Ask again finishes it. */
export const unfinished = (s: InputControl): boolean => inputMode(s) === "ask" && !s.busRule;

export type LockState = "shut" | "open" | "next-login" | "asks";
export interface Lock {
  name: string;
  state: LockState;
  words: string;
}

/** Each door, and how it stands right now (said in the panel, under the switch). */
export function locks(s: InputControl): Lock[] {
  const kwin: LockState = s.doorShut === true ? "shut" : s.busRule ? "next-login" : "open";
  const xtest: LockState = s.xtestOffNow === true ? "shut" : s.xtestWrapper ? "next-login" : s.noPrompt ? "open" : "asks";
  return [
    { name: "KWin's own door", state: kwin, words: "hands any program a keyboard and mouse, with no window" },
    { name: "Remote-control apps (the portal)", state: s.busRule === "all" ? "shut" : "asks", words: "how RustDesk and sandboxed apps ask to control this computer" },
    { name: "X11 programs (XTEST)", state: xtest, words: "how xdotool and older programs type and click" },
    { name: "/dev/uinput", state: s.uinputOpen ? "open" : "shut", words: "a fake keyboard or mouse, with no window at all" },
  ];
}

export const LOCK_WORDS: Record<LockState, string> = {
  shut: "shut",
  open: "open, no window",
  "next-login": "shut from your next login",
  asks: "KDE's window asks",
};

// No error is hidden: what may not be there is looked for first
// (a service, an ACL), and each lock is checked after it is written — or the command fails, out loud.
export const UINPUT = "/dev/uinput";
const KW = "kwriteconfig6 --file kwinrc --group Xwayland";
const RECONFIGURE = "qdbus6 org.kde.KWin /KWin reconfigure";
/** KWin's own setting, read back: what was written is what KWin will read. */
const promptIs = (v: "true" | "false") =>
  `{ r=$(kreadconfig6 --file kwinrc --group Xwayland --key XwaylandEisNoPrompt); [ "$r" = ${v} ] || { echo "Fluff: KWin's setting says \\"$r\\", not ${v}." >&2; false; }; }`;
/** Nobody always allowed: KWin's list, read back, is empty. */
const nobodyAllowed = `{ r=$(kreadconfig6 --file kwinrc --group Xwayland --key XwaylandEisNoPromptApps); [ -z "$r" ] || { echo "Fluff: KWin still always allows: $r." >&2; false; }; }`;
const ASK_KDE = `${KW} --key XwaylandEisNoPrompt false && ${KW} --key XwaylandEisNoPromptApps --delete && ${RECONFIGURE} && ${promptIs("false")} && ${nobodyAllowed}`;
/** A service of yours switched off — only if it is there — and then checked stopped. */
const userOff = (unit: string, name: string) =>
  `{ ! systemctl --user cat ${unit} >/dev/null 2>&1 || systemctl --user disable --now ${unit}; } && { ! systemctl --user is-active -q ${unit} || { echo "Fluff: ${name} is still running." >&2; false; }; }`;
const REFRESH = "sudo udevadm control --reload && sudo udevadm trigger --name-match=/dev/uinput";
const OPEN_AGAIN = `sudo rm -f ${OUR_RULE} && ${REFRESH}`;
const CLOSE = [
  `printf '%s\\n' '# TuxCopilot: /dev/uinput closed to your account (Security). Delete this file to open it again.' 'KERNEL=="uinput", TAG-="uaccess", TAG-="udev-acl"' | sudo tee ${OUR_RULE} >/dev/null`,
  REFRESH,
  // the rule stops new ones; this removes today's — only if it is there — and then it must be closed
  `{ ! sudo getfacl -cp ${UINPUT} 2>/dev/null | grep -q "^user:$USER:" || sudo setfacl -x u:"$USER" ${UINPUT}; }`,
  `{ [ ! -w ${UINPUT} ] || { echo "Fluff: ${UINPUT} is still open to your account." >&2; false; }; }`,
  userOff("ydotool.service", "ydotool's service"),
].join(" && ");

// The session-bus rule (dbus-broker reads /etc/dbus-1/session.d). By path for KWin's door — a
// call's path is never missing, so nothing else of KWin's is touched; by interface for the portal,
// whose other parts (screen sharing) share its path. Rehearsed on a private bus (dbus-daemon,
// the reference): those four refused, KWin's other calls and the portal's ScreenCast answered.
export function busRuleText(level: "kwin" | "all"): string[] {
  const deny = (dest: string, what: string) => `    <deny send_destination="${dest}" ${what}/>`;
  return [
    "<!DOCTYPE busconfig PUBLIC \"-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN\" \"http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd\">",
    `<!-- TuxCopilot: no program may take your keyboard and mouse without a window (Security, ${level === "all" ? "Block" : "Ask"}). Delete this file to undo. -->`,
    "<busconfig>",
    '  <policy context="mandatory">',
    deny("org.kde.KWin", 'send_path="/org/kde/KWin/EIS/RemoteDesktop"'),
    deny("org.kde.KWin", 'send_path="/org/kde/KWin/EIS/InputCapture"'),
    ...(level === "all"
      ? [deny("org.freedesktop.portal.Desktop", 'send_interface="org.freedesktop.portal.RemoteDesktop"'), deny("org.freedesktop.portal.Desktop", 'send_interface="org.freedesktop.portal.InputCapture"')]
      : []),
    "  </policy>",
    "</busconfig>",
  ];
}

const RELOAD_BUS = "busctl --user call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus ReloadConfig";
// it checks itself: KWin's door must now refuse even to describe itself
const DOOR_CHECK = `{ ! busctl --user introspect org.kde.KWin /org/kde/KWin/EIS/RemoteDesktop >/dev/null 2>&1 || { echo "Fluff: KWin's door still answers. Log out and in again, then look here." >&2; false; }; }`;
const writeBusRule = (level: "kwin" | "all") =>
  `printf '%s\\n' ${busRuleText(level).map((l) => `'${l}'`).join(" ")} | sudo tee ${BUS_RULE} >/dev/null && ${RELOAD_BUS} >/dev/null && ${DOOR_CHECK}`;
const BUS_OPEN = `sudo rm -f ${BUS_RULE} && ${RELOAD_BUS} >/dev/null`;
const XTEST_OFF = [
  `{ [ ! -e ${XWAYLAND} ] || grep -qs TuxCopilot ${XWAYLAND} || { echo "Fluff: ${XWAYLAND} is not TuxCopilot's, so it is left alone." >&2; false; }; }`,
  `printf '%s\\n' '#!/bin/sh' '# TuxCopilot: Xwayland without XTEST, so no X11 program can type or click for you (Security, Block). Delete this file to undo; it counts from your next login.' 'exec /usr/bin/Xwayland "$@" -extension XTEST' | sudo tee ${XWAYLAND} >/dev/null`,
  `sudo chmod 755 ${XWAYLAND}`,
  `{ [ -x ${XWAYLAND} ] && grep -q -- '-extension XTEST' ${XWAYLAND} || { echo "Fluff: ${XWAYLAND} wasn't written as it should be." >&2; false; }; }`,
].join(" && ");
const XTEST_ON = `{ ! grep -qs TuxCopilot ${XWAYLAND} || sudo rm -f ${XWAYLAND}; }`; // only ever TuxCopilot's own file
const KRDP_OFF = userOff("app-org.kde.krdpserver.service", "KDE's Remote Desktop server");

/** The command that sets the switch, from how it is now. */
export function inputModeCommand(to: InputMode, now: InputControl): string {
  const ask = ASK_KDE;
  const undo = (keepBus: boolean) => [...(now.ourRule ? [OPEN_AGAIN] : []), ...(now.xtestWrapper ? [XTEST_ON] : []), ...(!keepBus && now.busRule ? [BUS_OPEN] : [])];
  const parts =
    to === "allow"
      ? [`${KW} --key XwaylandEisNoPrompt true && ${RECONFIGURE} && ${promptIs("true")}`, ...undo(false)]
      : to === "ask"
        ? [ask, ...undo(true), writeBusRule("kwin")]
        : [ask, CLOSE, writeBusRule("all"), XTEST_OFF, ...(now.krdpOn ? [KRDP_OFF] : [])];
  return parts.join(" && ");
}

/** As KDE comes (Security → Devices, As it comes): KDE's window asks, nobody always allowed, and
 *  every lock of Fluff's taken away — KWin's door without a window open again, as it came. */
export function inputArchCommand(now: InputControl): string {
  const parts = [
    ASK_KDE,
    ...(now.ourRule ? [OPEN_AGAIN] : []),
    ...(now.xtestWrapper ? [XTEST_ON] : []),
    ...(now.busRule ? [BUS_OPEN] : []),
  ];
  return parts.join(" && ");
}

/** After Block: the way back, if you can't pass "type and click" in time (hands-check.ts). */
export const undoBlock = (before: InputMode, after: InputControl): string => inputModeCommand(before === "block" ? "ask" : before, after);

const AFFECTED_WORDS: Record<string, string> = {
  onboard: "Onboard (the on-screen keyboard) can't type into X11 programs",
  xdotool: "xdotool can't type or click",
  rustdesk: "RustDesk: nobody can control this computer through it",
  "rustdesk-bin": "RustDesk: nobody can control this computer through it",
  keepassxc: "KeePassXC's auto-type stops (copy and paste still works)",
  "input-leap": "Input Leap can't share a mouse with another computer",
  barrier: "Barrier can't share a mouse with another computer",
  deskflow: "Deskflow can't share a mouse with another computer",
};

/** What Block stops working, said before you choose it. */
export const blockCosts = (s: InputControl): string[] => [
  ...s.uinputGivers.map((p) => (p === "opentabletdriver" ? "OpenTabletDriver (your drawing tablet) stops working" : `${p} may stop working (it opens /dev/uinput)`)),
  ...s.affected.flatMap((p) => (AFFECTED_WORDS[p] ? [AFFECTED_WORDS[p]] : [])),
  ...(s.krdpOn ? ["KDE's Remote Desktop server is switched off"] : []),
  ...(s.ydotoolOn ? ["ydotool's service is switched off"] : []),
];
