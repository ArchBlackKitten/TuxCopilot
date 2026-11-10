// Fluff's security check — in Security → System (every package on Arch's security list, worst first, each
// with what kind of problem it is and what to do), and as one line on Home.
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw, ShieldCheck, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { errText, openExternal } from "@/lib/host";
import { byPackage, kindWords, securityCheck, SEVERITY_WORDS, summary, type PackageSecurity } from "@/lib/security";
import { FluffSays } from "./fluff-says";
import { useArch } from "./store";

const TONE = { Critical: "border-bad/60 text-bad", High: "border-bad/40 text-bad", Medium: "border-warn/50 text-warn", Low: "text-info", Unknown: "text-muted-foreground" } as const;

function useSecurity() {
  const { machineVersion } = useArch();
  const [pkgs, setPkgs] = useState<PackageSecurity[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (again = false) => {
    setBusy(true);
    setFailed(null);
    try {
      setPkgs(byPackage(await securityCheck(again)));
    } catch (e) {
      setFailed(errText(e));
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => void load(), [load, machineVersion]);
  return { pkgs, failed, busy, load };
}

export function SecurityCheck() {
  const { pkgs, failed, busy, load } = useSecurity();
  const { setView } = useArch();
  const [open, setOpen] = useState<string | null>(null);
  const s = pkgs ? summary(pkgs) : null;
  return (
    <section className="space-y-2 rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        {s?.level === "ok" ? <ShieldCheck className="h-4 w-4 text-ok" /> : <ShieldAlert className="h-4 w-4 text-warn" />}
        <span className="text-sm font-semibold">Fluff's security check</span>
        <span className="text-[11px] text-muted-foreground">your packages against Arch's security tracker</span>
        <Button size="sm" variant="ghost" className="ml-auto h-6 gap-1 px-2 text-[10px]" disabled={busy} onClick={() => void load(true)}>
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} /> Check again
        </Button>
      </div>
      {failed && <p className="text-[11px] text-muted-foreground">Fluff couldn't check: {failed}</p>}
      {!pkgs && !failed && <p className="text-[11px] text-muted-foreground">Fluff is reading Arch's security list…</p>}
      {pkgs && s && (
        <>
          <FluffSays>
            {s.text}{" "}
            {pkgs.length
              ? "Most open issues are known, tracked, and waiting for a fix from the people who make the program — keep updating once a week and they arrive. Nothing here means someone is in your computer."
              : "Keep updating once a week and it stays that way."}
          </FluffSays>
          {pkgs.length > 0 && (
            <div className="divide-y divide-border/60 overflow-hidden rounded-md border">
              {pkgs.map((p) => (
                <div key={p.package} className="px-3 py-1.5">
                  <button className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setOpen(open === p.package ? null : p.package)}>
                    {open === p.package ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    <Badge variant="outline" className={`px-1 py-0 text-[9px] ${TONE[p.worst]}`}>
                      {SEVERITY_WORDS[p.worst]}
                    </Badge>
                    <span className="font-mono text-xs">{p.package}</span>
                    <span className="text-[10px] text-muted-foreground">{p.explicit ? "an app you installed" : "a part other apps need"}</span>
                    {p.fixedIn && (
                      <Badge variant="outline" className="border-ok/40 px-1 py-0 text-[9px] text-ok">
                        fix in an update
                      </Badge>
                    )}
                    <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{kindWords(p.findings[0].kind)}</span>
                  </button>
                  {open === p.package && (
                    <div className="mt-1 space-y-1 pl-5 text-[11px]">
                      <p>{p.advice}</p>
                      {p.findings.map((f) => (
                        <div key={f.group} className="flex flex-wrap items-baseline gap-2 text-[10px] text-muted-foreground">
                          <button className="font-mono text-primary hover:underline" onClick={() => void openExternal(`https://security.archlinux.org/${f.group}`)}>
                            {f.group}
                          </button>
                          <span>{SEVERITY_WORDS[f.severity]}: {kindWords(f.kind)}</span>
                          <span>{f.cves.length} CVE{f.cves.length === 1 ? "" : "s"}</span>
                          <span>installed {f.installed}{f.fixed ? ` · fixed in ${f.fixed}` : " · no fix yet"}</span>
                        </div>
                      ))}
                      {p.fixedIn && (
                        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => setView("updates")}>
                          Open Updates
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Home: the check's one line; a click opens Security → System. */
export function SecurityWidget() {
  const { pkgs } = useSecurity();
  const { openSecurity } = useArch();
  if (!pkgs) return null;
  const s = summary(pkgs);
  return (
    <button onClick={() => openSecurity("system", "sec-packages")} className="flex w-full items-center gap-2 rounded-md border bg-card px-3 py-2 text-left hover:bg-accent/30" title="Open Security → System: Fluff's security check">
      {s.level === "ok" ? <ShieldCheck className="h-4 w-4 shrink-0 text-ok" /> : <ShieldAlert className={`h-4 w-4 shrink-0 ${s.level === "bad" ? "text-bad" : s.level === "warn" ? "text-warn" : "text-info"}`} />}
      <span className="text-[11px]">{s.text}</span>
    </button>
  );
}
