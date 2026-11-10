// What a file's checksum and signature say, in plain words (integrity.rs does the checking).
// Every export is saved with its SHA-256 checksum, and signed when you chose your GPG key
// (Settings → Lock and signing); every import is refused when either one says it was changed.

import { inv } from "./host";

export type Signature =
  | { state: "none" }
  | { state: "good"; signer: string; fingerprint: string }
  | { state: "bad" }
  | { state: "unknownKey"; key: string }
  | { state: "unchecked"; why: string };

export interface Integrity {
  sha256: string;
  checksum: "match" | "mismatch" | "missing";
  signature: Signature;
}

export interface Saved {
  path: string;
  sha256: string;
  signed: boolean;
  signError: string | null;
}

export interface Verdict {
  ok: boolean; // false: refused
  note: string;
}

const short = (hex: string) => `${hex.slice(0, 12)}…`;

/** Whether an imported file may be used, and what to tell you about it. */
export function importVerdict(i: Integrity): Verdict {
  if (i.checksum === "mismatch")
    return { ok: false, note: "Refused: this file was changed after it was made — its SHA-256 checksum does not match." };
  if (i.signature.state === "bad")
    return { ok: false, note: "Refused: its GPG signature does not match the file — it was changed after it was signed." };
  const sum = i.checksum === "match" ? `checksum matches (SHA-256 ${short(i.sha256)})` : `no checksum came with it (SHA-256 ${short(i.sha256)})`;
  switch (i.signature.state) {
    case "good":
      return { ok: true, note: `Signed by ${i.signature.signer}; ${sum}.` };
    case "unknownKey":
      return { ok: true, note: `Signed with a key you do not have (${i.signature.key}), so who made it cannot be checked; ${sum}.` };
    case "unchecked":
      return { ok: true, note: `Its signature could not be checked (${i.signature.why}); ${sum}.` };
    default:
      return { ok: true, note: `Not signed; ${sum}.` };
  }
}

/** What saving did, for the message after an export. */
export function savedNote(s: Saved, signWith: string | null): string {
  const base = `${s.path} — with its SHA-256 checksum beside it (${short(s.sha256)}).`;
  if (s.signed) return `${base} Signed with your GPG key.`;
  if (s.signError) return `${base} Not signed: ${s.signError}`;
  return signWith ? base : `${base} Tip: sign your exports with your GPG key (Settings → Lock and signing), so anyone can tell they came from you.`;
}

// ── saving ───────────────────────────────────────────────────────────────

let signer: string | null = null;

/** The key exports are signed with (the saved choice in Settings → Lock and signing). */
export const setExportSigner = (fingerprint: string | null) => {
  signer = fingerprint;
};
export const exportSigner = () => signer;

/** Save dialog → the file, its .sha256, and its .asc when a key is chosen. null: cancelled. */
export const saveFile = (defaultName: string, contents: string) =>
  inv<Saved | null>("save_file", { defaultName, contents, signWith: signer });

/** The chosen key, kept in the app's database (null: exports are not signed). */
export async function getSignWith(): Promise<string | null> {
  try {
    const v = await inv<string | null>("setting_get", { key: "export.signWith" });
    return v && /^[0-9A-F]{40}$/i.test(v) ? v : null;
  } catch {
    return null;
  }
}
export const saveSignWith = (fingerprint: string | null) => inv("setting_set", { key: "export.signWith", value: fingerprint ?? "" });

export const gpgKeys = () => inv<Array<{ fingerprint: string; user: string }>>("gpg_keys");
