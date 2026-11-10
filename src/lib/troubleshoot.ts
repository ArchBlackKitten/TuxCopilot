// Troubleshoot and Reset for the things that run in the background (Docker, Ollama).
// The checks only read; each failed one names the cause in plain words and offers the
// command that fixes it, which runs (after "Are you sure?") like any other.

import { execOut, execRaw } from "./host";
import { parseOllamaVersion } from "./ollama";

export interface Fix {
  label: string;
  command: string;
  note: string;
}

export interface Check {
  id: string;
  label: string;
  ok: boolean | null; // null: could not tell (an earlier check failed)
  detail: string;
  fix?: Fix;
}

export interface Diagnosis {
  checks: Check[];
  errors: string[]; // recent error lines from its log, newest last
  resets: Fix[];
}

/** The report as plain lines, for the terminal panel. */
export function formatReport(title: string, d: Diagnosis): string {
  const out = [`── TROUBLESHOOT ─ ${title}`, "only reads; nothing was changed", ""];
  for (const c of d.checks) {
    const mark = c.ok === true ? "✓" : c.ok === false ? "✗" : "?";
    out.push(`${mark} ${c.label} — ${c.ok === null ? "can't tell until the checks above pass" : c.detail}`);
    if (c.fix) out.push(`    fix: ${c.fix.command}`);
  }
  const bad = d.checks.filter((c) => c.ok === false).length;
  out.push("", bad ? `${bad} problem${bad === 1 ? "" : "s"} — press its fix in the Troubleshoot window, or copy the command.` : "every check passed");
  if (d.errors.length) out.push("", "recent errors in its log:", ...d.errors.map((l) => `  ${l}`));
  return out.join("\n") + "\n";
}

/** Error-looking lines from a journal, newest last (at most 12). */
export function errorLines(journal: string, pattern: RegExp): string[] {
  return journal
    .split("\n")
    .filter((l) => pattern.test(l))
    .slice(-12);
}

const groups = async () => (await execOut("id", ["-nG"]))?.trim().split(/\s+/) ?? [];
// written out per unit, so the probe-allowlist gate can see every line that is run
type Unit = "docker.service" | "ollama.service";
const IS_ACTIVE: Record<Unit, () => Promise<string | null>> = {
  "docker.service": () => execOut("systemctl", ["is-active", "docker.service"]),
  "ollama.service": () => execOut("systemctl", ["is-active", "ollama.service"]),
};
// is-enabled exits non-zero for "disabled", so read what it printed either way
const IS_ENABLED: Record<Unit, () => Promise<{ stdout: string } | null>> = {
  "docker.service": () => execRaw("systemctl", ["is-enabled", "docker.service"]),
  "ollama.service": () => execRaw("systemctl", ["is-enabled", "ollama.service"]),
};
const active = async (unit: Unit) => (await IS_ACTIVE[unit]())?.trim() === "active";
const enabled = async (unit: Unit) => (await IS_ENABLED[unit]())?.stdout.trim() ?? "";

// ── Docker ───────────────────────────────────────────────────────────────

