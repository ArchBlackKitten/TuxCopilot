// App Manager → Orphans: packages installed as a dependency that nothing needs any more
// (exactly `pacman -Qtd`). Each one is either kept (tracked: pacman -D --asexplicit) or
// removed — chosen per package. System and tracked packages can't be ticked.
import { useCallback, useEffect, useState } from "react";
import { Pin, RefreshCw, Trash2, Unlink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { orphanList, type Family } from "@/lib/api";
import { isPlannableName } from "@/lib/eliminate";
import { errText } from "@/lib/host";
import { protectedReason } from "@/lib/protected";
import { isTracked, track } from "@/lib/tracking";
import { pendingRemovals } from "@/lib/changes";
import { AppLink, AppLinks } from "./app-link";
import { useArch } from "./store";

export function OrphansPanel({ onCount }: { onCount?: (n: number) => void }) {
  const { tracking, setTracking, stageSystem, history } = useArch();
  const goingOnApply = pendingRemovals(history.pending);
  const { toast } = useToast();
  const [orphans, setOrphans] = useState<Family[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setOrphans(null);
    try {
      const list = await orphanList();
      setOrphans(list);
      onCount?.(list.length);
    } catch (e) {
      setOrphans([]);
      toast({ title: "Fluff couldn't read pacman's database", description: errText(e), variant: "destructive" });
    }
  }, [onCount, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const lockOf = (p: string) =>
    protectedReason(p) ? `part of your system: ${protectedReason(p)}` : isTracked(tracking, p) ? "tracked — kept" : null;

  // both wait for Apply (top bar); the pacman commands run then, through "Are you sure?"
  const keep = (p: string) => {
    setTracking(track(tracking, p), `Keep orphan ${p}`);
    setPicked((s) => { const n = new Set(s); n.delete(p); return n; });
    stageSystem(`Mark ${p} as installed on purpose`, `sudo pacman -D --asexplicit ${p}`, undefined, { id: `pacman.reason:${p}`, to: "explicit", from: "deps" }); // an orphan is a dependency
  };

  const removePicked = () => {
    const names = [...picked].sort().filter((p) => !lockOf(p) && !goingOnApply.has(p) && isPlannableName(p));
    if (!names.length) return;
    stageSystem(`Remove ${names.length} orphan${names.length === 1 ? "" : "s"}`, `sudo pacman -Rns --noconfirm ${names.join(" ")}`, names);
    setPicked(new Set());
    toast({ title: "Pending", description: `${names.join(", ")} will be removed when you Apply. Undo takes it back.` });
  };

  if (!orphans) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">{orphans.length} orphans</span>: packages that were installed only
          because another package needed them, and nothing needs them any more (the same list as{" "}
          <code className="font-mono">pacman -Qtd</code>). Keep the ones you use, remove the rest.
        </p>
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={() => void load()}>
          <RefreshCw className="h-3 w-3" /> Re-check
        </Button>
        <Button size="sm" variant="destructive" className="h-7 gap-1 text-[11px]" disabled={picked.size === 0} onClick={() => void removePicked()}>
          <Trash2 className="h-3 w-3" /> Remove {picked.size || ""} selected
        </Button>
      </div>

      {orphans.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No orphans. Tidy.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          {orphans.map((o) => {
            const lock = lockOf(o.package);
            return (
              <div key={o.package} className="flex flex-wrap items-center gap-2 border-b px-3 py-2 last:border-b-0">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-red-500"
                  disabled={!!lock || goingOnApply.has(o.package)}
                  checked={picked.has(o.package) && !lock}
                  onChange={(e) =>
                    setPicked((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(o.package);
                      else n.delete(o.package);
                      return n;
                    })
                  }
                  aria-label={`remove ${o.package}`}
                />
                <Unlink className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                <AppLink name={o.package} className="text-sm" />
                {lock && (
                  <Badge variant="secondary" className="px-1 py-0 text-[9px]" title={lock}>
                    {lock.startsWith("tracked") ? "tracked" : "system"}
                  </Badge>
                )}
                {goingOnApply.has(o.package) && (
                  <Badge variant="outline" className="border-red-500/50 px-1 py-0 text-[9px] text-red-400">
                    removed on Apply
                  </Badge>
                )}
                <Children of={o.children} />
                {!lock && !goingOnApply.has(o.package) && (
                  <Button size="sm" variant="ghost" className="ml-auto h-6 gap-1 px-1.5 text-[10px]" onClick={() => keep(o.package)}>
                    <Pin className="h-3 w-3" /> Keep
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** "takes along: a, b, c +4" — what would leave with a package. */
export function Children({ of }: { of: string[] | undefined }) {
  if (!of || of.length === 0) return null;
  const shown = of.slice(0, 4);
  return (
    <span className="min-w-0 truncate text-[10px] text-muted-foreground" title={of.join(", ")}>
      takes along: <AppLinks names={shown} />
      {of.length > shown.length && ` +${of.length - shown.length}`}
    </span>
  );
}
