import { trackerControl, usageAction, usageSnapshot } from "@/lib/api";
import { exportSigner, saveFile, savedNote } from "@/lib/integrity";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity,
  ActivitySquare,
  CircleDot,
  Download,
  FlaskConical,
  PackageOpen,
  Pause,
  Pin,
  Unlink,
  Play,
  Sparkles,
  Timer,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EliminateDialog, type EliminateTarget } from "@/components/arch/eliminate-dialog";
import { TrackingPanel } from "@/components/arch/tracking-panel";
import { Children, OrphansPanel } from "@/components/arch/orphans-panel";
import { removalChildren } from "@/lib/api";
import { useArch } from "@/components/arch/store";
import { isTracked } from "@/lib/tracking";
import type { AppUsageRow, UsageSnapshot } from "@/lib/types";
import { TuxTag } from "./tux-tag";
import { tuxPackage } from "@/lib/tux-own";

// ── formatting helpers ───────────────────────────────────────────────────

function fmtDuration(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h} h ${String(rm).padStart(2, "0")} m` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} d ${h % 24} h`;
}

function fmtMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-GB", { month: "long", year: "numeric" });
}

function fmtDay(day: string | null): string {
  if (!day) return "never";
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleString("en-GB", { day: "numeric", month: "short" });
}

const SOURCE_STYLE: Record<string, string> = {
  pacman: "text-sky-400 border-sky-400/30",
  aur: "text-amber-400 border-amber-400/30",
  flatpak: "text-violet-400 border-violet-400/30",
  snap: "text-orange-400 border-orange-400/30",
  appimage: "text-emerald-400 border-emerald-400/30",
  git: "text-cyan-400 border-cyan-400/30",
  other: "text-zinc-400 border-zinc-400/30",
  simulated: "text-amber-300 border-amber-300/40 bg-amber-300/10",
  sample: "text-zinc-400 border-zinc-400/30",
};

function SourceBadge({ source }: { source: string }) {
  return (
    <Badge variant="outline" className={`gap-1 px-1.5 py-0 text-[10px] capitalize ${SOURCE_STYLE[source] ?? SOURCE_STYLE.other}`}>
      {source === "simulated" && <FlaskConical className="h-2.5 w-2.5" />}
      {source}
    </Badge>
  );
}

// ── the view ─────────────────────────────────────────────────────────────