export async function diagnoseDocker(): Promise<Diagnosis> {
  const checks: Check[] = [];
  const installed = (await execOut("docker", ["--version"])) !== null;
  checks.push({
    id: "installed",
    label: "Docker is installed",
    ok: installed,
    detail: installed ? "the docker program is there" : "the docker program is missing",
    fix: installed ? undefined : { label: "Install Docker", command: "sudo pacman -Syu --needed --noconfirm docker docker-compose", note: "Docker and its compose plugin, from the official repos" },
  });
  const compose = installed && (await execOut("docker", ["compose", "version"])) !== null;
  checks.push({
    id: "compose",
    label: "docker compose works",
    ok: installed ? compose : null,
    detail: compose ? "the compose plugin is there" : "apps like Firefly III are started with docker compose, which is missing",
    fix: installed && !compose ? { label: "Install compose", command: "sudo pacman -Syu --needed --noconfirm docker-compose", note: "the compose plugin" } : undefined,
  });
  const running = installed && (await active("docker.service"));
  const boot = installed ? await enabled("docker.service") : "";
  checks.push({
    id: "service",
    label: "The Docker service is running",
    ok: installed ? running : null,
    detail: running
      ? `running${boot === "enabled" ? ", and starts at boot" : " (it does not start at boot by itself)"}`
      : "the Docker service is stopped, so no container can run",
    fix: installed && (!running || boot !== "enabled")
      ? { label: running ? "Start at boot" : "Start Docker", command: "sudo systemctl enable --now docker.service", note: "starts it now and at every boot" }
      : undefined,
  });
  const inGroup = (await groups()).includes("docker");
  checks.push({
    id: "group",
    label: "You may use Docker without sudo",
    ok: installed ? inGroup : null,
    detail: inGroup ? "you are in the docker group" : "you are not in the docker group, so docker says \"permission denied\"",
    fix: installed && !inGroup
      ? { label: "Add me to the docker group", command: "sudo usermod -aG docker $USER", note: "takes effect after you log out and back in (or restart). It lets any program you run act as root without your password; Security can take you out again" }
      : undefined,
  });
  const info = installed && running ? await execRaw("docker", ["info", "--format", "{{json .ServerVersion}}"]) : null;
  const answered = info?.code === 0;
  const why = info?.stderr ?? "";
  checks.push({
    id: "daemon",
    label: "Docker answers",
    ok: installed && running ? answered : null,
    detail: answered
      ? `Docker ${info?.stdout.trim().replace(/"/g, "")} answered`
      : /permission denied/i.test(why)
        ? inGroup
          ? "permission denied — you were added to the docker group, but this login started before that: log out and back in"
          : "permission denied — see the docker group check above"
        : why.trim().split("\n")[0] || "no answer from the Docker service",
    fix: installed && running && !answered && !/permission denied/i.test(why)
      ? { label: "Restart Docker", command: "sudo systemctl restart docker.service", note: "stops and starts the Docker service" }
      : undefined,
  });
  const df = answered ? await execOut("docker", ["system", "df", "--format", "{{json .}}"]) : null;
  if (df) {
    const rows = df.split("\n").filter(Boolean).flatMap((l) => {
      try {
        return [JSON.parse(l) as { Type: string; Size: string; Reclaimable: string }];
      } catch {
        return [];
      }
    });
    checks.push({
      id: "space",
      label: "Disk space used by Docker",
      ok: true,
      detail: rows.map((r) => `${r.Type}: ${r.Size} (${r.Reclaimable} could be freed)`).join(" · "),
    });
  }
  const journal = (await execOut("journalctl", ["-u", "docker.service", "-n", "200", "--no-pager", "-o", "short-iso"])) ?? "";
  return {
    checks,
    errors: errorLines(journal, /level=(error|fatal)|\bfailed\b/i),
    resets: [
      { label: "Restart Docker", command: "sudo systemctl restart docker.service", note: "stops and starts the Docker service. Apps set to restart come back by themselves." },
      { label: "Clean up", command: "docker system prune -f", note: "removes stopped containers, unused networks and leftover image layers. Never your volumes (your apps' data) and never images a container uses." },
    ],
  };
}

// ── Ollama ───────────────────────────────────────────────────────────────

export async function diagnoseOllama(): Promise<Diagnosis> {
  const checks: Check[] = [];
  const vOut = await execOut("ollama", ["--version"]);
  const version = vOut === null ? null : (parseOllamaVersion(vOut) ?? "installed");
  checks.push({
    id: "installed",
    label: "Ollama is installed",
    ok: version !== null,
    detail: version ?? "the ollama program is missing",
    fix: version ? undefined : { label: "Install Ollama", command: "sudo pacman -Syu --needed --noconfirm ollama", note: "from the official repos (ollama-cuda or ollama-rocm use your graphics card)" },
  });
  const running = version !== null && (await active("ollama.service"));
  const boot = version !== null ? await enabled("ollama.service") : "";
  // `ollama list` talks to the server: it answers when either the service or `ollama serve` runs
  const answers = version !== null && (await execOut("ollama", ["list"], 8000)) !== null;
  checks.push({
    id: "service",
    label: "The Ollama server is running",
    ok: version !== null ? answers : null,
    detail: answers
      ? running
        ? `the service is running${boot === "enabled" ? " and starts at boot" : ""}`
        : "a server answers (started by hand with `ollama serve`, not the service)"
      : running
        ? "the service is running but does not answer — it may be stuck"
        : "no server runs, so models can't be listed or used",
    fix: version !== null && !answers
      ? running
        ? { label: "Restart Ollama", command: "sudo systemctl restart ollama.service", note: "stops and starts the Ollama service" }
        : boot === "not-found"
          ? undefined
          : { label: "Start Ollama", command: "sudo systemctl enable --now ollama.service", note: "starts it now and at every boot" }
      : undefined,
  });
  const journal = version !== null ? ((await execOut("journalctl", ["-u", "ollama.service", "-n", "200", "--no-pager", "-o", "short-iso"])) ?? "") : "";
  return {
    checks,
    errors: errorLines(journal, /level=(ERROR|WARN)|\berror\b|out of memory|CUDA error/i),
    resets: version === null ? [] : [
      { label: "Restart Ollama", command: "sudo systemctl restart ollama.service", note: "stops and starts the server; loaded models are unloaded, nothing is deleted" },
      { label: "Unload models", command: "ollama ps | awk 'NR>1 {print $1}' | xargs -r -n1 ollama stop", note: "frees the memory the loaded models hold, without restarting" },
    ],
  };
}
