// The kernel's own protections. The command runs here for real
// against a fake sysctl that reads back the file it was given.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileLines, HARDENING_FILE, presetChanges, presetCommand, presetNow, SETTINGS } from "@/lib/hardening";
import { tuxPath } from "@/lib/tux-own";

// a sample computer (bpf_jit_harden: only root may read it)
const HERE: Record<string, string | null> = {
  "kernel.kptr_restrict": "2", "kernel.dmesg_restrict": "1", "kernel.yama.ptrace_scope": "1", "kernel.unprivileged_bpf_disabled": "2", "net.core.bpf_jit_harden": null,
  "fs.protected_fifos": "1", "fs.protected_regular": "1", "dev.tty.ldisc_autoload": "1",
  "net.ipv4.conf.all.accept_redirects": "0", "net.ipv4.conf.default.accept_redirects": "1", "net.ipv6.conf.all.accept_redirects": "1", "net.ipv6.conf.default.accept_redirects": "1",
  "net.ipv4.conf.all.send_redirects": "1", "net.ipv4.conf.default.send_redirects": "1", "kernel.kexec_load_disabled": "0", "kernel.sysrq": "16",
};

function machine(refuse = "") {
  const root = mkdtempSync(join(tmpdir(), "tux-sysctl-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const file = join(root, "99-tuxcopilot-hardening.conf");
  writeFileSync(join(bin, "sudo"), '#!/bin/bash\nexec "$@"\n');
  // -w KEY=VALUE: the kernel's value (a one-way one, once on, refuses to go off — as the kernel does);
  // -n KEY: the value (one key the kernel refuses keeps its old value)
  const v = join(root, "values");
  writeFileSync(v, "");
  writeFileSync(
    join(bin, "sysctl"),
    `#!/bin/bash
get() { grep "^$1=" ${v} | tail -n1 | sed 's/^[^=]*=//'; }
case " $* " in
  *" -w "*) kv="\${@: -1}"; k=\${kv%%=*}; x=\${kv#*=}
    if [ "$k" = kernel.kexec_load_disabled ] && [ "$(get $k)" = 1 ] && [ "$x" = 0 ]; then echo "sysctl: setting key \"$k\": Invalid argument" >&2; exit 255; fi
    echo "$k=$x" >> ${v};;
  *" -n "*) [ "$2" = "${refuse}" ] && { echo old; exit 0; }; get "$2";;
  *" --system "*) touch ${root}/system;;
esac
`,
  );
  for (const f of ["sudo", "sysctl"]) chmodSync(join(bin, f), 0o755);
  const run = (cmd: string) => {
    try {
      return execFileSync("bash", ["-c", cmd.replaceAll(HARDENING_FILE, file)], { encoding: "utf8", stdio: "pipe", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    } catch (e) {
      throw new Error(`stderr: ${String((e as { stderr?: string }).stderr)}`);
    }
  };
  return { root, file, run };
}

describe("the kernel's own protections", () => {
  it("this computer runs the usual values; Recommended changes 9, none costing anything but dmesg's, already so", () => {
    expect(presetNow(HERE, false)).toBe("usual");
    const ch = presetChanges(HERE, "recommended");
    expect(ch.map((s) => s.key)).toEqual([
      "net.core.bpf_jit_harden", "fs.protected_fifos", "fs.protected_regular", "dev.tty.ldisc_autoload",
      "net.ipv4.conf.default.accept_redirects", "net.ipv6.conf.all.accept_redirects", "net.ipv6.conf.default.accept_redirects",
      "net.ipv4.conf.all.send_redirects", "net.ipv4.conf.default.send_redirects",
    ]);
    expect(ch.filter((s) => s.cost && s.key !== "net.core.bpf_jit_harden")).toEqual([]);
  });

  it("Strict adds the three that cost something, each said; kexec is one-way until a restart", () => {
    const extra = SETTINGS.filter((s) => s.strict !== s.recommended);
    expect(extra.map((s) => s.key)).toEqual(["kernel.yama.ptrace_scope", "kernel.kexec_load_disabled", "kernel.sysrq"]);
    for (const s of extra) expect(s.cost, s.key).toMatch(/\S/);
    expect(SETTINGS.find((s) => s.key === "kernel.kexec_load_disabled")?.oneWay).toBe(true);
  });

  it("the preset now: recommended, strict, or a mix (an unreadable value isn't held against it)", () => {
    const rec = Object.fromEntries(SETTINGS.map((s) => [s.key, s.recommended]));
    const strict = Object.fromEntries(SETTINGS.map((s) => [s.key, s.strict]));
    expect(presetNow(rec, true)).toBe("recommended");
    expect(presetNow({ ...rec, "net.core.bpf_jit_harden": null }, true)).toBe("recommended");
    expect(presetNow(strict, true)).toBe("strict");
    expect(presetNow({ ...rec, "fs.protected_fifos": "1" }, true)).toBeNull();
  });

  it("applied: TuxCopilot's file written, applied alone, and every value checked", () => {
    const m = machine();
    m.run(presetCommand("recommended"));
    expect(readFileSync(m.file, "utf8")).toBe(fileLines("recommended").join("\n") + "\n");
    expect(readFileSync(m.file, "utf8")).toContain("fs.protected_regular = 2\n");
    expect(existsSync(join(m.root, "system"))).toBe(false); // only its own file, not every file again
  });

  it("a value the kernel didn't take: said, and the command fails", () => {
    const m = machine("dev.tty.ldisc_autoload");
    expect(() => m.run(presetCommand("strict"))).toThrow(/^stderr: Fluff: the kernel didn't take: dev\.tty\.ldisc_autoload/);
  });

  it("down from Strict: a one-way protection that is on stays on, and is said — the rest applied, nothing failed", () => {
    const m = machine();
    m.run(presetCommand("strict"));
    const out = m.run(presetCommand("recommended"));
    expect(out).toContain("Fluff: kernel.kexec_load_disabled stays on until the next restart: once on, the kernel doesn't let it go.");
    expect(readFileSync(m.file, "utf8")).toContain("kernel.kexec_load_disabled = 0\n"); // from the next start
    // Strict again over Strict: nothing to say, it is on as asked
    expect(m.run(presetCommand("strict"))).not.toContain("stays on");
    // but a value the kernel didn't take is still a failure, one-way or not
    expect(() => machine("kernel.kexec_load_disabled").run(presetCommand("strict"))).toThrow(/^stderr: Fluff: the kernel didn't take: kernel\.kexec_load_disabled$/m);
  });

  it("Usual: the file goes and the system's own files are applied again", () => {
    const m = machine();
    writeFileSync(m.file, "x");
    expect(m.run(presetCommand("usual"))).toMatch(/some only at the next restart/);
    expect(existsSync(m.file)).toBe(false);
    expect(existsSync(join(m.root, "system"))).toBe(true);
  });

  it("every setting exists in this kernel; the file is TuxCopilot's and tagged; the reader knows the same settings", () => {
    for (const s of SETTINGS) expect(existsSync(`/proc/sys/${s.key.replaceAll(".", "/")}`), s.key).toBe(true);
    for (const l of fileLines("strict")) expect(l).not.toContain("'");
    expect(tuxPath(HARDENING_FILE)).toMatch(/kernel's own protections/);
    const rs = readFileSync("src-tauri/src/kernel.rs", "utf8");
    const keys = [...rs.slice(rs.indexOf("pub const KEYS"), rs.indexOf("];", rs.indexOf("pub const KEYS"))).matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(keys).toEqual(SETTINGS.map((s) => s.key));
    expect(rs).toContain(`pub const FILE: &str = "${HARDENING_FILE}";`);
  });
});
