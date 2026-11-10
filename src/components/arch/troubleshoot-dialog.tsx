// Troubleshoot + Reset, shared by Docker and Ollama: read-only checks, each failed one with
// its cause and the command that fixes it; the recent errors from its log; the resets.
// Fixes and resets run like any other command — previewed in Dry Run, asked about live.
import { useCallback, useEffect, useState } from "react";
import { CircleCheck, CircleHelp, CircleX, Copy, RefreshCw, RotateCcw, Stethoscope, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatReport, type Diagnosis, type Fix } from "@/lib/troubleshoot";
import { useArch } from "./store";

export function TroubleshootDialog({
  open,
  onClose,
  title,
  diagnose,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  diagnose: () => Promise<Diagnosis>;
}) {
  const { runQuick, dryRun, machineVersion, noteTerminal } = useArch();
  const { toast } = useToast();
  const [d, setD] = useState<Diagnosis | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // the report also goes to the terminal panel, so pressing Troubleshoot always shows there
  const check = useCallback(async () => {
    setBusy(true);
    setFailed(null);
    noteTerminal(`Troubleshoot ${title}`, `── TROUBLESHOOT ─ ${title}\nchecking…\n`);
    try {
      const r = await diagnose();
      setD(r);
      noteTerminal(`Troubleshoot ${title}`, formatReport(title, r));
    } catch (e) {
      setD(null);
      setFailed(String(e));
      noteTerminal(`Troubleshoot ${title}`, `── TROUBLESHOOT ─ ${title}\nthe checks could not run: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }, [diagnose, noteTerminal, title]);

  // check again once a fix has run
  useEffect(() => {
    if (open) void check();
  }, [open, check, machineVersion]);

  // close this window first: the "Are you sure?" prompt and the terminal must not sit behind it
  const run = async (f: Fix) => {
    onClose();
    const err = await runQuick(f.label, f.command, dryRun);
    if (err) toast({ title: `Fluff couldn't finish: ${f.label}`, description: err, variant: "destructive" });
  };
  const copy = (f: Fix) => {
    void navigator.clipboard.writeText(f.command);
    toast({ title: "Fluff copied it", description: f.command.slice(0, 80) });
  };

  const bad = d?.checks.filter((c) => c.ok === false).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Stethoscope className="h-4 w-4 text-primary" /> Troubleshoot {title}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {failed
              ? `The checks could not run: ${failed}`
              : busy && !d
              ? "Checking…"
              : bad === 0
                ? "Every check passed. If it still misbehaves, try a reset below."
                : `${bad} thing${bad === 1 ? "" : "s"} wrong — each comes with the fix. Fix them top to bottom: a later one often follows from an earlier one.`}
            {" "}The same report is in the terminal panel. A fix closes this window and runs there.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          {d?.checks.map((c) => (
            <div key={c.id} className="flex items-start gap-2 rounded-md border px-3 py-2">
              {c.ok === true ? (
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              ) : c.ok === false ? (
                <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              ) : (
                <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium">{c.label}</div>
                <div className="text-[11px] text-muted-foreground">{c.ok === null ? "can't tell until the checks above pass" : c.detail}</div>
                {c.fix && <FixRow fix={c.fix} onRun={run} onCopy={copy} icon="fix" />}
              </div>
            </div>
          ))}
        </div>

        {d && d.errors.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium">Recent errors in its log</p>
            <pre className="max-h-40 overflow-auto rounded-md bg-term p-2 text-[10px] leading-relaxed text-term-foreground">{d.errors.join("\n")}</pre>
          </div>
        )}

        {d && d.resets.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium">Reset</p>
            {d.resets.map((f) => (
              <div key={f.label} className="rounded-md border px-3 py-2">
                <FixRow fix={f} onRun={run} onCopy={copy} icon="reset" />
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" disabled={busy} onClick={() => void check()}>
            <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} /> Check again
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FixRow({ fix, onRun, onCopy, icon }: { fix: Fix; onRun: (f: Fix) => void; onCopy: (f: Fix) => void; icon: "fix" | "reset" }) {
  const Icon = icon === "fix" ? Wrench : RotateCcw;
  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]" onClick={() => onRun(fix)}>
          <Icon className="h-3 w-3" /> {fix.label}
        </Button>
        <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]" title={fix.command}>
          {fix.command}
        </code>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onCopy(fix)} aria-label="Copy command">
          <Copy className="h-3 w-3" />
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">{fix.note}</p>
    </div>
  );
}
