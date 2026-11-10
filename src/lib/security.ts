// Fluff's security check (Apps, and a line on Home): the installed packages Arch's security
// tracker lists as vulnerable (security.rs), said in plain words and calmly — what kind of
// problem it is, whether an update already fixes it, and what a beginner can do about it.

import { inv } from "./host";

export interface SecurityFinding {
  package: string;
  installed: string;
  group: string; // AVG-1234
  severity: "Critical" | "High" | "Medium" | "Low" | "Unknown";
  kind: string;
  fixed: string | null;
  cves: string[];
  explicit: boolean;
}

let cache: { at: number; findings: SecurityFinding[] } | null = null;
const KEEP_MS = 6 * 60 * 60 * 1000;

/** The check (kept for six hours, so Home and Apps don't fetch the tracker each time). */
export async function securityCheck(again = false): Promise<SecurityFinding[]> {
  if (!again && cache && Date.now() - cache.at < KEEP_MS) return cache.findings;
  const findings = await inv<SecurityFinding[]>("security_check");
  cache = { at: Date.now(), findings };
  return findings;
}

/** What each kind of problem means, for someone new to it. */
export const KIND_WORDS: Record<string, string> = {
  "arbitrary code execution": "someone could make it run their own code",
  "arbitrary command execution": "someone could make it run commands",
  "privilege escalation": "a program could gain more rights than it should (even root)",
  "denial of service": "someone could make it crash or hang",
  "information disclosure": "it could show data it shouldn't",
  "arbitrary filesystem access": "it could read or change files it shouldn't",
  "directory traversal": "it could reach files outside the folder it should stay in",
  "signature forgery": "a fake signature could pass as real",
  "certificate verification bypass": "a fake certificate could pass as real",
  "access restriction bypass": "a lock it has could be gone around",
  "multiple issues": "several problems at once",
  unknown: "the tracker doesn't say what kind",
};
export const kindWords = (k: string) => KIND_WORDS[k] ?? k;

export const SEVERITY_WORDS: Record<SecurityFinding["severity"], string> = {
  Critical: "critical",
  High: "high",
  Medium: "medium",
  Low: "low",
  Unknown: "not rated",
};

export interface PackageSecurity {
  package: string;
  installed: string;
  explicit: boolean;
  worst: SecurityFinding["severity"];
  fixedIn: string | null; // the newest fix an update brings (null: none yet)
  findings: SecurityFinding[];
  advice: string;
}

const RANK = ["Critical", "High", "Medium", "Low", "Unknown"];

/** One line per package, worst first, with what Fluff recommends. */
export function byPackage(all: SecurityFinding[]): PackageSecurity[] {
  const m = new Map<string, SecurityFinding[]>();
  for (const f of all) m.set(f.package, [...(m.get(f.package) ?? []), f]);
  return [...m.entries()]
    .map(([pkg, fs]) => {
      const worst = fs.map((f) => f.severity).sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0];
      const fixes = fs.map((f) => f.fixed).filter((x): x is string => x !== null).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const fixedIn = fixes.length ? fixes[fixes.length - 1] : null;
      const open = fs.some((f) => f.fixed === null);
      const explicit = fs[0].explicit;
      const advice = fixedIn
        ? `Arch has a fix for ${open ? "part of " : ""}it (version ${fixedIn}): update in the Updates section.`
        : explicit
          ? "No fix yet: Arch's tracker lists it as open. Keep updating; if you don't use this app, removing it removes the risk."
          : "No fix yet: Arch's tracker lists it as open. It is a part other apps need, so keep updating — the fix comes with an update.";
      return { package: pkg, installed: fs[0].installed, explicit, worst, fixedIn, findings: fs, advice };
    })
    .sort((a, b) => RANK.indexOf(a.worst) - RANK.indexOf(b.worst) || Number(!a.fixedIn) - Number(!b.fixedIn) || a.package.localeCompare(b.package));
}

/** The one line Home shows. */
export function summary(pkgs: PackageSecurity[]): { level: "ok" | "info" | "warn" | "bad"; text: string } {
  if (!pkgs.length) return { level: "ok", text: "No installed package is on Arch's list of open security issues." };
  const fixable = pkgs.filter((p) => p.fixedIn).length;
  const serious = pkgs.filter((p) => p.worst === "Critical" || p.worst === "High").length;
  const parts = [
    fixable ? `${fixable} with a fix waiting in an update` : "",
    pkgs.length - fixable ? `${pkgs.length - fixable} with no fix yet` : "",
  ].filter(Boolean);
  return {
    level: fixable && serious ? "bad" : fixable ? "warn" : "info",
    text: `${pkgs.length} package${pkgs.length === 1 ? "" : "s"} on Arch's security list: ${parts.join(", ")}${serious ? ` (${serious} rated high or critical)` : ""}.`,
  };
}
