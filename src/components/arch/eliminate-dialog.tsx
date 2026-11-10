import { useCallback, useEffect, useState } from "react";
import { eliminationPlans } from "@/lib/api";
import { chainRemoval, isPlannableName } from "@/lib/eliminate";
import { protectedReason } from "@/lib/protected";
import { domino, goingWith, isTracked, removalGate, track, untrack, usedBy, uses } from "@/lib/tracking";
import { errText } from "@/lib/host";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  BookmarkPlus,
  Check,
  Copy,
  Feather,
  Loader2,
  PackageOpen,
  Pin,
  PinOff,
  Play,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { AppLink, AppLinks } from "./app-link";
import { useArch } from "@/components/arch/store";
import { sameNode } from "@/lib/changes";
import { useToast } from "@/hooks/use-toast";
import type { EliminationPlan } from "@/lib/types";

export interface EliminateTarget {
  app: string;
  source: string;
}

const LEVEL_META: Record<
  EliminationPlan["level"],
  { label: string; icon: typeof Trash2; border: string; chip: string }
> = {
  full: {
    label: "Full",
    icon: Trash2,
    border: "border-destructive/40",
    chip: "text-destructive border-destructive/40 bg-destructive/10",
  },
  mid: {
    label: "Mid",
    icon: PackageOpen,
    border: "border-amber-400/40",
    chip: "text-amber-400 border-amber-400/40 bg-amber-400/10",
  },
  partial: {
    label: "Partial",
    icon: Feather,
    border: "border-emerald-400/40",
    chip: "text-emerald-400 border-emerald-400/40 bg-emerald-400/10",
  },
};

