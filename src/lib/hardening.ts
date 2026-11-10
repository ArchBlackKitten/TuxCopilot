// The kernel's own protections, three presets in the
// firewall's way — each setting said, with what it costs:
//   Usual        as Arch and CachyOS set it (TuxCopilot's file removed)
//   Recommended  every protection that costs nothing on a desktop (Fluff recommends)
//   Strict       Recommended, and three that cost something, each said
// One file of TuxCopilot's, /etc/sysctl.d/99-tuxcopilot-hardening.conf; the command applies it and
// checks, as root, that the kernel took every value.

import { inv } from "./host";

export const kernelSettings = () => inv<{ values: Record<string, string | null>; fileThere: boolean }>("kernel_settings"); // kernel.rs
export const HARDENING_FILE = "/etc/sysctl.d/99-tuxcopilot-hardening.conf";

export interface Setting {
  key: string;
  what: string;
  cost: string; // "" = none on a desktop
  recommended: string;
  strict: string;
  oneWay?: boolean; // once on, it stays on until the computer restarts
}

const redirects = (key: string, v6: boolean): Setting => ({
  key,
  what: `Ignore${v6 ? " IPv6" : ""} "go this way instead" messages from the network (ICMP redirects): someone on the same Wi-Fi could use them to send your traffic through their computer.`,
  cost: "",
  recommended: "0",
  strict: "0",
});

export const SETTINGS: Setting[] = [
  { key: "kernel.kptr_restrict", what: "Hide where the kernel sits in memory, which an attack needs to know.", cost: "", recommended: "2", strict: "2" },
  { key: "kernel.dmesg_restrict", what: "Only root reads the kernel's own log (it can show memory addresses and devices).", cost: "dmesg needs sudo.", recommended: "1", strict: "1" },
  { key: "kernel.yama.ptrace_scope", what: "Who may look inside a running program: 1 — only a program's own parent (a debugger it started); 2 — only root.", cost: "Strict (2): debuggers can't attach to a program already running (gdb -p, strace -p), and a few games' anti-cheat stop.", recommended: "1", strict: "2" },
  { key: "kernel.unprivileged_bpf_disabled", what: "Ordinary programs may not load BPF programs into the kernel (a common way in).", cost: "", recommended: "2", strict: "2" },
  { key: "net.core.bpf_jit_harden", what: "BPF programs the kernel compiles are hardened against tricks that hide code in them.", cost: "BPF runs a little slower (you won't notice on a desktop).", recommended: "2", strict: "2" },
  { key: "fs.protected_fifos", what: "In shared folders like /tmp, a program can't be tricked into writing into someone else's pipe.", cost: "", recommended: "2", strict: "2" },
  { key: "fs.protected_regular", what: "In shared folders like /tmp, a program can't be tricked into writing into someone else's file.", cost: "", recommended: "2", strict: "2" },
  { key: "dev.tty.ldisc_autoload", what: "Old terminal drivers (line disciplines) aren't loaded just because a program asks — several attacks used them.", cost: "", recommended: "0", strict: "0" },
  redirects("net.ipv4.conf.all.accept_redirects", false),
  redirects("net.ipv4.conf.default.accept_redirects", false),
  redirects("net.ipv6.conf.all.accept_redirects", true),
  redirects("net.ipv6.conf.default.accept_redirects", true),
  { key: "net.ipv4.conf.all.send_redirects", what: "Don't send \"go this way instead\" messages: that is a router's job, not a desktop's.", cost: "", recommended: "0", strict: "0" },
  { key: "net.ipv4.conf.default.send_redirects", what: "The same, for networks that appear later (a VPN, a dock).", cost: "", recommended: "0", strict: "0" },
  { key: "kernel.kexec_load_disabled", what: "No program may swap the running kernel for another without a restart.", cost: "Strict: tools that restart into a new kernel fast (kexec) stop. Once on, it stays on until the computer restarts.", recommended: "0", strict: "1", oneWay: true },
  { key: "kernel.sysrq", what: "The keyboard's emergency keys (Alt+SysRq): 16 lets them only save files to disk; 0 switches them off.", cost: "Strict (0): no emergency keys at all, also not to save files when the computer freezes.", recommended: "16", strict: "0" },
];

export type Preset = "usual" | "recommended" | "strict";
export const PRESETS: Array<{ id: Preset; label: string; what: string }> = [
  { id: "usual", label: "Usual", what: "As Arch and CachyOS set it. Some values come back only at the next restart." },
  { id: "recommended", label: "Recommended", what: "Every protection that costs nothing on a desktop." },
  { id: "strict", label: "Strict", what: "Recommended, and three that cost something: debuggers, fast kernel swaps, the emergency keys." },
];

/** Which preset the kernel runs now (null: none exactly — usual values, or a mix). An unreadable value counts as matching (only root may read it). */
export function presetNow(values: Record<string, string | null>, fileThere: boolean): Preset | null {
  const matches = (p: "recommended" | "strict") => SETTINGS.every((s) => values[s.key] == null || values[s.key] === s[p]);
  if (matches("strict") && SETTINGS.some((s) => s.strict !== s.recommended && values[s.key] === s.strict)) return "strict";
  if (matches("recommended")) return "recommended";
  return fileThere ? null : "usual";
}

/** The file's lines for a preset. */
export const fileLines = (p: "recommended" | "strict"): string[] => [
  `# TuxCopilot: protections of the kernel, ${p} (Security). Delete this file to undo; some values come back only at the next restart.`,
  ...SETTINGS.map((s) => `${s.key} = ${s[p]}`),
];

/** The command: written, applied, and checked as root that the kernel took every value. */
// A one-way protection (kexec off) can't be switched off while the computer runs: the kernel refuses
// the write. Going down from Strict, it is said — "it stays on until the next restart" — instead of
// failing the whole command after the file was written.
const stuckOn = (s: Setting, v: string) => (s.oneWay && v !== s.strict ? `[ "$(sudo sysctl -n ${s.key})" = "${s.strict}" ]` : "false");

export function presetCommand(p: Preset): string {
  if (p === "usual")
    return `sudo rm -f ${HARDENING_FILE} && sudo sysctl --system >/dev/null && echo "Fluff: the usual values are back; some only at the next restart."`;
  // each setting by itself: a one-way one that is on stays on, and is said
  const apply = SETTINGS.map((s) =>
    s.oneWay
      ? `{ if ${stuckOn(s, s[p])}; then echo "Fluff: ${s.key} stays on until the next restart: once on, the kernel doesn't let it go."; else sudo sysctl -q -w ${s.key}=${s[p]}; fi; }`
      : `sudo sysctl -q -w ${s.key}=${s[p]}`,
  ).join(" && ");
  const check = SETTINGS.map((s) => `{ [ "$(sudo sysctl -n ${s.key})" = "${s[p]}" ] || ${stuckOn(s, s[p])} || bad="$bad ${s.key}"; }`).join("; ");
  return [
    `printf '%s\\n' ${fileLines(p).map((l) => `'${l}'`).join(" ")} | sudo tee ${HARDENING_FILE} >/dev/null`,
    apply,
    `{ bad=; ${check}; [ -z "$bad" ] || { echo "Fluff: the kernel didn't take:$bad" >&2; false; }; }`,
  ].join(" && ");
}

/** What changes from now, said before you choose it (and what costs something). */
export function presetChanges(values: Record<string, string | null>, p: "recommended" | "strict"): Array<Setting & { now: string | null; to: string }> {
  return SETTINGS.filter((s) => values[s.key] !== s[p]).map((s) => ({ ...s, now: values[s.key] ?? null, to: s[p] }));
}
