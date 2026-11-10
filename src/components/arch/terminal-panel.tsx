import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown,
  Square,
  Copy,
  TerminalSquare,
  Eraser,
} from "lucide-react";
import { useArch } from "./store";
import { screen } from "@/lib/terminal-text";
import type { RunStatus } from "@/lib/types";
import { packageWork } from "@/lib/run-safety";

const STATUS_STYLE: Record<RunStatus, { dot: string; label: string }> = {
  idle: { dot: "bg-muted-foreground", label: "idle" },
  running: { dot: "bg-primary running-dot", label: "running" },
  success: { dot: "bg-ok", label: "success" },
  failed: { dot: "bg-destructive", label: "failed" },
  stopped: { dot: "bg-warn", label: "stopped" },
  "dry-run": { dot: "bg-dry", label: "dry run" },
};

/** A Troubleshoot report shows until a run newer than it starts (and never over a live run). */
export function showsNote(note: { at: number } | null, run: { status: string; startedAt: string | null } | null): boolean {
  if (!note) return false;
  if (!run) return true;
  return run.status !== "running" && note.at > (Date.parse(run.startedAt ?? "") || 0);
}

export function TerminalPanel() {
  const { run: realRun, terminalOpen, setTerminalOpen, stopRun, terminalNote } = useArch();
  const [sureStop, setSureStop] = useState<string | null>(null); // the package manager Stop would interrupt
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // a Troubleshoot report shows until something newer runs
  const showNote = showsNote(terminalNote, realRun);
  const run = showNote ? null : realRun;
  const status = run?.status ?? "idle";
  const st = showNote ? { dot: "bg-sky-400", label: "report" } : STATUS_STYLE[status];
  // a clock while it runs, so a quiet step still shows it is alive
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (status !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status]);
  const secs = run?.startedAt ? Math.max(0, Math.floor((now - Date.parse(run.startedAt)) / 1000)) : 0;
  const elapsed = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run?.output, terminalOpen, terminalNote]);

  const copy = async () => {
    await navigator.clipboard.writeText(showNote ? terminalNote!.text : screen(run?.output ?? ""));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!terminalOpen) return null;

  return (
    <div className="border-t bg-term">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <TerminalSquare className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold tracking-wide">terminal</span>
        <span className={`h-2 w-2 rounded-full ${st.dot}`} />
        <span className="text-[11px] text-muted-foreground">{st.label}</span>
        {(showNote ? terminalNote!.title : run?.label) && (
          <span className="max-w-[200px] truncate text-[11px] text-muted-foreground">— {showNote ? terminalNote!.title : run?.label}</span>
        )}
        {run?.exitSummary && status !== "running" && (
          <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal text-muted-foreground">
            {run.exitSummary}
          </Badge>
        )}
        {run && status === "running" && run.steps.length > 0 && (
          <span className="text-[11px] text-muted-foreground">
            step {run.currentStepIndex + 1}/{run.steps.length}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {status === "running" && !sureStop && (
            <Button
              size="sm"
              variant="destructive"
              className="h-6 px-2 text-[11px]"
              onClick={() => (packageWork(run?.activity) ? setSureStop(packageWork(run?.activity)) : void stopRun())}
            >
              <Square className="mr-1 h-3 w-3" /> Stop
            </Button>
          )}
          {status === "running" && sureStop && (
            <span className="flex flex-wrap items-center gap-1.5 rounded border border-warn/50 bg-warn/10 px-2 py-0.5 text-[11px]">
              {sureStop} is changing your system: stopping it now can leave it half-done.
              <Button size="sm" variant="outline" className="h-5 px-1.5 text-[10px]" onClick={() => setSureStop(null)}>
                Let it finish
              </Button>
              <Button size="sm" variant="destructive" className="h-5 px-1.5 text-[10px]" onClick={() => (setSureStop(null), void stopRun())}>
                Stop anyway
              </Button>
            </span>
          )}
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={copy} title="Copy output">
            <Copy className="h-3 w-3" style={copied ? { color: "var(--ok)" } : undefined} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => useArch.setState({ run: null, terminalNote: null })}
            title="Clear"
          >
            <Eraser className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => setTerminalOpen(false)}
            title="Hide terminal"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {status === "running" && (
        <div className={`flex flex-wrap items-center gap-2 px-4 pb-1 text-[11px] ${run?.waitingPassword ? "text-amber-300" : "text-muted-foreground"}`}>
          <span className="font-mono">⏱ {elapsed}</span>
          {run?.waitingPassword ? (
            <span>waiting for your password — a small window should be open (it may be behind this one)</span>
          ) : run?.activity && run.activity.length > 0 ? (
            <span className="truncate">now: {run.activity.slice(0, 6).join(" · ")}</span>
          ) : (
            <span>working…</span>
          )}
        </div>
      )}
      <div
        ref={scrollRef}
        className="terminal-out max-h-64 min-h-[96px] overflow-y-auto px-4 pb-3 text-term-foreground"
      >
        {showNote ? (
          terminalNote!.text
        ) : run?.output ? (
          screen(run.output)
        ) : (
          <span className="text-muted-foreground">
            Output will stream here. Tip: Dry Run shows the composed script without executing.
          </span>
        )}
      </div>
    </div>
  );
}