export function EliminateDialog({
  target,
  onClose,
  onOpen,
  sourceOf = () => "pacman",
}: {
  target: EliminateTarget | null;
  onClose: () => void;
  /** open another app's dialog (the domino: remove the app that uses this one) */
  onOpen?: (t: EliminateTarget) => void;
  /** how a linked app was installed, so its removal command fits */
  sourceOf?: (app: string) => string;
}) {
  const { tracking, setTracking } = useArch();
  const pacmanManaged = (src: string) => src === "pacman" || src === "aur";
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [plans, setPlans] = useState<EliminationPlan[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<string | null>(null);
  const [pendingRun, setPendingRun] = useState<{ command: string; level: string } | null>(null);
  const { runQuick, dryRun, loadTree } = useArch();
  const { toast } = useToast();

  useEffect(() => {
    if (!target) {
      setPlans(null);
      return;
    }
    setLoading(true);
    setRefusal(null);
    setChosen(new Set()); // every linked app starts as "keep"
    try {
      const result = eliminationPlans(target.app, target.source);
      setRefusal(result.protectedReason);
      setPlans(result.plans);
    } catch {
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, [target]);

  const copy = useCallback(
    async (text: string, key: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedIdx(key);
        toast({ title: "Fluff copied it" });
        setTimeout(() => setCopiedIdx((k) => (k === key ? null : k)), 1500);
      } catch {
        toast({ title: "Fluff couldn't copy it", variant: "destructive" });
      }
    },
    [toast]
  );

  const runCommand = useCallback(async () => {
    if (!pendingRun || !target) return;
    // its own confirmation dialog was the first "Are you sure?"
    const err = await runQuick(`Eliminate ${target.app} (${pendingRun.level})`, pendingRun.command, dryRun, 1);
    setPendingRun(null);
    if (err) toast({ title: "Fluff couldn't run it", description: err, variant: "destructive" });
  }, [pendingRun, target, runQuick, dryRun, toast]);

  const saveToCommands = useCallback(
    async (command: string, level: string) => {
      if (!target) return;
      try {
        const fields = { name: `Remove ${target.app} (${level})`, category: "command" as const, source: null, content: command, parentId: null };
        const already = sameNode(useArch.getState().tree, fields);
        useArch.getState().nodeCreate(fields);
        toast(already ? { title: "Fluff already has it", description: "It's already in the Commands section." } : { title: "Fluff saved it to Commands", description: "Find it in the Commands section" });
        void loadTree();
      } catch (e) {
        toast({
          title: "Save failed",
          description: errText(e, "Fluff doesn't know why"),
          variant: "destructive",
        });
      }
    },
    [target, toast, loadTree]
  );

  /**
   * Track = TuxCopilot's keep-list, and for pacman/AUR apps also pacman's own record:
   * `pacman -D --asexplicit` (installed on purpose → never swept up as an orphan, even by a
   * sweep run outside this app). Untrack only leaves the keep-list; marking it a dependency in
   * pacman is a separate, deliberate button, because that makes it an orphan-sweep candidate.
   */
  const toggleTrack = async () => {
    if (!target) return;
    const app = target.app;
    // both wait for Apply; the pacman mark runs then, through the "Are you sure?" prompts
    if (isTracked(tracking, app)) {
      setTracking(untrack(tracking, app), `Untrack ${app}`);
      const st = useArch.getState();
      const markWaits = st.history.pending.some((c) => c.kind === "system" && c.target?.id === `pacman.reason:${app}` && c.target.to === "explicit");
      if (markWaits && !isTracked(st.savedTracking, app)) st.dropTarget(`pacman.reason:${app}`); // it was only tracked on screen
      toast({ title: `${app} untracked — pending`, description: "Apply to save. pacman's own record is unchanged." });
      return;
    }
    setTracking(track(tracking, app), `Track ${app}`);
    if (pacmanManaged(target.source) && isPlannableName(app)) {
      useArch.getState().stageSystem(`Mark ${app} as installed on purpose`, `sudo pacman -D --asexplicit ${app}`, undefined, { id: `pacman.reason:${app}`, to: "explicit" });
    }
    toast({ title: `${app} tracked — pending`, description: "Apply to save it (and to mark it in pacman)." });
  };

  const markAsDependency = () => {
    if (!target || !isPlannableName(target.app)) return;
    useArch.getState().stageSystem(`Mark ${target.app} as a dependency`, `sudo pacman -D --asdeps ${target.app}`, undefined, { id: `pacman.reason:${target.app}`, to: "deps" });
    toast({ title: "Pending", description: `${target.app} will be marked as a dependency when you Apply.` });
  };

  const gate = target ? removalGate(tracking, target.app) : null;
  const dominoList = target ? domino(tracking, target.app, chosen) : [];
  const going = target ? goingWith(tracking, target.app, chosen).filter((a) => !protectedReason(a)) : [];
  const chainCommand = target
    ? chainRemoval([{ app: target.app, source: target.source }, ...going.map((a) => ({ app: a, source: sourceOf(a) }))])
    : "";

  return (
    <>
      <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto bg-card sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <span>
                Eliminate <span className="font-mono text-primary">{target?.app}</span>
              </span>
              {target && !refusal && (
                <Button
                  size="sm"
                  variant={isTracked(tracking, target.app) ? "secondary" : "outline"}
                  className="ml-auto mr-6 h-6 gap-1 px-2 text-[10px]"
                  onClick={() => void toggleTrack()}
                  title="Tracked apps are kept: never listed as unused, never removed on their own"
                >
                  {isTracked(tracking, target.app) ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
                  {isTracked(tracking, target.app) ? "Tracked — untrack" : "Track (keep)"}
                </Button>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {target ? (
                <>
                  installed via{" "}
                  <Badge variant="outline" className="mx-0.5 px-1.5 py-0 text-[10px] capitalize">
                    {target.source}
                  </Badge>{" "}
                  — three depths of goodbye, because <code className="font-mono">-Rns</code> alone is not always the
                  whole story
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          {loading && (
            <div className="grid gap-3 md:grid-cols-3">
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
            </div>
          )}

          {!loading && refusal && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm">
              <p className="font-medium text-red-400">This one stays — it is not offered for removal.</p>
              <p className="mt-1 text-muted-foreground">
                <span className="font-mono">{target?.app}</span> is {refusal}. Removing it can leave Arch unable to
                start, log in, show the desktop or reach the internet, so App Manager never builds a plan for it.
              </p>
            </div>
          )}

          {!loading && !refusal && target && gate && !gate.allowed && (
            <div className="rounded-md border border-sky-500/40 bg-sky-500/10 p-4 text-sm">
              <p className="font-medium text-sky-300">Tracked — kept on purpose.</p>
              {gate.reason === "tracked-used" ? (
                <>
                  <p className="mt-1 text-muted-foreground">
                    <AppLink name={target.app} source={target.source} /> is used by{" "}
                    <AppLinks names={gate.via} />. It can only be removed together with the
                    app that uses it: open that app, and choose to remove {target.app} with it.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {gate.via.map((v) => (
                      <Button key={v} size="sm" variant="outline" className="h-7 text-xs" onClick={() => onOpen?.({ app: v, source: sourceOf(v) })}>
                        Remove {v} instead…
                      </Button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p className="mt-1 text-muted-foreground">
                    Nothing uses <span className="font-mono">{target.app}</span>, so untrack it first if you really want it
                    gone.
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void toggleTrack()}>
                      Untrack {target.app}
                    </Button>
                    {pacmanManaged(target.source) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[11px] text-muted-foreground"
                        onClick={() => void markAsDependency()}
                        title="sudo pacman -D --asdeps — pacman's orphan sweep (pacman -Qtdq) may then remove it"
                      >
                        Also mark it a dependency in pacman (--asdeps)
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {!loading && !refusal && target && gate?.allowed && usedBy(tracking, target.app).length > 0 && (
            <p className="flex gap-1.5 rounded-md border border-amber-400/30 bg-amber-400/10 p-2 text-xs text-amber-300">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <AppLinks names={usedBy(tracking, target.app)} /> uses {target.app}, and may stop
                working without it.
              </span>
            </p>
          )}

          {!loading && !refusal && target && gate?.allowed && uses(tracking, target.app).length > 0 && (
            <div className="rounded-md border p-3">
              <p className="mb-2 text-xs font-medium">
                {target.app} uses these apps. Keep them, or remove them together?
              </p>
              <div className="space-y-1.5">
                {dominoList.map((d) => {
                  const locked = protectedReason(d.app);
                  const removing = chosen.has(d.app) && !locked;
                  return (
                    <div key={d.app} className="flex flex-wrap items-center gap-2 rounded border bg-muted/30 px-2 py-1.5 text-xs">
                      <AppLink name={d.app} source={sourceOf(d.app)} />
                      <span className="text-[10px] text-muted-foreground">used by <AppLinks names={d.usedBy} /></span>
                      {d.tracked && <Badge variant="secondary" className="px-1 py-0 text-[9px]">tracked</Badge>}
                      {d.stillUsedBy.length > 0 && (
                        <span className="text-[10px] text-amber-300">also used by <AppLinks names={d.stillUsedBy} />, which stays</span>
                      )}
                      <div className="ml-auto flex overflow-hidden rounded border">
                        <button
                          className={`px-2 py-0.5 text-[10px] ${!removing ? "bg-primary/20 text-primary" : "text-muted-foreground"}`}
                          onClick={() => setChosen((c) => { const n = new Set(c); n.delete(d.app); return n; })}
                        >
                          Keep
                        </button>
                        <button
                          disabled={!!locked}
                          title={locked ? `part of your system: ${locked}` : undefined}
                          className={`px-2 py-0.5 text-[10px] ${removing ? "bg-red-500/20 text-red-400" : "text-muted-foreground"} disabled:opacity-40`}
                          onClick={() => setChosen((c) => new Set(c).add(d.app))}
                        >
                          Remove together
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {going.length > 0 && (
                <div className="mt-3 rounded-md border border-red-500/50 bg-red-500/10 p-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-red-400">
                    🔥 All in one — removes {target.app} and {going.join(", ")}
                  </p>
                  <code className="block break-all font-mono text-[11px] text-primary">$ {chainCommand}</code>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    One app after another; if any removal fails, the ones after it are not touched.
                  </p>
                  <div className="mt-1.5 flex gap-1">
                    <Button size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[10px]" onClick={() => copy(chainCommand, "chain")}>
                      {copiedIdx === "chain" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} Copy
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[10px]" onClick={() => setPendingRun({ command: chainCommand, level: "full" })}>
                      <Play className="h-3 w-3" /> Run
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!loading && !refusal && plans && plans.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No removal plan could be built for this app.
            </p>
          )}

          {!loading && plans && plans.length > 0 && gate?.allowed && (
            <div className="grid gap-3 md:grid-cols-3">
              {plans.map((plan) => {
                const meta = LEVEL_META[plan.level];
                const Icon = meta.icon;
                return (
                  <div key={plan.level} className={`flex flex-col rounded-lg border ${meta.border} p-3`}>
                    <div className="flex items-center gap-2">
                      <span className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${meta.chip}`}>
                        <Icon className="h-3 w-3" />
                        {meta.label}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs font-medium">{plan.title}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{plan.tagline}</p>

                    <div className="mt-2 space-y-1 text-[10px] leading-snug">
                      {plan.removes.length > 0 && (
                        <p>
                          <span className="font-medium text-destructive/90">goes:</span>{" "}
                          <span className="text-muted-foreground">{plan.removes.join(", ")}</span>
                        </p>
                      )}
                      {plan.keeps.length > 0 && (
                        <p>
                          <span className="font-medium text-emerald-400/90">stays:</span>{" "}
                          <span className="text-muted-foreground">{plan.keeps.join(", ")}</span>
                        </p>
                      )}
                    </div>

                    <Separator className="my-2.5" />

                    <div className="space-y-2">
                      {plan.commands.map((c, i) => (
                        <div
                          key={i}
                          className={`rounded-md border p-2 ${c.allInOne ? "border-red-500/50 bg-red-500/10" : "bg-muted/40"}`}
                        >
                          {c.allInOne && (
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-red-400">
                              🔥 All in one — removes {target?.app} entirely
                            </p>
                          )}
                          <code className="block break-all font-mono text-[11px] text-primary" data-testid={`elim-cmd-${plan.level}-${i}`}>
                            $ {c.command}
                          </code>
                          <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{c.note}</p>
                          <div className="mt-1.5 flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 gap-1 px-1.5 text-[10px]"
                              onClick={() => copy(c.command, `${plan.level}-${i}`)}
                            >
                              {copiedIdx === `${plan.level}-${i}` ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                              Copy
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 gap-1 px-1.5 text-[10px]"
                              onClick={() => setPendingRun({ command: c.command, level: plan.level })}
                            >
                              <Play className="h-3 w-3" /> Run
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 gap-1 px-1.5 text-[10px]"
                              onClick={() => saveToCommands(c.command, plan.level)}
                            >
                              <BookmarkPlus className="h-3 w-3" /> Save
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {plan.warning && (
                      <p className="mt-2 flex gap-1.5 rounded-md border border-amber-400/30 bg-amber-400/10 p-2 text-[10px] leading-snug text-amber-300">
                        <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                        {plan.warning}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* confirmation gate — nothing executes without an explicit yes */}
      <AlertDialog open={pendingRun !== null} onOpenChange={(o) => !o && setPendingRun(null)}>
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">Run this command now?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-xs">
                <code className="block rounded bg-muted px-2 py-1.5 font-mono text-[11px] text-primary">
                  $ {pendingRun?.command}
                </code>
                {dryRun ? (
                  <p className="text-muted-foreground">
                    Dry Run is ON — the command will be shown in the terminal, not executed. Flip the top-bar switch
                    to go live.
                  </p>
                ) : (
                  <p className="font-medium text-destructive">
                    Live mode is ON — this will execute on your machine for real.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction className="h-8 text-xs" onClick={runCommand}>
              {dryRun ? "Preview in terminal" : "Execute"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
