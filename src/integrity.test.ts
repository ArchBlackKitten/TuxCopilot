// Imports and exports: a changed file is refused whatever else it carries; what is said
// about a file names who signed it, or why that could not be told; exports recommend signing.
import { describe, expect, it } from "vitest";
import { importVerdict, savedNote, type Integrity } from "@/lib/integrity";

const base: Integrity = { sha256: "0123456789abcdef".repeat(4), checksum: "match", signature: { state: "none" } };

describe("importing", () => {
  it("a changed file is refused, even when its signature is good", () => {
    expect(importVerdict({ ...base, checksum: "mismatch" }).ok).toBe(false);
    expect(importVerdict({ ...base, checksum: "mismatch", signature: { state: "good", signer: "me", fingerprint: "F".repeat(40) } }).ok).toBe(false);
    const bad = importVerdict({ ...base, signature: { state: "bad" } });
    expect(bad).toEqual({ ok: false, note: expect.stringMatching(/GPG signature does not match/) });
  });

  it("an unchanged file comes in, saying what is known about it", () => {
    expect(importVerdict({ ...base, signature: { state: "good", signer: "Kitten <k@x>", fingerprint: "F".repeat(40) } }).note).toMatch(/^Signed by Kitten <k@x>; checksum matches/);
    expect(importVerdict({ ...base, checksum: "missing" }).note).toMatch(/Not signed; no checksum came with it/);
    expect(importVerdict({ ...base, signature: { state: "unknownKey", key: "ABCD" } }).note).toMatch(/key you do not have \(ABCD\)/);
  });
});

describe("exporting", () => {
  const saved = { path: "/home/me/x.fluff", sha256: base.sha256, signed: false, signError: null };
  it("always names the checksum; recommends signing until a key is chosen", () => {
    expect(savedNote(saved, null)).toMatch(/with its SHA-256 checksum beside it.*Tip: sign your exports with your GPG key/);
    expect(savedNote({ ...saved, signed: true }, "F".repeat(40))).toMatch(/Signed with your GPG key\.$/);
    expect(savedNote({ ...saved, signError: "no passphrase given" }, "F".repeat(40))).toMatch(/Not signed: no passphrase given$/);
  });
});
