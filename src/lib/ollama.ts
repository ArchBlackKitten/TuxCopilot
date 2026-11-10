// Ollama helpers: `ollama list` / `ollama ps` / `--version`, read through the host probes.

import { execOut } from "./host";

export interface OllamaModel {
  name: string;
  id: string;
  sizeGB: number | null;
  sizeRaw: string;
  modified: string;
}

export interface OllamaState {
  available: boolean;
  version: string | null;
  serverUp: boolean; // the server answered (models can only be listed and used then)
  models: OllamaModel[];
  running: Array<{ name: string }>;
}

function parseSizeGb(raw: string): number | null {
  const m = raw.trim().match(/^([\d.]+)\s*(GB|MB|KB|B)$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  if (unit === "GB") return Math.round(n * 10) / 10;
  if (unit === "MB") return Math.round((n / 1024) * 10) / 10;
  if (unit === "KB") return Math.round((n / 1024 ** 2) * 10) / 10;
  return Math.round((n / 1024 ** 3) * 10) / 10;
}

/**
 * "ollama version is 0.40.11" with the server up; with it down, warnings come first and the
 * number is on "Warning: client version is 0.40.11". Either way: the number after "version is".
 */
export function parseOllamaVersion(out: string): string | null {
  return out.match(/version is\s+v?([\w.+-]+)/)?.[1] ?? null;
}

export async function getOllamaState(): Promise<OllamaState> {
  const vOut = await execOut("ollama", ["--version"]);
  if (vOut === null) {
    return { available: false, version: null, serverUp: false, models: [], running: [] };
  }
  const version = parseOllamaVersion(vOut) ?? (vOut.split("\n")[0]?.trim() || null);

  const listOut = await execOut("ollama", ["list"]);
  const models: OllamaModel[] = [];
  if (listOut) {
    const lines = listOut.trim().split("\n");
    for (const line of lines.slice(1)) {
      const cols = line.trim().split(/\s{2,}|\t/).filter(Boolean);
      if (cols.length < 3) continue;
      const [name, id, sizeRaw] = cols;
      const modified = cols.length >= 4 ? cols.slice(3).join("  ") : "";
      models.push({ name, id, sizeGB: parseSizeGb(sizeRaw), sizeRaw, modified });
    }
  }

  const psOut = await execOut("ollama", ["ps"]);
  const running: Array<{ name: string }> = [];
  if (psOut) {
    for (const line of psOut.trim().split("\n").slice(1)) {
      const cols = line.trim().split(/\s{2,}|\t/).filter(Boolean);
      if (cols.length >= 1 && cols[0]) running.push({ name: cols[0] });
    }
  }

  return { available: true, version, serverUp: listOut !== null, models, running };
}
