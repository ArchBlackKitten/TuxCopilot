// Cards for the Ollama section: a recommendation card, an "Unsuitable LLamas"
// burner card (with the requested fire emoji), and the confirmation dialog
// that gates every install / remove / switch action.

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Check, Download, Flame, HardDrive, MemoryStick, Gauge, CircleAlert } from "lucide-react";
import { SourceLinkIcon } from "./source-link";
import { SPECIALTY_LABEL, type LlmModel, type Specialty } from "@/lib/llm-kb";
import type { Fit } from "@/lib/llm-recommend";
import type { OllamaAction, OllamaAction as StoreOllamaAction } from "./store";

const VERDICT_STYLE: Record<string, string> = {
  fast: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  usable: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  slow: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  unusable: "bg-destructive/15 text-destructive border-destructive/30",
};

const VERDICT_LABEL: Record<string, string> = {
  fast: "fast fit",
  usable: "usable",
  slow: "borderline",
  unusable: "will not start",
};

export function FitCard({
  fit,
  onInstall,
  dryRun,
}: {
  fit: Fit;
  onInstall: (action: StoreOllamaAction, model: string) => void;
  dryRun: boolean;
}) {
  const m = fit.model;
  const installed = fit.installed;
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-card p-3.5 transition-colors hover:border-primary/40">
      <div className="flex flex-wrap items-center gap-2">
        <SourceLinkIcon source="ollama" content={m.tag} name={m.tag} />
        <code className="font-mono text-xs font-bold">{m.tag}</code>
        <span className="text-[11px] text-muted-foreground">
          {m.family} · {m.params}
        </span>
        <Badge variant="outline" className={`text-[10px] capitalize ${VERDICT_STYLE[fit.verdict]}`}>
          <Gauge className="h-3 w-3" /> {VERDICT_LABEL[fit.verdict]}
        </Badge>
        {fit.bestFor && (
          <Badge variant="outline" className="border-primary/40 bg-primary/10 text-[10px] text-primary">
            best for {SPECIALTY_LABEL[fit.bestFor as Specialty].toLowerCase()}
          </Badge>
        )}
        <div className="ml-auto">
          {installed ? (
            <Badge variant="outline" className="gap-1 border-emerald-500/40 text-[10px] text-emerald-400">
              <Check className="h-3 w-3" /> installed
            </Badge>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-[11px] text-primary hover:bg-primary/10 hover:text-primary"
              onClick={() => onInstall("install", m.tag)}
            >
              <Download className="h-3 w-3" /> Install
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
          <HardDrive className="h-3 w-3" /> {m.sizeGB} GB on disk
        </span>
        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
          <MemoryStick className="h-3 w-3" /> ~{m.ramGB} GB at runtime
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{m.quant}</span>
        <span className="rounded bg-muted px-1.5 py-0.5">{m.ctx} context</span>
        <span className="rounded bg-muted px-1.5 py-0.5">{m.year}</span>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <p className="rounded border-l-2 border-emerald-500/60 bg-emerald-500/5 px-2 py-1.5 text-[11px] leading-relaxed text-foreground/85">
          <span className="font-semibold text-emerald-400">Strengths </span>
          {m.strengths}
        </p>
        <p className="rounded border-l-2 border-amber-500/60 bg-amber-500/5 px-2 py-1.5 text-[11px] leading-relaxed text-foreground/85">
          <span className="font-semibold text-amber-400">Limitations </span>
          {m.limitations}
        </p>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground/80">Expected performance on this machine: </span>
        <span className="font-mono text-primary">{fit.speed}</span> (estimated) — {fit.perfNote}
      </p>
      {fit.storageNote && (
        <p className="flex items-center gap-1.5 text-[11px] text-amber-400">
          <CircleAlert className="h-3.5 w-3.5 shrink-0" /> {fit.storageNote}.
        </p>
      )}
      {dryRun && !installed && (
        <p className="text-[10px] text-muted-foreground">
          Dry Run is on — installing will only preview <code className="font-mono">ollama pull {m.tag}</code>.
        </p>
      )}
    </div>
  );
}

export function UnsuitableCard({ model, reason, needGB, headroomGB }: {
  model: LlmModel;
  reason: string;
  needGB: number;
  headroomGB: number;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <Flame className="h-4 w-4 shrink-0 text-orange-500" />
        <code className="font-mono text-xs font-bold">{model.tag}</code>
        <span className="text-[11px] text-muted-foreground">
          {model.family} · {model.params}
        </span>
        <Badge variant="outline" className="ml-auto gap-1 border-orange-500/40 bg-orange-500/10 text-[10px] text-orange-400">
          🔥 burner — needs ~{needGB} GB (over budget by ~{headroomGB} GB)
        </Badge>
      </div>
      <p className="text-[11px] leading-relaxed text-foreground/80">{reason}</p>
      <p className="text-[10px] text-muted-foreground">
        {model.ctx} context · {model.quant} · {model.sizeGB} GB download — listed so you know
        exactly what <span className="italic">not</span> to pull on this machine.
      </p>
    </div>
  );
}

export function ActionConfirmDialog({
  pending,
  onClose,
  onConfirm,
  dryRun,
}: {
  pending: { action: OllamaAction; model: string } | null;
  onClose: () => void;
  onConfirm: () => void;
  dryRun: boolean;
}) {
  if (!pending) return null;
  const { action, model } = pending;
  const titles: Record<OllamaAction, string> = {
    install: `Install ${model}?`,
    remove: `Remove ${model}?`,
    run: `Switch to ${model}?`,
    stop: `Stop ${model}?`,
  };
  const commands: Record<OllamaAction, string> = {
    install: `ollama pull ${model}`,
    remove: `ollama rm ${model}`,
    run: `ollama run ${model} ""`,
    stop: `ollama stop ${model}`,
  };
  const descriptions: Record<OllamaAction, string> = {
    install: "Downloads the model to disk. Nothing else changes, and it can be removed again later.",
    remove: "Deletes the model from this machine's disk. You can always pull it again.",
    run: "Loads the model into memory — a light 'switch' that makes it the one answering right now. It leaves memory when stopped or swapped.",
    stop: "Unloads the model from memory, freeing its RAM/VRAM. The weights stay on disk.",
  };
  return (
    <AlertDialog open={pending !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="bg-card">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-sm">{titles[action]}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-xs">
              <p>{descriptions[action]}</p>
              <code className="block rounded bg-muted px-2 py-1.5 font-mono text-[11px] text-primary">
                $ {commands[action]}
              </code>
              {dryRun ? (
                <p className="text-amber-400">
                  Dry Run is on — confirming will only preview the command, not execute it.
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  This runs for real. Nothing in this app installs, removes or switches models
                  without this confirmation.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>No, cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {dryRun ? "Yes, preview it" : `Yes, ${action === "run" ? "switch" : action}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
