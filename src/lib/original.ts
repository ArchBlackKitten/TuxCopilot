// "Is this the real TuxCopilot?" (Settings): what this copy says about itself (original.rs),
// in plain words — a signed release, the creator's code between releases, changed on this
// computer, or a fork — and the checks that don't depend on trusting this copy: gpg on the
// release, pacman -Qkk on what pacman installed.

import { inv } from "./host";

export interface OriginalFacts {
  version: string;
  builtFrom: "release" | "git" | "unknown";
  commit: string;
  releaseKey: string;
  creatorRepo: string;
  releaseTag: string | null;
  tagSigned: boolean | null;
  folder: string | null;
  folderMoved: boolean;
  origin: string | null;
  originWeb: string | null;
  isCreators: boolean | null;
  changedFiles: string[];
  localCommits: number | null;
  commitSigned: boolean | null;
  package: string | null;
  packageFiles: number | null;
  altered: Array<{ path: string; why: string }>;
  unreadable: number;
  exe: string;
  exeSha256: string | null;
}

export const originalCheck = () => inv<OriginalFacts>("original_check");

export interface Finding {
  id: string;
  level: "ok" | "info" | "warn" | "bad";
  title: string;
  detail: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What Fluff can say about this copy, the most serious first. */
export function findings(f: OriginalFacts): Finding[] {
  const out: Finding[] = [];
  const release = f.releaseTag ?? `v${f.version}`;
  if (f.tagSigned === false)
    out.push({ id: "tag", level: "bad", title: `The ${release} tag isn't signed by the creator's release key`, detail: "Someone made a release tag with another key. Don't trust this copy: get TuxCopilot again from the AUR, which checks the signature for you." });
  if (f.altered.length)
    out.push({
      id: "altered",
      level: "bad",
      title: `${plural(f.altered.length, "file")} of TuxCopilot changed since pacman installed ${f.altered.length === 1 ? "it" : "them"}`,
      detail: `${f.altered.map((a) => `${a.path} (${a.why})`).join("; ")}. If you didn't change ${f.altered.length === 1 ? "it" : "them"}, reinstall TuxCopilot from the AUR: yay -Syu ${f.package ?? "tuxcopilot"}.`,
    });
  if (f.isCreators === false)
    out.push({ id: "fork", level: "warn", title: "This is a fork: someone else's version of TuxCopilot", detail: `It comes from ${f.origin}, not from ${f.creatorRepo}. Open source lets anyone make their own version (the AGPL even asks them to share it), but Fluff's creator doesn't check what changes there.` });
  if (f.builtFrom === "git" && f.folder && f.origin === null)
    out.push({ id: "nowhere", level: "warn", title: "A copy with no address", detail: "Its folder doesn't say where it was downloaded from, so Fluff can't tell whose it is." });
  const local = f.localCommits ?? 0;
  if (f.changedFiles.length || local)
    out.push({
      id: "changed",
      level: "warn",
      title: "Changed on this computer",
      detail: `${[f.changedFiles.length ? `${plural(f.changedFiles.length, "file")} changed in its folder` : "", local ? `${plural(local, "commit")} made here that ${f.isCreators === false ? "the fork" : "the creator's repository"} doesn't have` : ""].filter(Boolean).join(", and ")}. If you changed it, that's yours to do. If you didn't, someone else did: get TuxCopilot again.`,
    });
  if (f.commitSigned === false) out.push({ id: "unsigned", level: "warn", title: "Its last commit isn't signed by the creator", detail: "The creator signs every commit; this one has no signature the creator's key made." });
  if (f.folderMoved) out.push({ id: "moved", level: "info", title: "Its folder has moved on since it was built", detail: "What runs is the commit it was built from; build it again to run what the folder has now." });
  if (f.commitSigned === true) out.push({ id: "signed", level: "ok", title: "Its last commit is signed by the creator", detail: "Checked with the creator's SSH key (keys/allowed_signers)." });
  if (f.package && !f.altered.length)
    out.push({ id: "pacman", level: "ok", title: `pacman: none of its ${f.packageFiles ?? ""} files changed since it was installed`.replace("  ", " "), detail: `Installed as the package ${f.package}.${f.unreadable ? ` ${plural(f.unreadable, "file")} couldn't be read to check.` : ""}` });

  const serious = out.some((x) => x.level === "bad" || x.level === "warn");
  if (!serious) {
    if (f.builtFrom === "release" || f.tagSigned === true)
      out.unshift({ id: "original", level: "ok", title: `TuxCopilot ${release}, as its creator released it`, detail: f.tagSigned === true ? "The release tag is signed by the creator's release key, checked against that key alone." : "Built from the signed release (makepkg checked its signature against the creator's key before building)." });
    else if (f.builtFrom === "git" && f.isCreators)
      out.unshift({ id: "between", level: "info", title: "The creator's TuxCopilot, between releases", detail: "Built from the creator's repository, unchanged. It isn't a signed release, so nothing vouches for it beyond that repository; releases are signed." });
    else out.unshift({ id: "unknown", level: "info", title: "Fluff can't tell where this copy was built from", detail: "It wasn't built from a release or from a git folder that's still here. The checks below work from outside it." });
  }
  const rank = { bad: 0, warn: 1, info: 2, ok: 3 } as const;
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

/** The fingerprint as gpg prints it: 10 groups of 4, a double space in the middle. */
export const spacedKey = (k: string) => (k.match(/.{1,4}/g) ?? []).join(" ").replace(/^((?:\S{4} ){5})/, "$1 ").trim();

/** Where to read this copy's source: the commit on the creator's page, or the fork's page. */
export function sourceUrl(f: OriginalFacts): string {
  if (f.isCreators === false && f.originWeb) return f.originWeb;
  const repo = `https://${f.creatorRepo}`;
  // a commit made here isn't on the creator's page
  return /^[0-9a-f]{40}$/.test(f.commit) && (f.localCommits ?? 0) === 0 && !f.changedFiles.length ? `${repo}/tree/${f.commit}` : repo;
}

/** The checks from outside: they don't depend on trusting this copy. */
export function outsideChecks(f: OriginalFacts): Array<{ what: string; command: string }> {
  const v = (f.releaseTag ?? `v${f.version}`).replace(/^v/, "");
  return [
    { what: "Get the creator's key from their GitHub profile, and check its fingerprint matches the one above", command: `curl -s https://github.com/ArchBlackKitten.gpg | gpg --import && gpg --fingerprint ${f.releaseKey}` },
    { what: "Check a downloaded release (it must say Good signature)", command: `gpg --verify tuxcopilot-${v}.tar.gz.asc tuxcopilot-${v}.tar.gz` },
    ...(f.package ? [{ what: "Check what pacman installed is unchanged", command: `pacman -Qkk ${f.package}` }] : []),
  ];
}
