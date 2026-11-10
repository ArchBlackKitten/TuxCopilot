// Fluff's security check: one line per package, worst first, said calmly and exactly.
import { describe, expect, it } from "vitest";
import { byPackage, kindWords, summary, type SecurityFinding } from "@/lib/security";

const f = (o: Partial<SecurityFinding>): SecurityFinding => ({ package: "x", installed: "1.0-1", group: "AVG-1", severity: "Medium", kind: "denial of service", fixed: null, cves: ["CVE-1"], explicit: false, ...o });

describe("Fluff's security check", () => {
  it("one line per package, worst first; a fix before no fix", () => {
    const p = byPackage([
      f({ package: "perl", group: "AVG-2", severity: "Low" }),
      f({ package: "perl", group: "AVG-3", severity: "Medium", kind: "signature forgery" }),
      f({ package: "openssl", severity: "Medium", fixed: "3.6.6-1" }),
      f({ package: "pam", severity: "High", explicit: false }),
      f({ package: "wget", severity: "Medium", explicit: true }),
    ]);
    expect(p.map((x) => [x.package, x.worst])).toEqual([["pam", "High"], ["openssl", "Medium"], ["perl", "Medium"], ["wget", "Medium"]]);
    expect(p.find((x) => x.package === "perl")!.findings).toHaveLength(2);
    expect(p.find((x) => x.package === "openssl")!.advice).toMatch(/^Arch has a fix for it \(version 3\.6\.6-1\): update in the Updates section\./);
    expect(p.find((x) => x.package === "wget")!.advice).toMatch(/if you don't use this app, removing it removes the risk/);
    expect(p.find((x) => x.package === "pam")!.advice).toMatch(/a part other apps need, so keep updating/);
  });

  it("at the same severity, the one an update fixes comes first (whatever its name)", () => {
    expect(byPackage([f({ package: "apr" }), f({ package: "zlib", fixed: "2-1" })]).map((x) => x.package)).toEqual(["zlib", "apr"]);
  });

  it("Home's line: calm when there is nothing, exact when there is", () => {
    expect(summary([])).toEqual({ level: "ok", text: "No installed package is on Arch's list of open security issues." });
    const s = summary(byPackage([f({ package: "a", severity: "High", fixed: "2-1" }), f({ package: "b" })]));
    expect(s).toEqual({ level: "bad", text: "2 packages on Arch's security list: 1 with a fix waiting in an update, 1 with no fix yet (1 rated high or critical)." });
    expect(summary(byPackage([f({ package: "b" })])).level).toBe("info");
  });

  it("each kind of problem in plain words", () => {
    expect(kindWords("arbitrary code execution")).toBe("someone could make it run their own code");
    expect(kindWords("something new")).toBe("something new");
  });
});
