// The Ollama section: machine analysis, a model catalogue organized by
// speciality (never one global rank), comparison with the models already
// installed, and the two requested subsections — "Recommended LLamas" and
// "Unsuitable LLamas". Every install / remove / switch passes through an
// explicit confirmation dialog.

import { errText } from "@/lib/host";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Bot,
  RefreshCw,
  ScanSearch,
  Play,
  Square,
  Trash2,
  Plus,
  Flame,
  CircleAlert,
  Copy,
  Stethoscope,
} from "lucide-react";
import { TroubleshootDialog } from "./troubleshoot-dialog";
import { diagnoseOllama } from "@/lib/troubleshoot";
import { useArch, type OllamaAction } from "./store";
import { sameNode } from "@/lib/changes";
import { MachineDialog } from "./machine-dialog";
import { FitCard, UnsuitableCard, ActionConfirmDialog } from "./llm-cards";
import { SPECIALTIES, SPECIALTY_LABEL, KB_VERIFIED, type Specialty } from "@/lib/llm-kb";
import { useToast } from "@/hooks/use-toast";

const PRIORITY_LABEL: Record<string, string> = {
  speed: "Speed",
  quality: "Quality",
  low: "Low resource use",
};

export function OllamaView() {
  const {
    ollama,
    ollamaLoading,
    loadOllama,
    loadSpecs,
    recommendation,
    recLoading,
    loadRecommendations,
    priority,
    setPriority,
    ollamaAction,
    dryRun,
    run,
    loadTree,
  } = useArch();
  const { toast } = useToast();

  const [machineOpen, setMachineOpen] = useState(false);
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [filter, setFilter] = useState<Specialty | "all">("all");
  const [pending, setPending] = useState<{ action: OllamaAction; model: string } | null>(null);
  const [newTag, setNewTag] = useState("");

  useEffect(() => {
    void loadOllama();
    void loadRecommendations();
  }, []);

  // Refresh the installed list when a pull / rm / stop finishes in the terminal.
  const runStatus = run?.status;
  const prevStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (runStatus && prevStatus.current === "running" && runStatus !== "running") {
      void loadOllama();
    }
    prevStatus.current = runStatus;
  }, [runStatus, loadOllama]);

  const request = (action: OllamaAction, model: string) => setPending({ action, model });

  const confirmAction = async () => {
    if (!pending) return;
    const { action, model } = pending;
    setPending(null);
    const err = await ollamaAction(action, model, dryRun);
    if (err) {
      toast({ title: "Fluff couldn't do that", description: err, variant: "destructive" });
    } else {
      toast({
        title: dryRun ? "Previewed in terminal" : `${action} queued`,
        description: `ollama ${action === "install" ? "pull" : action === "remove" ? "rm" : action} ${model}`,
      });
    }
  };

  const addModel = async () => {
    const tag = newTag.trim();
    if (!tag || !/^[\w.:-]+$/.test(tag)) {
      toast({ title: "Fluff needs a model tag", description: "e.g. qwen3.8:27b or llama3.2:3b", variant: "destructive" });
      return;
    }
    try {
      const fields = { name: tag, category: "download" as const, source: "ollama" as const, content: tag, parentId: null, enabled: true };
      const already = sameNode(useArch.getState().tree, fields);
      useArch.getState().nodeCreate(fields);
      if (already) toast({ title: "Fluff already has it", description: `${tag} is already in your sections.` });
      else toast({ title: "Fluff added it to your sections", description: `${tag} — plays as ollama pull ${tag}` });
      setNewTag("");
      loadTree();
    } catch (err) {
      toast({ title: "Fluff ran into a problem", description: errText(err, "Fluff couldn't save it"), variant: "destructive" });
    }
  };

  // ── Derived views ───────────────────────────────────────────────────────
  const installed = ollama?.models ?? [];
  const running = new Set((ollama?.running ?? []).map((r) => r.name));

  const recFits = useMemo(() => {
    if (!recommendation) return [];
    if (filter === "all") return recommendation.recommended;
    return recommendation.categories.find((c) => c.specialty === filter)?.candidates ?? [];
  }, [recommendation, filter]);

  const compareBlocks = useMemo(() => {
    if (!recommendation) return [];
    return filter === "all" ? recommendation.categories : recommendation.categories.filter((c) => c.specialty === filter);
  }, [recommendation, filter]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <Bot className="h-5 w-5 text-emerald-400" />
        <h2 className="text-sm font-semibold">Ollama</h2>
        {ollamaLoading ? (
          <Skeleton className="h-5 w-24" />
        ) : ollama?.available && !ollama.serverUp ? (
          <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-400">
            installed · {ollama.version} · server not running
          </Badge>
        ) : ollama?.available ? (
          <Badge variant="outline" className="border-emerald-500/40 text-[10px] text-emerald-400">
            detected · {ollama.version} · {ollama.models.length} model{ollama.models.length === 1 ? "" : "s"}
          </Badge>
        ) : (
          <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-400">
            not detected on this machine
          </Badge>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={() => void loadOllama()}
            aria-label="Refresh installed models"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setDoctorOpen(true)}>
            <Stethoscope className="h-3 w-3" /> Troubleshoot
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 border-primary/40 px-2.5 text-[11px] text-primary hover:bg-primary/10 hover:text-primary"
            onClick={() => {
              setMachineOpen(true);
              void loadSpecs();
            }}
          >
            <ScanSearch className="h-3.5 w-3.5" /> Analyse my machine
          </Button>
        </div>
      </div>

      {ollama?.available && !ollama.serverUp && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 sm:flex-row sm:items-center">
          <CircleAlert className="h-4 w-4 shrink-0 text-amber-400" />
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-foreground/85">
            Ollama is installed, but its server is not running, so your models can't be listed or
            used. Troubleshoot finds out why and starts it.
          </p>
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setDoctorOpen(true)}>
            <Stethoscope className="h-3 w-3" /> Troubleshoot
          </Button>
        </div>
      )}
      <TroubleshootDialog open={doctorOpen} onClose={() => { setDoctorOpen(false); void loadOllama(); }} title="Ollama" diagnose={diagnoseOllama} />

      {/* Not-installed callout */}
      {ollama && !ollama.available && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 sm:flex-row sm:flex-wrap sm:items-center">
          <CircleAlert className="h-4 w-4 shrink-0 text-amber-400" />
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-foreground/85">
            Ollama is not on this machine, so the installed list is empty — recommendations still
            work from the analysed specs. On Arch it comes from the official repos (ollama-cuda
            for NVIDIA or ollama-rocm for AMD graphics run models on the card):
          </p>
          <div className="flex items-center gap-1.5">
            <code className="rounded bg-muted px-2 py-1 font-mono text-[10px]">sudo pacman -Syu --needed ollama && sudo systemctl enable --now ollama.service</code>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              aria-label="Copy install command"
              onClick={() => {
                navigator.clipboard.writeText("sudo pacman -Syu --needed ollama && sudo systemctl enable --now ollama.service");
                toast({ title: "Fluff copied it" });
              }}
            >
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Installed LLamas */}
      <div className="overflow-hidden rounded-md border bg-card">
        <div className="flex items-center gap-2 border-b border-border/60 p-3">
          <span className="text-sm font-semibold">Installed LLamas</span>
          <Badge variant="outline" className="text-[10px] text-muted-foreground">{installed.length}</Badge>
          {ollama && !ollama.available && (
            <span className="text-[11px] text-muted-foreground">— ollama not detected</span>
          )}
        </div>
        {installed.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            No models pulled yet — pick one from Recommended LLamas below, or add a tag manually.
          </p>
        ) : (
          <div className="divide-y divide-border/60">
            {installed.map((m) => (
              <div key={m.name} className="group flex items-center gap-2 px-3 py-1.5 hover:bg-accent/40">
                <Bot className="h-3.5 w-3.5 text-emerald-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs font-medium">{m.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {m.sizeRaw} · pulled {m.modified}
                    {running.has(m.name) ? " · loaded in memory" : ""}
                  </span>
                </span>
                {running.has(m.name) ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 gap-1 px-2 text-[10px] text-amber-400 hover:text-amber-400"
                    onClick={() => request("stop", m.name)}
                  >
                    <Square className="h-2.5 w-2.5" /> Stop
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 gap-1 px-2 text-[10px] text-primary hover:text-primary"
                    onClick={() => request("run", m.name)}
                  >
                    <Play className="h-2.5 w-2.5" /> Load
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-destructive hover:text-destructive"
                  aria-label={`Remove ${m.name}`}
                  onClick={() => request("remove", m.name)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filters: speciality chips + priority */}
      <div className="space-y-2">
        <ScrollArea className="whitespace-nowrap">
          <div className="flex items-center gap-1.5 pb-1">
            <button
              onClick={() => setFilter("all")}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                filter === "all" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              All tasks
            </button>
            {SPECIALTIES.map((sp) => (
              <button
                key={sp.id}
                onClick={() => setFilter(sp.id)}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  filter === sp.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent"
                }`}
              >
                {sp.label}
              </button>
            ))}
            <ScrollBar orientation="horizontal" />
          </div>
        </ScrollArea>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Prioritize</span>
          <div className="flex overflow-hidden rounded-md border">
            {(["speed", "quality", "low"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPriority(p)}
                className={`px-2.5 py-1 text-[11px] transition-colors ${
                  priority === p ? "bg-primary/15 font-medium text-primary" : "text-muted-foreground hover:bg-accent"
                }`}
              >
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>
          {recLoading && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {/* Recommended LLamas */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Recommended LLamas</h3>
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            {filter === "all"
              ? "best fit for each task"
              : `top fits for ${SPECIALTY_LABEL[filter].toLowerCase()}`}
          </Badge>
        </div>
        {recLoading && !recommendation ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        ) : recFits.length === 0 ? (
          <p className="rounded-md border bg-card p-4 text-center text-xs text-muted-foreground">
            Nothing suitable found for this filter — try another task or priority.
          </p>
        ) : (
          <div className="grid gap-2 xl:grid-cols-2">
            {recFits.map((fit) => (
              <FitCard key={fit.model.tag} fit={fit} onInstall={request} dryRun={dryRun} />
            ))}
          </div>
        )}
      </div>

      {/* Unsuitable LLamas */}
      {recommendation && recommendation.unsuitable.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Unsuitable LLamas</h3>
            <Badge variant="outline" className="gap-1 border-orange-500/40 text-[10px] text-orange-400">
              <Flame className="h-3 w-3" /> would burn this machine
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground">
            These cannot even start here without thrashing the whole box — listed on purpose, with
            the numbers to prove it.
          </p>
          <div className="grid gap-2 xl:grid-cols-2">
            {recommendation.unsuitable.map(({ model, reason, needGB, headroomGB }) => (
              <UnsuitableCard key={model.tag} model={model} reason={reason} needGB={needGB} headroomGB={headroomGB} />
            ))}
          </div>
        </div>
      )}

      {/* Compare by speciality */}
      {recommendation && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Compare by speciality</h3>
          <p className="text-[11px] text-muted-foreground">
            Models are judged inside their task — a maths champion is never penalised for being a
            mediocre poet, so there is deliberately no single overall ranking.
          </p>
          <div className="space-y-2">
            {compareBlocks.map((block) => (
              <div key={block.specialty} className="rounded-md border bg-card p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-xs font-semibold">{block.label}</span>
                  <span className="text-[10px] text-muted-foreground">{block.blurb}</span>
                  {block.bestFit && (
                    <Badge variant="outline" className="ml-auto border-primary/40 text-[10px] text-primary">
                      best fit here: <code className="font-mono">{block.bestFit.model.tag}</code>
                    </Badge>
                  )}
                </div>
                {block.bestFit && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/80">
                    {block.bestFit.model.strengths.split(";")[0]}.{" "}
                    <span className="font-mono text-primary">{block.bestFit.speed}</span> (estimated).
                    {block.bestFit.model.limitations.split(";")[0]}.
                  </p>
                )}
                {!block.bestFit && (
                  <p className="mt-1.5 text-[11px] text-amber-400">
                    No mainline model can take this task on here — at most helper models (such as
                    embedders) qualify. The usual suspects are listed in Unsuitable LLamas.
                  </p>
                )}
                {block.installedCovers.length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
                    {block.installedCovers.map((cov) => (
                      <p key={cov.name} className="text-[11px] text-muted-foreground">
                        <code className="font-mono text-foreground/75">{cov.name}</code> — {cov.note}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Manual add */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-3">
        <Plus className="h-4 w-4 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">Add a model tag to your sections:</span>
        <Input
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addModel()}
          placeholder="e.g. qwen3.8:27b"
          className="h-7 w-48 font-mono text-xs"
          aria-label="Ollama model tag"
        />
        <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={addModel}>
          Add
        </Button>
        <span className="text-[10px] text-muted-foreground">plays as <code className="font-mono">ollama pull &lt;tag&gt;</code></span>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Catalogue verified against the Ollama library, {KB_VERIFIED}. Sizes are Q4_K_M / MXFP4
        downloads; runtime figures include context-cache overhead and are estimates. This app never
        installs, removes or switches models without your confirmation.
      </p>

      <MachineDialog open={machineOpen} onClose={() => setMachineOpen(false)} />
      <ActionConfirmDialog pending={pending} onClose={() => setPending(null)} onConfirm={confirmAction} dryRun={dryRun} />
    </div>
  );
}
