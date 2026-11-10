// Security: the kernel's own protections — Usual / Recommended / Strict, each setting
// said with what it costs.
import { useCallback, useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { errText } from "@/lib/host";
import { kernelSettings, presetChanges, presetCommand, presetNow, PRESETS, SETTINGS, type Preset } from "@/lib/hardening";
import { useArch } from "./store";

export function KernelPanel() {
  const { runQuick, dryRun, machineVersion } = useArch();
  const { toast } = useToast();
  const [k, setK] = useState<{ values: Record<string, string | null>; fileThere: boolean } | null>(null);
  const [open, setOpen] = useState<Preset | null>(null);
  const load = useCallback(() => void kernelSettings().then(setK, () => setK(null)), []);
  useEffect(load, [load, machineVersion]);
  if (!k) return null;
  const now = presetNow(k.values, k.fileThere);
  const choose = async (p: Preset) => {
    const label = `The kernel's protections: ${PRESETS.find((x) => x.id === p)!.label}`;
    const err = await runQuick(label, presetCommand(p), dryRun);
    if (err) toast({ title: `Fluff couldn't finish: ${label}`, description: errText(err), variant: "destructive" });
    load();
  };
  const shown = open && open !== "usual" ? presetChanges(k.values, open) : [];
  return (
    <div className="space-y-1.5 rounded-md border p-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <Cpu className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium">The kernel's own protections</span>
        <span className="text-muted-foreground">({SETTINGS.length} settings, each said below before you choose)</span>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-3">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => setOpen(open === p.id ? null : p.id)}
            className={`rounded-md border px-2 py-1.5 text-left transition-colors ${now === p.id ? "border-primary/60 bg-primary/10" : "hover:bg-accent/40"}`}
          >
            <div className="flex items-center gap-1.5 font-medium">
              {p.label}
              {now === p.id && <Badge variant="outline" className="px-1 py-0 text-[9px]">now</Badge>}
              {p.id === "recommended" && <Badge variant="outline" className="px-1 py-0 text-[9px] text-primary">Fluff recommends</Badge>}
            </div>
            <div className="text-[10px] leading-relaxed text-muted-foreground">{p.what}</div>
          </button>
        ))}
      </div>
      {now === null && <p className="text-muted-foreground">Now: a mix — some values differ from every preset.</p>}
      {open && open !== now && (
        <div className="space-y-1 rounded-md border bg-background/60 p-2">
          {open === "usual" ? (
            <p>TuxCopilot's file goes; the usual values come back (some only at the next restart).</p>
          ) : shown.length === 0 ? (
            <p>Nothing changes: the kernel already runs these values.</p>
          ) : (
            shown.map((s) => (
              <div key={s.key}>
                <code className="font-mono">{s.key}</code> <span className="text-muted-foreground">{s.now ?? "(only root may read it)"} → {s.to}</span>
                <div className="text-muted-foreground">{s.what}</div>
                {s.cost && <div className="text-warn">Costs: {s.cost}</div>}
              </div>
            ))
          )}
          <button className="rounded border px-2 py-0.5 text-[10px] hover:bg-accent/40" onClick={() => void choose(open)}>
            Use {PRESETS.find((x) => x.id === open)!.label}
          </button>
        </div>
      )}
    </div>
  );
}
