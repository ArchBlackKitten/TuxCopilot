// The Updates section — safe updates, the steps in order: the Arch news since your last
// update, a snapshot before it starts, fresh mirrors, a look at the AUR packages, then the
// update itself. Fluff checks each step and says what it found; nothing runs without
// "Are you sure?", and when the news asks for work by hand, the update waits until you say
// you read it.
import { useCallback, useEffect, useState } from "react";
import { FirmwarePanel } from "./firmware-panel";
import { BootPanel } from "./boot-panel";
import { ChevronDown, ChevronRight, CircleAlert, CircleCheck, CircleX, ExternalLink, Info, Newspaper, RefreshCw, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { errText, openExternal } from "@/lib/host";
import { archNews, aurSafety, logTime, newsSince, steps, updatesFacts, UPDATE_ALL, UPDATE_REPO, type AurLook, type News, type Step, type UpdatesFacts } from "@/lib/updates";
import { FluffSays } from "./fluff-says";
import { useArch } from "./store";
import { TuxTag } from "./tux-tag";
import { tuxPackage } from "@/lib/tux-own";

const ICON = { ok: CircleCheck, info: Info, warn: CircleAlert, bad: CircleX } as const;
const TONE = { ok: "text-ok", info: "text-info", warn: "text-warn", bad: "text-bad" } as const;
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export function UpdatesView() {
  const { runQuick, dryRun, machineVersion } = useArch();
  const { toast } = useToast();
  const [f, setF] = useState<UpdatesFacts | null>(null);
  const [news, setNews] = useState<News[] | null>(null);
  const [aur, setAur] = useState<AurLook[] | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [readIt, setReadIt] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const check = useCallback(async () => {
    setBusy(true);
    setFailed(null);
    try {
      const [facts, n] = await Promise.all([updatesFacts(), archNews()]);
      setF(facts);
      setNews(n);
      setAur(facts.aur?.length ? await aurSafety(facts.aur.map((u) => u.name)) : []);
    } catch (e) {
      setFailed(errText(e));
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => void check(), [check, machineVersion]);

  const run = async (label: string, command: string) => {
    const err = await runQuick(label, command, dryRun);
    if (err) toast({ title: `Fluff couldn't finish: ${label}`, description: err, variant: "destructive" });
  };

  const since = f && news ? newsSince(news, f.lastUpgrade) : [];
  const byHand = since.some((n) => n.byHand);
  const list = f ? steps(f, news, aur) : [];
  const last = f ? logTime(f.lastUpgrade) : null;
  const repo = f?.repo ?? [];
  const aurUpd = f?.aur ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <RefreshCw className="h-5 w-5 text-primary" />
        <h2 className="text-sm font-semibold">Updates</h2>
        <span className="text-[11px] text-muted-foreground">safe updates, step by step — Fluff checks each one first</span>
        <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1 px-2 text-[11px]" onClick={() => void check()} disabled={busy}>
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} /> Check again
        </Button>
      </div>

      {failed && <p className="rounded-md border border-bad/40 bg-bad/5 p-2 text-[11px]">Fluff couldn't check for updates: {failed}</p>}
      {busy && !f ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        f && (
          <>
            <FluffSays title="Fluff recommends">
              Update about once a week, all at once (<code>-Syu</code>) — never just one package with its lists refreshed, which can leave the system half
              updated. {last ? `Your last full update: ${day(last)}.` : "Fluff found no full update in pacman's log yet."}{" "}
              {f.repo === null
                ? `Fluff couldn't see what is waiting: ${f.repoError ?? "no answer"}.`
                : `${repo.length} update${repo.length === 1 ? "" : "s"} waiting from Arch${f.aur ? `, ${aurUpd.length} from the AUR` : ""}.`}
            </FluffSays>

            <section className="divide-y divide-border/60 overflow-hidden rounded-md border bg-card">
              {list.map((s) => (
                <StepRow key={s.id} s={s} onFix={(x) => void run(x.label, x.command)} />
              ))}
            </section>

            {since.length > 0 && (
              <section className="space-y-2">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold">
                  <Newspaper className="h-3.5 w-3.5" /> Arch news since your last update
                </h3>
                <div className="divide-y divide-border/60 overflow-hidden rounded-md border bg-card">
                  {since.map((n) => (
                    <div key={n.link} className="px-3 py-2">
                      <button className="flex w-full items-start gap-2 text-left" onClick={() => setOpen(open === n.link ? null : n.link)}>
                        {open === n.link ? <ChevronDown className="mt-0.5 h-3 w-3 shrink-0" /> : <ChevronRight className="mt-0.5 h-3 w-3 shrink-0" />}
                        <span className="min-w-0 flex-1 text-xs font-medium">{n.title}</span>
                        {n.byHand && (
                          <Badge variant="outline" className="shrink-0 border-bad/50 px-1 py-0 text-[9px] text-bad">
                            by hand
                          </Badge>
                        )}
                        <span className="shrink-0 text-[10px] text-muted-foreground">{day(n.date)}</span>
                      </button>
                      {open === n.link && (
                        <div className="mt-1.5 space-y-1.5 pl-5">
                          <p className="whitespace-pre-line text-[11px] leading-relaxed">{n.text}</p>
                          <button className="flex items-center gap-1 text-[10px] text-primary hover:underline" onClick={() => void openExternal(n.link)}>
                            <ExternalLink className="h-3 w-3" /> on archlinux.org
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {aur && aur.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold">AUR updates, looked at</h3>
                <div className="divide-y divide-border/60 overflow-hidden rounded-md border bg-card">
                  {aur.map((a) => {
                    const u = aurUpd.find((x) => x.name === a.name);
                    return (
                      <div key={a.name} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                        <Badge variant="outline" className={`px-1 py-0 text-[9px] ${a.level === "careful" ? "border-warn/50 text-warn" : a.level === "look" ? "text-info" : "text-ok"}`}>
                          {a.level === "careful" ? "look closely" : a.level === "look" ? "note" : "fine"}
                        </Badge>
                        <span className="font-mono text-xs">{a.name}</span>
                        {tuxPackage(a.name) && <TuxTag why={tuxPackage(a.name)!} />}
                        {u && (
                          <span className="text-[10px] text-muted-foreground">
                            {u.from} → {u.to}
                          </span>
                        )}
                        <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">{a.why.join("; ")}</span>
                        <button className="text-[10px] text-primary hover:underline" onClick={() => void openExternal(a.page)}>
                          its AUR page
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {(repo.length > 0 || aurUpd.length > 0) && (
              <section className="space-y-2 rounded-md border bg-card p-3">
                <h3 className="text-xs font-semibold">Update</h3>
                {byHand && (
                  <label className="flex items-start gap-2 text-[11px]">
                    <input type="checkbox" checked={readIt} onChange={(e) => setReadIt(e.target.checked)} className="mt-0.5 accent-primary" />
                    I read the news marked "by hand" and know what to do.
                  </label>
                )}
                <div className="flex flex-wrap gap-2">
                  {repo.length > 0 && (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={byHand && !readIt} title={UPDATE_REPO} onClick={() => void run("Update Arch's packages", UPDATE_REPO)}>
                      Update Arch's packages ({repo.length})
                    </Button>
                  )}
                  {f.aur !== null && (
                    <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={byHand && !readIt} title={UPDATE_ALL} onClick={() => void run("Update everything, AUR too", UPDATE_ALL)}>
                      Update everything, AUR too ({repo.length + aurUpd.length})
                    </Button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  <code>{UPDATE_REPO}</code> updates what comes from Arch; <code>{UPDATE_ALL}</code> does the same and then the AUR (yay asks for your
                  password itself — never put sudo before yay). After a kernel update, restart when you can.
                </p>
                <details>
                  <summary className="cursor-pointer text-[10px] text-muted-foreground">What would change ({repo.length + aurUpd.length})</summary>
                  <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-term p-2 text-[10px] text-term-foreground">
                    {[...repo.map((u) => `${u.name} ${u.from} → ${u.to}`), ...aurUpd.map((u) => `${u.name} ${u.from} → ${u.to}   (AUR)`)].join("\n")}
                  </pre>
                </details>
              </section>
            )}
          </>
        )
      )}
      <FirmwarePanel />
      <BootPanel />
    </div>
  );
}

function StepRow({ s, onFix }: { s: Step; onFix: (x: NonNullable<Step["fix"]>) => void }) {
  const Icon = ICON[s.level];
  return (
    <div className="flex items-start gap-2 px-3 py-2">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${TONE[s.level]}`} />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium">{s.title}</div>
        {s.detail && <p className="text-[11px] text-muted-foreground">{s.detail}</p>}
      </div>
      {s.link && (
        <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[10px]" onClick={() => void openExternal(s.link!.url)}>
          <ExternalLink className="h-3 w-3" /> {s.link.label}
        </Button>
      )}
      {s.fix && (
        <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[10px]" title={s.fix.command} onClick={() => onFix(s.fix!)}>
          <Wrench className="h-3 w-3" /> {s.fix.label}
        </Button>
      )}
    </div>
  );
}
