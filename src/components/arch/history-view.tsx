import { checkRemovals, getRun, listRuns, removedAppsLog } from "@/lib/api";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Camera, History, RefreshCw } from "lucide-react";
import { PairButtons } from "./fluff-snapshots-panel";
import { fluffSnapshots, UNDO_WORDS } from "@/lib/snapshot";
import { joinHistory, type Entry, type Pair, type Removal, type RunRow } from "@/lib/history";
import { useArch } from "./store";
import { screen } from "@/lib/terminal-text";

const STATUS_CLASS: Record<string, string> = {
  running: "text-primary border-primary/40",
  success: "text-ok border-ok/40",
  failed: "text-destructive border-destructive/40",
  stopped: "text-warn border-warn/40",
  "dry-run": "text-dry border-dry/40",
  interrupted: "text-warn border-warn/40",
};

/** Runs (each with its snapshot pair), Fluff's pairs whose run is older, and the apps that left the machine: newest first, one timeline. */
async function readLog(): Promise<Entry[]> {
  await checkRemovals().catch(() => {});
  const [runs, snaps, removed] = await Promise.all([listRuns() as Promise<RunRow[]>, fluffSnapshots().catch(() => []), removedAppsLog().catch(() => [] as Removal[])]);
  return joinHistory(runs, snaps, removed);
}

/** A snapshot pair, said under its change: its numbers, and whether the change finished. */
function PairLine({ pair, after, alone }: { pair: Pair; after: () => void; alone?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 pl-3 text-[10px] text-muted-foreground">
      <Camera className="h-3 w-3 text-primary" />
      <span className="min-w-0 flex-1">
        {alone && <span className="text-foreground">{pair.base} · </span>}
        snapshots {pair.pre} and {pair.post}
        {pair.unfinished && <span className="text-warn"> · this change did not finish: they hold what it did change</span>}
        {alone && <span> · {pair.when.replace("T", " ")} (its run is older than the last 50)</span>}
      </span>
      <PairButtons pair={pair} after={after} />
    </div>
  );
}

export function HistoryView() {
  const { machineVersion } = useArch();
  const [runs, setRuns] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<{ label: string; output: string; status: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setRuns(await readLog());
    } catch {}
    setLoading(false);
  };

  // Initial load — fetch without synchronous setState in the effect body
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await readLog();
        if (!cancelled) setRuns(data);
      } catch {}
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [machineVersion]);

  const openDetail = async (id: string) => {
    try {
      const run = await getRun(id);
      setDetail({ label: run.label, output: run.output ?? "", status: run.status });
    } catch {
      // run vanished — nothing to show
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="h-6 px-2 text-[11px] font-normal">
          last 50 runs, with Fluff's snapshots · apps removed
        </Badge>
        <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1.5 text-xs" onClick={load}>
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {runs.some((e) => e.kind === "pair" || (e.kind === "run" && e.pair)) && <p className="text-[11px] text-muted-foreground">{UNDO_WORDS}</p>}

      <div className="overflow-hidden rounded-md border">
        {runs.length === 0 && !loading ? (
          <div className="p-8 text-center">
            <History className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              No runs yet. Press Play (or a Dry Run) on the Home section and it will show up here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {runs.map((e) =>
              e.kind === "pair" ? (
                <div key={`pair-${e.pair.pre}-${e.pair.post}`} className="px-3 py-2">
                  <PairLine pair={e.pair} after={() => void load()} alone />
                </div>
              ) : e.kind === "removed" ? (
                <div key={`rm-${e.removal.app}-${e.at}`} className="flex w-full items-center gap-3 px-3 py-2">
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal text-bad border-bad/40">
                    removed
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {e.removal.app} <span className="text-muted-foreground">({e.removal.source}) is no longer on this machine</span>
                    {e.removal.back && <span className="text-muted-foreground"> · installed again since</span>}
                  </span>
                  <span className="text-[10px] text-muted-foreground" title="when the app noticed; it may have left a little earlier">
                    {new Date(e.at).toLocaleString()}
                  </span>
                </div>
              ) : (
              <div key={e.run.id} className="space-y-1 py-1">
              <button
                onClick={() => openDetail(e.run.id)}
                className="flex w-full items-center gap-3 px-3 py-1 text-left hover:bg-accent/40"
              >
                <Badge
                  variant="outline"
                  className={`h-5 px-1.5 text-[10px] font-normal capitalize ${STATUS_CLASS[e.run.status] ?? ""}`}
                >
                  {e.run.dryRun ? "dry-run" : e.run.status}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-xs">{e.run.label}</span>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(e.run.createdAt).toLocaleString()}
                </span>
              </button>
              {e.pair && (
                <div className="px-3">
                  <PairLine pair={e.pair} after={() => void load()} />
                </div>
              )}
              </div>
              )
            )}
          </div>
        )}
      </div>

      <Dialog open={Boolean(detail)} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[80vh] overflow-hidden bg-card sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm">{detail?.label}</DialogTitle>
          </DialogHeader>
          <div className="terminal-out max-h-[55vh] overflow-y-auto rounded-md bg-term p-3 text-term-foreground">
            {detail?.output ? screen(detail.output) : "(no output captured)"}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
