// Top bar: Undo · Redo · Apply (N) · Discard — every edit in every section waits here until
// Apply. Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) / Ctrl+S, except while typing in a text box,
// which keeps its own undo.
import { useEffect, useState } from "react";
import { Check, Redo2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useArch } from "./store";

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

export function ChangesBar() {
  const { history, applying, undo, redo, discard, apply, dryRun } = useArch();
  const { toast } = useToast();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const n = history.pending.length;
  const systemN = history.pending.filter((c) => c.kind === "system").length;

  const doApply = async () => {
    const r = await apply();
    if (r.error) {
      toast({ title: "Fluff stopped applying", description: `${r.applied} applied, then: ${r.error}. The rest is still pending.`, variant: "destructive" });
    } else if (r.systemLeft > 0) {
      toast({
        title: `${r.applied} saved`,
        description: dryRun
          ? `${r.systemLeft} system change${r.systemLeft === 1 ? " was" : "s were"} only previewed (Dry Run) and ${r.systemLeft === 1 ? "is" : "are"} still pending. Switch Dry Run off and Apply again to run ${r.systemLeft === 1 ? "it" : "them"}.`
          : `${r.systemLeft} system change${r.systemLeft === 1 ? " is" : "s are"} still pending (not confirmed).`,
      });
    } else if (r.applied) {
      toast({ title: `${r.applied} change${r.applied === 1 ? "" : "s"} applied` });
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || typing(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) undo();
      else if ((k === "z" && e.shiftKey) || k === "y") redo();
      else if (k === "s") void doApply();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const last = history.pending[n - 1];
  const next = history.redo[history.redo.length - 1];

  return (
    <TooltipProvider delayDuration={300}>
      <div data-guide="changes" className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!n || applying} onClick={undo} aria-label="Undo">
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="text-xs">{last ? `Undo: ${last.label} (Ctrl+Z)` : "Nothing to undo"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!history.redo.length || applying} onClick={redo} aria-label="Redo">
              <Redo2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="text-xs">{next ? `Redo: ${next.label} (Ctrl+Shift+Z)` : "Nothing to redo"}</TooltipContent>
        </Tooltip>

        {n > 0 && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" className="ml-1 h-7 gap-1.5 bg-emerald-600 px-2 text-[11px] text-white hover:bg-emerald-600/90" disabled={applying} onClick={() => void doApply()}>
                  <Check className="h-3.5 w-3.5" /> {applying ? "Applying…" : `Apply ${n}`}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-[320px] text-xs">
                <p className="mb-1 font-medium">Waiting to be applied (Ctrl+S):</p>
                <ol className="list-decimal space-y-0.5 pl-4">
                  {history.pending.slice(-12).map((c, i) => (
                    <li key={i} className={c.kind === "system" ? "text-amber-300" : undefined}>
                      {c.label}
                    </li>
                  ))}
                </ol>
                {n > 12 && <p className="mt-1 text-muted-foreground">…and {n - 12} earlier</p>}
                {systemN > 0 && (
                  <p className="mt-1 text-amber-300">
                    {systemN} change{systemN === 1 ? "" : "s"} to the system run after saving, through “Are you sure?”.
                  </p>
                )}
              </TooltipContent>
            </Tooltip>
            {confirmDiscard ? (
              <span className="flex items-center gap-1 text-[11px]">
                discard all {n}?
                <Button size="sm" variant="destructive" className="h-6 px-1.5 text-[10px]" onClick={() => { discard(); setConfirmDiscard(false); }}>
                  Yes
                </Button>
                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => setConfirmDiscard(false)}>
                  No
                </Button>
              </span>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-7 w-7" disabled={applying} onClick={() => setConfirmDiscard(true)} aria-label="Discard all pending changes">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-xs">Discard every pending change</TooltipContent>
              </Tooltip>
            )}
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
