// "Is this the real TuxCopilot?": each kind of copy is said for what it is — a signed release,
// the creator's code between releases, changed here, a fork, a bad signature, files pacman
// installed that changed — the worst first, and the outside checks never depend on this copy.
import { describe, expect, it } from "vitest";
import { findings, outsideChecks, sourceUrl, spacedKey, type OriginalFacts } from "@/lib/original";

const COMMIT = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const base: OriginalFacts = {
  version: "0.1.0",
  builtFrom: "git",
  commit: COMMIT,
  releaseKey: "1C30D7149E20A4724D92A4E324D4340FE9E2BF54",
  creatorRepo: "github.com/ArchBlackKitten/TuxCopilot",
  releaseTag: null,
  tagSigned: null,
  folder: "/home/me/TuxCopilot",
  folderMoved: false,
  origin: "https://github.com/ArchBlackKitten/TuxCopilot.git",
  originWeb: "https://github.com/ArchBlackKitten/TuxCopilot",
  isCreators: true,
  changedFiles: [],
  localCommits: 0,
  commitSigned: null,
  package: null,
  packageFiles: null,
  altered: [],
  unreadable: 0,
  exe: "/home/me/TuxCopilot/src-tauri/target/debug/tuxcopilot",
  exeSha256: "ab".repeat(32),
};
const ids = (f: Partial<OriginalFacts>) => findings({ ...base, ...f }).map((x) => `${x.level}:${x.id}`);

describe("is this the real TuxCopilot", () => {
  it("a release is said as one; the creator's clean folder is between releases", () => {
    expect(ids({ builtFrom: "release", folder: null, origin: null, isCreators: null, localCommits: null, releaseTag: "v0.1.0", package: "tuxcopilot", packageFiles: 9 })).toEqual(["ok:original", "ok:pacman"]);
    expect(findings({ ...base, builtFrom: "release", releaseTag: "v0.1.0" })[0].title).toBe("TuxCopilot v0.1.0, as its creator released it");
    expect(ids({ releaseTag: "v0.1.0", tagSigned: true })).toEqual(["ok:original"]);
    expect(ids({})).toEqual(["info:between"]);
    expect(ids({ builtFrom: "unknown", folder: null, origin: null, isCreators: null, localCommits: null })).toEqual(["info:unknown"]);
  });

  it("changes, forks and bad signatures come first, and no all-clear is said beside them", () => {
    expect(ids({ changedFiles: ["src/a.ts"], localCommits: 43 })).toEqual(["warn:changed"]);
    expect(findings({ ...base, changedFiles: ["src/a.ts"], localCommits: 43 })[0].detail).toMatch(/^1 file changed in its folder, and 43 commits made here that the creator's repository doesn't have\./);
    expect(ids({ isCreators: false, origin: "git@github.com:someone/TuxCopilot.git", localCommits: 2 })).toEqual(["warn:fork", "warn:changed"]);
    expect(findings({ ...base, isCreators: false, localCommits: 2 })[1].detail).toContain("that the fork doesn't have");
    expect(ids({ releaseTag: "v0.1.0", tagSigned: false })).toEqual(["bad:tag"]);
    expect(ids({ origin: null, isCreators: null, localCommits: null })).toEqual(["warn:nowhere"]);
    expect(ids({ package: "tuxcopilot", altered: [{ path: "/usr/bin/tuxcopilot", why: "SHA256 checksum mismatch" }] })).toEqual(["bad:altered"]);
    expect(findings({ ...base, package: "tuxcopilot", altered: [{ path: "/usr/bin/tuxcopilot", why: "SHA256 checksum mismatch" }] })[0].detail).toContain("yay -Syu tuxcopilot");
    expect(ids({ commitSigned: false })).toEqual(["warn:unsigned"]);
    expect(ids({ commitSigned: true })).toEqual(["info:between", "ok:signed"]);
    expect(ids({ folderMoved: true })).toEqual(["info:between", "info:moved"]);
  });

  it("the source opens where this copy's code is", () => {
    expect(sourceUrl(base)).toBe(`https://github.com/ArchBlackKitten/TuxCopilot/tree/${COMMIT}`);
    expect(sourceUrl({ ...base, localCommits: 3 })).toBe("https://github.com/ArchBlackKitten/TuxCopilot");
    expect(sourceUrl({ ...base, changedFiles: ["x"] })).toBe("https://github.com/ArchBlackKitten/TuxCopilot");
    expect(sourceUrl({ ...base, isCreators: false, originWeb: "https://github.com/someone/TuxCopilot" })).toBe("https://github.com/someone/TuxCopilot");
  });

  it("the key reads as gpg prints it, and the outside checks name it", () => {
    expect(spacedKey(base.releaseKey)).toBe("1C30 D714 9E20 A472 4D92  A4E3 24D4 340F E9E2 BF54");
    const c = outsideChecks({ ...base, releaseTag: "v0.2.0", package: "tuxcopilot-git" }).map((x) => x.command);
    expect(c[0]).toContain(`gpg --fingerprint ${base.releaseKey}`);
    expect(c[1]).toBe("gpg --verify tuxcopilot-0.2.0.tar.gz.asc tuxcopilot-0.2.0.tar.gz");
    expect(c[2]).toBe("pacman -Qkk tuxcopilot-git");
    expect(outsideChecks(base)).toHaveLength(2);
  });
});
