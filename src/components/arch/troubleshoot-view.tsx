// The Troubleshoot section: Fluff's checkup of the whole system (only reads), each finding in
// plain words with its fix; the errors since this boot by program; and the settings files an
// update left waiting, each with what it is, what changed, and Keep mine / Use the new one.
import { useCallback, useEffect, useState } from "react";
import { CalendarClock, ChevronDown, ChevronRight, CircleAlert, CircleCheck, CircleX, FileDiff, GitMerge, Info, RefreshCw, Stethoscope, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { errText } from "@/lib/host";
import { errorGroups, findings, keepMineCommand, mergeCommand, mergeSaid, runCheckup, useNewCommand, waitingAdvice, waitingDiff, waitingMerge, waitingPick, type Checkup, type Finding, type Merge, type Waiting } from "@/lib/checkup";
import { servicesList, type Service } from "@/lib/services";
import { FluffSays } from "./fluff-says";
import { useArch } from "./store";
import { TuxTag } from "./tux-tag";
import { ReportPanel } from "./report-panel";
import { tuxPackage, tuxPath, tuxUnit } from "@/lib/tux-own";
import { WEEKLY_WORDS, weeklyOffCommand, weeklyOnCommand, weeklyState, type WeeklyState } from "@/lib/weekly";

const ICON = { ok: CircleCheck, info: Info, warn: CircleAlert, bad: CircleX } as const;
const TONE = { ok: "text-ok", info: "text-info", warn: "text-warn", bad: "text-bad" } as const;

export function TroubleshootView() {
  const { runQuick, dryRun, machineVersion, setView } = useArch();
  const { toast } = useToast();
  const [c, setC] = useState<Checkup | null>(null);
  const [services, setServices] = useState<Service[] | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [openErrors, setOpenErrors] = useState<string | null>(null);

  const check = useCallback(async () => {
    setBusy(true);
    setFailed(null);
    try {
      const [r, s] = await Promise.all([runCheckup(), servicesList().catch(() => null)]);
      setC(r);
      setServices(s);
    } catch (e) {
      setFailed(errText(e));
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => void check(), [check, machineVersion]);

  const run = async (label: string, build: () => string) => {
    let command: string;
    try {
      command = build();
    } catch (e) {
      return toast({ title: "Fluff didn't run it", description: errText(e), variant: "destructive" });
    }
    const err = await runQuick(label, command, dryRun);
    if (err) toast({ title: `Fluff couldn't finish: ${label}`, description: err, variant: "destructive" });
  };

  const list = c ? findings(c, services) : [];
  const groups = c ? errorGroups(c.errors) : [];
  const problems = list.filter((f) => f.level === "bad" || f.level === "warn").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Stethoscope className="h-5 w-5 text-primary" />
        <h2 className="text-sm font-semibold">Troubleshoot</h2>
        <span className="text-[11px] text-muted-foreground">Fluff's checkup of the whole system — it only reads; every fix asks first</span>
        <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1 px-2 text-[11px]" onClick={() => void check()} disabled={busy}>
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} /> Check again
        </Button>
      </div>

      {failed && <p className="rounded-md border border-bad/40 bg-bad/5 p-2 text-[11px]">Fluff's checkup could not run: {failed}</p>}
      {busy && !c ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        c && (
          <>
            <FluffSays title="Fluff's checkup">
              {problems === 0
                ? "All is calm. Nothing here needs you right now."
                : `${problems} thing${problems === 1 ? "" : "s"} to look at, worst first. Each says what it means; a button runs the fix, after "Are you sure?".`}
            </FluffSays>

            <WeeklyRow run={run} />

            <section className="divide-y divide-border/60 overflow-hidden rounded-md border bg-card">
              {list.map((f) => (
                <FindingRow key={f.id} f={f} onFix={(x) => void run(x.label, () => x.command)} onGoto={() => setView("services")} />
              ))}
            </section>

            {c.waiting.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold">Settings files waiting after updates</h3>
                <p className="text-[11px] text-muted-foreground">
                  When an update brings a new version of a settings file you (or a tool) changed, pacman keeps yours in use and puts the new one beside
                  it as <code>.pacnew</code>. A <code>.pacsave</code> is your old copy, kept when a package was removed or replaced. Arch leaves the
                  choice to you; Fluff says what each one is.
                </p>
                <div className="divide-y divide-border/60 overflow-hidden rounded-md border bg-card">
                  {c.waiting.map((w) => (
                    <WaitingRow key={w.path} w={w} run={run} />
                  ))}
                </div>
              </section>
            )}

            {groups.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold">Errors since this boot, by program</h3>
                <div className="divide-y divide-border/60 overflow-hidden rounded-md border bg-card">
                  {groups.map((g) => (
                    <div key={g.program} className="px-3 py-1.5">
                      <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpenErrors(openErrors === g.program ? null : g.program)}>
                        {openErrors === g.program ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        <span className="font-mono text-xs">{g.program}</span>
                        {(tuxPackage(g.program) ?? tuxUnit(g.program)) && <TuxTag why={(tuxPackage(g.program) ?? tuxUnit(g.program))!} />}
                        <Badge variant="outline" className="px-1 py-0 text-[9px]">
                          {g.count}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{g.last}</span>
                      </button>
                      {openErrors === g.program && (
                        <pre className="mt-1 max-h-56 overflow-auto rounded-md bg-term p-2 text-[10px] text-term-foreground">
                          {c.errors.filter((l) => new RegExp(`^\\S+ \\S+ ${g.program.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\[\\d+\\])?:`).test(l)).join("\n")}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  The full log: <code>journalctl -b -p err</code> in a terminal (Commands explains it).
                </p>
              </section>
            )}
          </>
        )
      )}
      <ReportPanel />
    </div>
  );
}

// Fluff's weekly checkup: off until you say yes — the command is shown first (it is the permission)
function WeeklyRow({ run }: { run: (label: string, build: () => string) => Promise<unknown> }) {
  const { machineVersion } = useArch();
  const [w, setW] = useState<WeeklyState | null>(null);
  useEffect(() => void weeklyState().then(setW, () => setW(null)), [machineVersion]);
  if (!w) return null;
  return (
    <div className="flex flex-wrap items-start gap-2 rounded-md border px-3 py-2 text-[11px]">
      <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
          Fluff's weekly checkup
          <Badge variant="outline" className={`px-1 py-0 text-[9px] ${w.on ? "text-ok" : ""}`}>
            {w.on ? "on" : "off"}
          </Badge>
          {w.on && w.last && <span className="text-[10px] font-normal text-muted-foreground">last looked {w.last}</span>}
        </div>
        <p className="text-muted-foreground">{WEEKLY_WORDS}</p>
        {!w.on && w.files && <p className="text-warn">Its files are there but the timer is off: switching it on puts them right.</p>}
      </div>
      {w.on || w.files ? (
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => void run("Fluff's weekly checkup: off", weeklyOffCommand)}>
          Switch it off
        </Button>
      ) : null}
      {!w.on && w.exe && (
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => void run("Fluff's weekly checkup: on", () => weeklyOnCommand(w.exe!))}>
          Yes, look weekly
        </Button>
      )}
    </div>
  );
}

function FindingRow({ f, onFix, onGoto }: { f: Finding; onFix: (x: NonNullable<Finding["fix"]>) => void; onGoto: () => void }) {
  const Icon = ICON[f.level];
  return (
    <div className="flex items-start gap-2 px-3 py-2">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${TONE[f.level]}`} />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium">{f.title}</div>
        {f.detail && <p className="text-[11px] text-muted-foreground">{f.detail}</p>}
      </div>
      {f.goto && (
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={onGoto}>
          Open Services
        </Button>
      )}
      {f.look && (
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" title={`${f.look.command} — it only reads`} onClick={() => onFix(f.look!)}>
          {f.look.label}
        </Button>
      )}
      {f.fix && (
        <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[10px]" title={f.fix.command} onClick={() => onFix(f.fix!)}>
          <Wrench className="h-3 w-3" /> {f.fix.label}
        </Button>
      )}
    </div>
  );
}

function WaitingRow({ w, run }: { w: Waiting; run: (label: string, build: () => string) => Promise<unknown> }) {
  const [diff, setDiff] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [merge, setMerge] = useState<Merge | string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const pick = waitingPick(w);
  const rec = (p: string) => (pick === p ? <Badge variant="outline" className="ml-1 px-1 py-0 text-[8px] text-primary">Fluff recommends</Badge> : null);
  const tryMerge = async () => {
    setMergeOpen(!mergeOpen);
    if (merge !== null) return;
    try {
      setMerge(await waitingMerge(w.path));
    } catch (e) {
      setMerge(errText(e));
    }
  };
  const show = async () => {
    setOpen(!open);
    if (diff !== null) return;
    try {
      setDiff(await waitingDiff(w.path));
    } catch (e) {
      setDiff(errText(e));
    }
  };
  return (
    <div className="space-y-1 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={`px-1.5 py-0 text-[9px] ${w.kind === "pacnew" ? "text-info" : "text-muted-foreground"}`}>
          {w.kind === "pacnew" ? "new version" : "old copy"}
        </Badge>
        <span className="font-mono text-xs">{w.file}</span>
        {tuxPath(w.path) && <TuxTag why={tuxPath(w.path)!} />}
        {w.owner && <span className="text-[10px] text-muted-foreground">from {w.owner}</span>}
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[10px]" onClick={() => void show()}>
            <FileDiff className="h-3 w-3" /> {open ? "Hide" : "What changed"}
          </Button>
          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" title={`sudo rm ${w.path}`} onClick={() => void run(`Keep mine: ${w.file}`, () => keepMineCommand(w))}>
            {w.kind === "pacnew" ? "Keep mine" : "Remove the old copy"}
            {rec("keep")}
          </Button>
          {w.kind === "pacnew" && (
            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" title="yours is kept beside it first" onClick={() => void run(`Use the new one: ${w.file}`, () => useNewCommand(w))}>
              Use the new one
              {rec("new")}
            </Button>
          )}
          {w.kind === "pacnew" && (
            <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[10px]" title="your changes and the new version together, previewed first" onClick={() => void tryMerge()}>
              <GitMerge className="h-3 w-3" /> {mergeOpen ? "Hide the merge" : "Merge"}
              {rec("merge")}
            </Button>
          )}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">{waitingAdvice(w)}</p>
      {open && (
        <pre className="max-h-72 overflow-auto rounded-md bg-term p-2 text-[10px] text-term-foreground">
          {diff ?? "Fluff is comparing them…"}
          {diff !== null && /^---/.test(diff) && "\n\n(lines with - are in yours, lines with + are in the waiting one)"}
        </pre>
      )}
      {mergeOpen && (
        <div className="space-y-1 rounded-md border p-2 text-[11px]">
          {merge === null ? (
            <p className="text-muted-foreground">Fluff is merging them (a preview: nothing is written)…</p>
          ) : typeof merge === "string" ? (
            <p className="text-bad">{merge}</p>
          ) : (
            <>
              <p className={merge.basePackage && !merge.conflicts ? "" : "text-warn"}>{mergeSaid(merge)}</p>
              {merge.basePackage && !merge.conflicts && (
                <>
                  <pre className="max-h-72 overflow-auto rounded-md bg-term p-2 text-[10px] text-term-foreground">
                    {merge.preview || "(the merge is the same as yours: only the waiting one goes)"}
                    {merge.preview && "\n\n(lines with - leave yours, lines with + come from the new version)"}
                  </pre>
                  <Button size="sm" className="h-6 px-2 text-[10px]" onClick={() => void run(`Merge: ${w.file}`, () => mergeCommand(w, merge))}>
                    Use the merge
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
