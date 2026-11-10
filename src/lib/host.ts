// The single frontend choke point for Tauri calls. Every invoke goes through inv(),
// enforced by a vitest guard (see host.guard.test.ts): no other module may import the raw
// `invoke`.
//
// The Next.js version ran its probes (child_process, fs, fetch) in a Node server. Under
// Tauri the logic stays here in TypeScript, and the Rust side lends only narrow, read-only
// primitives, each held to an allowlist in src-tauri/src/probe.rs:
//   execRaw / execOut  — a fixed set of argv lines (pacman -Qe, lspci, ollama list, …)
//   readText / readDir — a fixed set of /proc, /etc and /sys paths
//   httpGet            — GET only, to the package/repo sites the UI links to
// Running the user's own commands is a separate, deliberate path (the run manager).
import { invoke } from "@tauri-apps/api/core";

export async function inv<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}

/** Error text from a rejected inv() — Rust commands reject with a plain string. */
export function errText(e: unknown, fallback = "Something went wrong"): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return fallback;
}

export interface ExecResult {
  code: number | null; // null when killed (timeout) or signalled
  stdout: string;
  stderr: string;
}

/** Runs an allowlisted probe. null when the program is missing, refused, or timed out. */
export async function execRaw(cmd: string, args: string[], timeoutMs = 6000): Promise<ExecResult | null> {
  try {
    return await inv<ExecResult | null>("probe_exec", { argv: [cmd, ...args], timeoutMs });
  } catch {
    return null;
  }
}

/** execFile semantics: stdout on a zero exit, null otherwise. */
export async function execOut(cmd: string, args: string[], timeoutMs = 6000): Promise<string | null> {
  const r = await execRaw(cmd, args, timeoutMs);
  return r && r.code === 0 ? r.stdout : null;
}

export async function readText(path: string): Promise<string | null> {
  try {
    return await inv<string | null>("probe_read", { path });
  } catch {
    return null;
  }
}

/** Throws when the directory cannot be listed, as fs.readdir does. */
export async function readDir(path: string): Promise<string[]> {
  return inv<string[]>("probe_readdir", { path });
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  url: string; // after redirects
  text: string;
}

/** GET through the Rust side (a webview fetch would be stopped by CORS). null on network failure. */
export async function httpGet(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 8000
): Promise<HttpResponse | null> {
  try {
    return await inv<HttpResponse>("http_get", { url, headers, timeoutMs });
  } catch {
    return null;
  }
}

/** Opens an http(s) page in the desktop browser. */
export async function openExternal(url: string): Promise<void> {
  try {
    await inv("open_external", { url });
  } catch {
    // nothing sensible to do — the link simply doesn't open
  }
}

// Saving a file: saveFile in integrity.ts — every export travels with its checksum.
