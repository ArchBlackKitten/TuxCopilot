// The lock (gate.rs, lock.rs): what keeps your data yours. TuxCopilot's database is sealed;
// it opens with the 30-second code from your phone AND your password code. While open, it
// locks itself after a pause; either one (your choice) opens it again. The seed — words on
// paper, never stored — brings it back when the phone or the password code is lost.

import { inv } from "./host";

export interface PauseSettings {
  afterMinutes: number; // 0: never locks while open
  unlockWith: "password" | "code";
}

export interface LockStatus {
  setUp: boolean;
  open: boolean;
  paused: boolean;
  needsRecovery: boolean; // a sealed database with no lock.json: the seed (and recovery file) bring it back
  pause: PauseSettings;
  waitSeconds: number;
  tied?: boolean; // tied to this computer's security chip (TPM)
}

export interface Enrol {
  qr: string; // SVG for the phone's authenticator app
  secret: string; // the same, to type by hand
  seed: string[]; // empty when recovering
}

export const lockStatus = () => inv<LockStatus>("lock_status");
export const setupBegin = (words: number) => inv<Enrol>("lock_setup_begin", { words });
export const setupCode = (code: string) => inv("lock_setup_code", { code });
export const recoveryText = () => inv<string>("lock_recovery_text");
export const setupFinish = (password: string, typed: Array<[number, string]>) => inv("lock_setup_finish", { password, typed });
export const openLock = (code: string, password: string) => inv("lock_open", { code, password });
export const pauseLock = () => inv("lock_pause");
export const resumeLock = (answer: string) => inv("lock_resume", { answer });
export const recoverBegin = (seed: string, recoveryFile: string | null) => inv<Enrol>("lock_recover_begin", { seed, recoveryFile });
export const lockNow = () => inv("lock_now");

// Settings → Lock and signing: changes to the lock itself (each one asked for twice or confirmed)
export const setPause = (afterMinutes: number, unlockWith: "password" | "code") => inv("lock_set_pause", { afterMinutes, unlockWith });
export const changePassword = (current: string, next: string) => inv("lock_change_password", { current, new: next });
/** Tie the lock to this computer's security chip, or untie it (asks for the password code). */
export const tieLock = (password: string, on: boolean) => inv("lock_tie", { password, on });
export const newPhoneBegin = (current: string) => inv<Enrol>("lock_new_phone_begin", { current });
export const newPhoneFinish = (code: string) => inv("lock_new_phone_finish", { code });

/** The QR code as an <img> source (it is an SVG TuxCopilot drew itself). */
export const qrSrc = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`;

/** "ABCD EFGH IJKL …" — the secret, easier to type by hand. */
export const grouped = (secret: string) => secret.replace(/(.{4})/g, "$1 ").trim();

/** Which seed words to type back: three different ones, chosen at random (all of them for a shorter seed). */
export function askBack(count: number, random: () => number = Math.random): number[] {
  const all = Array.from({ length: count }, (_, i) => i);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, Math.min(3, count)).sort((a, b) => a - b);
}

/** Only digits, and spaces taken out: what the 30-second code box accepts. */
export const codeDigits = (typed: string) => typed.replace(/\s+/g, "").replace(/\D/g, "").slice(0, 6);

/** lock.rs MIN_PASSWORD: the password code opens the files on its own, so at least this long. */
export const MIN_PASSWORD = 8;
export const passwordLongEnough = (p: string) => [...p].length >= MIN_PASSWORD;

/** What a seed of `n` words means, in plain words. Fewer than 6 asks to be sure. */
export function seedWarning(n: number): { level: "ok" | "weaker" | "weak"; text: string } {
  if (!Number.isFinite(n) || n < 1) return { level: "weak", text: "Choose how many words." };
  if (n >= 9) return { level: "ok", text: n === 9 ? "9 words: the standard — far beyond guessing." : `${n} words: even harder to guess than the standard 9.` };
  if (n >= 6) return { level: "weaker", text: `${n} words: weaker than 9. Someone with a copy of TuxCopilot's files could try about 2048^${n} combinations — still a very long time.` };
  return {
    level: "weak",
    text: `${n} word${n === 1 ? "" : "s"}: easy to guess. The seed words open your data on their own, and someone with a copy of TuxCopilot's files could try all ${n === 1 ? "2,048 words" : `2048^${n} combinations`} quickly. Fluff recommends 9.`,
  };
}

/** The review (2.4): sealing replaces the old, unlocked database, but a disk keeps deleted bytes in its
 * free space until they are written over (btrfs copies on write), so say it once, at setup. */
export const BEFORE_THE_LOCK =
  "One more honest thing: if you used TuxCopilot before it had this lock, its old, unlocked data may still sit in the disk's free space until it is written over. On a disk encrypted when Arch was installed (LUKS), it is as safe as everything else on that disk; on a disk that isn't, someone holding the disk could read it.";

