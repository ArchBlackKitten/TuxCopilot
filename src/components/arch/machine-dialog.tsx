// "Analyse My Machine" — the popup that probes CPU / GPU / VRAM / RAM / swap /
// storage and shows, for every row, whether the value was truly *Detected*
// from this machine or merely *Estimated*.

import { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Cpu, HardDrive, MemoryStick, MonitorSmartphone, ScanSearch, Zap } from "lucide-react";
import { useArch } from "./store";
import type { SpecStatus } from "@/lib/system-specs";

const ICONS: Record<string, typeof Cpu> = {
  cpu: Cpu,
  gpu: MonitorSmartphone,
  vram: MemoryStick,
  ram: MemoryStick,
  swap: MemoryStick,
  storage: HardDrive,
  os: ScanSearch,
};

function StatusBadge({ status }: { status: SpecStatus }) {
  if (status === "detected") {
    return (
      <Badge className="gap-1 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/15">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Detected
      </Badge>
    );
  }
  if (status === "estimated") {
    return (
      <Badge className="gap-1 bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/15">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Estimated
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground/60">
      not found
    </Badge>
  );
}

export function MachineDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { specs, specsLoading, loadSpecs, recommendation } = useArch();

  useEffect(() => {
    if (open) void loadSpecs();
  }, [open, loadSpecs]);

  const profile = specs?.profile;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <ScanSearch className="h-4 w-4 text-primary" />
            Analyse my machine
          </DialogTitle>
          <DialogDescription className="text-xs">
            Every row says whether it was genuinely read from this machine (Detected) or
            worked out from other clues (Estimated). The LLM recommendations build on this sheet.
          </DialogDescription>
        </DialogHeader>

        {specsLoading && !specs ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : specs ? (
          <div className="space-y-3">
            {/* Verdict strip */}
            {profile && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-3">
                <Zap className="h-4 w-4 text-primary" />
                <span className="text-xs font-semibold">{profile.tier} tier</span>
                <span className="text-[11px] text-muted-foreground">— {profile.tierNote}</span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                  one-model budget ≈{" "}
                  {profile.budgetKind === "vram"
                    ? `${profile.gpuBudgetGB} GB VRAM`
                    : profile.budgetKind === "shared"
                      ? `${Math.min(profile.ramGB ?? 0, 16) * 0.5 > 0 ? Math.round(Math.min(profile.ramGB ?? 0, 16) * 0.5 * 10) / 10 : "?"} GB shared`
                      : `${profile.cpuRamBudgetGB} GB RAM`}
                </span>
              </div>
            )}

            <div className="divide-y divide-border/60 overflow-hidden rounded-md border">
              {specs.rows.map((row) => {
                const Icon = ICONS[row.key] ?? ScanSearch;
                return (
                  <div key={row.key} className="flex items-start gap-3 p-3">
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium">{row.label}</span>
                        <StatusBadge status={row.status} />
                      </div>
                      <div className="mt-0.5 break-words font-mono text-[11px] text-foreground/80">{row.value}</div>
                      {row.detail && <div className="mt-0.5 text-[10px] text-muted-foreground">{row.detail}</div>}
                    </div>
                  </div>
                );
              })}
            </div>

            {recommendation && (
              <>
                <Separator />
                <p className="text-[11px] leading-relaxed text-muted-foreground">{recommendation.machineSummary}</p>
              </>
            )}

            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Speed figures used elsewhere in this tab are always estimates — this sheet is the
              ground truth of what was actually measured on your machine.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Could not analyse this machine.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