/** "System": part of the machine's core, so never removable from App Manager. */
function SystemFlag({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return (
    <Badge
      variant="outline"
      className="shrink-0 border-sky-500/50 px-1 py-0 text-[9px] text-sky-300"
      title={`Part of your system: ${reason}. Listed so you can see it; never removed from here.`}
    >
      System
    </Badge>
  );
}

export function AppManagerView() {
  const [snap, setSnap] = useState<UsageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState<string>("");
  const [sortBy, setSortBy] = useState<"time" | "sessions">("time");
  const [target, setTarget] = useState<EliminateTarget | null>(null);
  const { tracking, machineVersion, openAppPage } = useArch();
  // what would leave with each listed app (pacman's -Rs rule), loaded once per snapshot
  const [kids, setKids] = useState<Map<string, string[]>>(new Map());
  const [orphanCount, setOrphanCount] = useState<number | null>(null);
  useEffect(() => {
    if (!snap) return;
    const apps = [...new Set([...snap.ranking, ...snap.unused].map((r) => r.app))];
    removalChildren(apps)
      .then((fams) => setKids(new Map(fams.map((f) => [f.package, f.children]))))
      .catch(() => setKids(new Map()));
  }, [snap]);
  const [busy, setBusy] = useState<string | null>(null);
  const monthRef = useRef("");
  const { toast } = useToast();

  const load = useCallback(async (m?: string, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data: UsageSnapshot = await usageSnapshot(m ?? "");
      monthRef.current = data.month;
      setMonth(data.month);
      setSnap(data);
    } catch {
      if (!silent) toast({ title: "Fluff couldn't load the usage data", variant: "destructive" });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // something was installed or removed (or Refresh was pressed): read the machine again
  const firstVersion = useRef(machineVersion);
  useEffect(() => {
    if (machineVersion !== firstVersion.current && monthRef.current) void load(monthRef.current, true);
  }, [machineVersion, load]);

  // gentle background refresh so "seen right now" stays honest
  useEffect(() => {
    const t = setInterval(() => {
      if (monthRef.current) void load(monthRef.current, true);
    }, 45000);
    return () => clearInterval(t);
  }, [load]);

  const trackerAction = useCallback(
    async (action: "start" | "stop", intervalSec?: number) => {
      setBusy(action);
      try {
        await (intervalSec ? trackerControl("interval", intervalSec) : trackerControl(action));
        toast({
          title: action === "start" ? "Logger started" : "Logger stopped",
          description:
            action === "start"
              ? "usage is being logged in the background again"
              : "the monthly log will not grow until you start it again",
        });
        await load(monthRef.current, true);
      } catch {
        toast({ title: "Fluff couldn't change the tracker", variant: "destructive" });
      } finally {
        setBusy(null);
      }
    },
    [load, toast]
  );

  const changeInterval = useCallback(
    async (sec: string) => {
      setBusy("interval");
      try {
        await trackerControl("interval", parseInt(sec, 10));
        await load(monthRef.current, true);
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  const simulatedAction = useCallback(
    async (action: "seed" | "clear") => {
      setBusy(action);
      try {
        const data = await usageAction(action, monthRef.current);
        toast({
          title: action === "seed" ? "Simulated month loaded" : "Simulated data cleared",
          description:
            action === "seed"
              ? `${"inserted" in data ? data.inserted : 0} rows added, clearly badged as simulated`
              : `${"deleted" in data ? data.deleted : 0} simulated rows removed`,
        });
        await load(monthRef.current, true);
      } catch {
        toast({ title: "Fluff couldn't do that", variant: "destructive" });
      } finally {
        setBusy(null);
      }
    },
    [load, toast]
  );

  const downloadCsv = useCallback(async () => {
    if (!snap) return;
    const rows = [
      ["app", "source", "seconds", "hours", "launches", "active_days", "last_day"],
      ...snap.ranking.map((r) => [
        r.app, r.source, String(r.seconds), (r.seconds / 3600).toFixed(2),
        String(r.sessions), String(r.days), r.lastDay ?? "",
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    // a webview has no download manager: ask where to save, then write it from Rust
    try {
      const saved = await saveFile(`app-usage-${snap.month}.csv`, csv);
      if (saved) toast({ title: "Fluff saved the CSV", description: savedNote(saved, exportSigner()) });
    } catch {
      toast({ title: "Fluff couldn't save the CSV", variant: "destructive" });
    }
  }, [snap, toast]);

  // ── derived ────────────────────────────────────────────────────────────
  const ranking: AppUsageRow[] = snap
    ? [...snap.ranking].sort((a, b) =>
        sortBy === "time" ? b.seconds - a.seconds : b.sessions - a.sessions
      )
    : [];
  // tracked apps are kept, so they are never listed as unused
  const unused = snap ? snap.unused.filter((r) => !isTracked(tracking, r.app)) : [];
  const trackedHidden = snap ? snap.unused.length - unused.length : 0;
  const removable = unused.filter((r) => !r.system).length;
  const systemUnused = unused.length - removable;
  const sources = new Map<string, string>();
  for (const r of [...(snap?.ranking ?? []), ...(snap?.unused ?? [])]) sources.set(r.app, r.source);
  const sourceOf = (app: string) => sources.get(app) ?? "pacman";
  const knownApps = [...new Set([...sources.keys(), ...tracking.tracked])].sort();

  const maxSeconds = ranking.length ? Math.max(...ranking.map((r) => r.seconds), 1) : 1;
  const maxSessions = ranking.length ? Math.max(...ranking.map((r) => r.sessions), 1) : 1;

  return (
    <div className="space-y-4" data-testid="app-manager">
      {/* ── logger status + controls ─────────────────────────────────── */}
      <div className="rounded-lg border bg-card p-4">
        {loading || !snap ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-4 w-96" />
          </div>
        ) : (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  {snap.tracker.running ? (
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    </span>
                  ) : (
                    <span className="h-2.5 w-2.5 rounded-full bg-zinc-500" />
                  )}
                  Usage logger {snap.tracker.running ? "running" : "stopped"}
                </span>
                <span className="text-xs text-muted-foreground">
                  sampling every {snap.tracker.intervalSec}s in the background
                  {snap.tracker.lastSampleAt
                    ? ` · last sample ${new Date(snap.tracker.lastSampleAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                    : ""}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {snap.tracker.nowRunning.length > 0 ? (
                  <>
                    seen right now:{" "}
                    {snap.tracker.nowRunning.map((a) => (
                      <code key={a} className="mr-1 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-primary">
                        {a}
                      </code>
                    ))}
                  </>
                ) : (
                  "no tracked apps are running right now"
                )}
              </p>
              {snap.tracker.lastError && (
                <p className="text-[11px] text-destructive">last error: {snap.tracker.lastError}</p>
              )}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  disabled={busy !== null}
                  onClick={() => trackerAction(snap.tracker.running ? "stop" : "start")}
                >
                  {busy === "start" || busy === "stop" ? (
                    <Activity className="h-3.5 w-3.5 animate-pulse" />
                  ) : snap.tracker.running ? (
                    <Pause className="h-3.5 w-3.5" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  {snap.tracker.running ? "Stop logger" : "Start logger"}
                </Button>
                <Select value={String(snap.tracker.intervalSec)} onValueChange={changeInterval}>
                  <SelectTrigger className="h-7 w-[150px] text-xs" aria-label="Sampling interval">
                    <Timer className="mr-1 h-3 w-3 text-muted-foreground" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">every 15 seconds</SelectItem>
                    <SelectItem value="30">every 30 seconds</SelectItem>
                    <SelectItem value="60">every minute</SelectItem>
                    <SelectItem value="120">every 2 minutes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex shrink-0 flex-col items-start gap-2 lg:items-end">
              <Select value={month} onValueChange={(m) => { monthRef.current = m; void load(m); }}>
                <SelectTrigger className="h-8 w-[190px] text-xs" aria-label="Month">
                  <SelectValue placeholder="month" />
                </SelectTrigger>
                <SelectContent>
                  {snap.months.map((m) => (
                    <SelectItem key={m} value={m}>
                      {fmtMonth(m)}
                      {m === snap.month ? " — logging now" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                <span className="rounded border px-1.5 py-0.5">
                  <ActivitySquare className="mr-1 inline h-3 w-3" />
                  {fmtDuration(snap.totals.seconds)} total
                </span>
                <span className="rounded border px-1.5 py-0.5">{snap.totals.sessions} launches</span>
                <span className="rounded border px-1.5 py-0.5">{snap.totals.apps} apps used</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── honest-data callouts ──────────────────────────────────────── */}
      {snap && snap.detected.mode === "sample" && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-xs leading-relaxed text-amber-300">
          <span className="font-medium">Sample catalogue.</span> {snap.detected.note}
        </div>
      )}
      {snap && snap.simulatedRows && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-300/30 bg-amber-300/5 p-3 text-xs text-amber-300 sm:flex-row sm:items-center">
          <p className="leading-relaxed">
            <FlaskConical className="mr-1 inline h-3.5 w-3.5" />
            This month contains <span className="font-medium">simulated demo data</span> (amber badges) so the
            ranking and removal plans are visible without waiting a month.
          </p>
          <div className="flex gap-1.5 sm:ml-auto sm:shrink-0">
            <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" disabled={busy !== null} onClick={() => simulatedAction("seed")}>
              <Sparkles className="h-3 w-3" /> Reload
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" disabled={busy !== null} onClick={() => simulatedAction("clear")}>
              Clear simulated
            </Button>
          </div>
        </div>
      )}
      {snap && snap.detected.mode === "detected" && !snap.simulatedRows && snap.ranking.length === 0 && (
        <div className="flex flex-col gap-2 rounded-lg border p-3 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <p className="leading-relaxed">
            Nothing logged for {fmtMonth(snap.month)} yet — the logger is building the record. You can also load a
            clearly-marked simulated month to preview the layout.
          </p>
          <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px] sm:ml-auto sm:shrink-0" disabled={busy !== null} onClick={() => simulatedAction("seed")}>
            <Sparkles className="h-3 w-3" /> Load simulated month
          </Button>
        </div>
      )}

      {snap && snap.removed.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          No longer on this machine, so not listed: {snap.removed.join(", ")}.
        </p>
      )}

      {/* ── tabs ─────────────────────────────────────────────────────── */}
      <Tabs defaultValue="used">
        <TabsList className="h-8">
          <TabsTrigger value="used" className="h-6 gap-1.5 text-xs">
            <Activity className="h-3.5 w-3.5" /> Most used
          </TabsTrigger>
          <TabsTrigger value="unused" className="h-6 gap-1.5 text-xs">
            <PackageOpen className="h-3.5 w-3.5" />
            Fully unused
            {removable > 0 && (
              <Badge variant="outline" className="ml-1 px-1 py-0 text-[9px] text-muted-foreground">
                {removable}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="orphans" className="h-6 gap-1.5 text-xs">
            <Unlink className="h-3.5 w-3.5" /> Orphans
            {orphanCount !== null && orphanCount > 0 && (
              <Badge variant="outline" className="ml-1 px-1 py-0 text-[9px] text-muted-foreground">
                {orphanCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="tracking" className="h-6 gap-1.5 text-xs">
            <Pin className="h-3.5 w-3.5" /> Tracked &amp; links
          </TabsTrigger>
        </TabsList>

        {/* most used */}
        <TabsContent value="used" className="space-y-2">
          {loading || !snap ? (
            <div className="space-y-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : ranking.length === 0 ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Nothing to rank yet for {fmtMonth(snap.month)}.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="flex gap-1">
                  {(["time", "sessions"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setSortBy(s)}
                      className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                        sortBy === s ? "border-primary/50 bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      rank by {s === "time" ? "time used" : "launches"}
                    </button>
                  ))}
                </div>
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={downloadCsv}>
                  <Download className="h-3 w-3" /> Monthly log (CSV)
                </Button>
              </div>
              <div className="overflow-hidden rounded-lg border">
                {ranking.map((r, i) => (
                  <button
                    key={r.app}
                    onClick={() => openAppPage(r.app, r.source)}
                    className="flex w-full items-center gap-2 border-b px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-accent/40 sm:gap-3"
                    title={`Open ${r.app}: how it works, what it needs, what you can change`}
                  >
                    <span className="w-5 shrink-0 text-right font-mono text-xs text-muted-foreground">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{r.app}</span>
                        {tuxPackage(r.app) && <TuxTag why={tuxPackage(r.app)!} />}
                        <SourceBadge source={r.source} />
                        <SystemFlag reason={r.system} />
                        {isTracked(tracking, r.app) && <Pin className="h-3 w-3 shrink-0 text-primary" aria-label="tracked" />}
                        <Children of={kids.get(r.app)} />
                      </div>
                      <div className="mt-1 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-muted">
                        <div
                          className={sortBy === "time" ? "h-full rounded-full bg-primary/70" : "h-full rounded-full bg-amber-400/70"}
                          style={{
                            width: `${Math.max(2, ((sortBy === "time" ? r.seconds : r.sessions) / (sortBy === "time" ? maxSeconds : maxSessions)) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-xs">{fmtDuration(r.seconds)}</div>
                      <div className="text-[10px] text-muted-foreground">{r.sessions} launches</div>
                    </div>
                    <div className="hidden shrink-0 text-right sm:block">
                      <div className="text-[10px] text-muted-foreground">{r.days} active days</div>
                      <div className="text-[10px] text-muted-foreground">last {fmtDay(r.lastDay)}</div>
                    </div>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                click any app for its page: how it works, what it needs, what you can change — and its removal plans
              </p>
            </>
          )}
        </TabsContent>

        {/* fully unused */}
        <TabsContent value="unused" className="space-y-2">
          {loading || !snap ? (
            <Skeleton className="h-12" />
          ) : unused.length === 0 ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Everything installed saw some use this month. Remarkable.
            </p>
          ) : (
            <>
              <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-xs leading-relaxed text-amber-300">
                <span className="font-medium">{removable} apps</span> are installed but were not used at
                all in {fmtMonth(snap.month)}. Candidates for the chop — click one for its page and its removal plans.
                {systemUnused > 0 &&
                  ` ${systemUnused} more, flagged System, were not used either but are part of your system: they are listed so you can see them, and are never removed from here.`}
                {trackedHidden > 0 && ` ${trackedHidden} tracked app${trackedHidden === 1 ? " is" : "s are"} kept and not listed.`}
              </p>
              <div className="overflow-hidden rounded-lg border">
                {unused.map((r) => (
                  <button
                    key={r.app}
                    onClick={() => openAppPage(r.app, r.source)}
                    className="flex w-full items-center gap-2 border-b px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-accent/40 sm:gap-3"
                    title={`Open ${r.app}: how it works, what it needs, what you can change`}
                  >
                    <CircleDot className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                    <span className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span className="truncate text-sm">{r.app}</span>
                      <Children of={kids.get(r.app)} />
                    </span>
                    <SystemFlag reason={r.system} />
                    <SourceBadge source={r.source} />
                    <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:block">
                      {r.lastUsedMonth ? `last used ${fmtMonth(r.lastUsedMonth)}` : "never seen by the logger"}
                    </span>
                    <PackageOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </>
          )}
        </TabsContent>

        {/* orphans */}
        <TabsContent value="orphans" forceMount className="data-[state=inactive]:hidden">
          <OrphansPanel key={machineVersion} onCount={setOrphanCount} />
        </TabsContent>

        {/* tracked & links */}
        <TabsContent value="tracking">
          <TrackingPanel knownApps={knownApps} sourceOf={sourceOf} onOpen={setTarget} />
        </TabsContent>
      </Tabs>

      <EliminateDialog target={target} onClose={() => setTarget(null)} onOpen={setTarget} sourceOf={sourceOf} />
    </div>
  );
}
