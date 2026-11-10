// "Are you sure?" — asked before every live run, as many times as Settings says (default 2).
// Each round reads differently so the second is not mistaken for the first. The commands are
// editable here: what you leave in the boxes is what runs (a step is never added, dropped or
// left empty), and a command you changed says so, with Fluff's version a click away.
import { useState } from "react";
import { Undo2 } from "lucide-react";
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
import { useArch, type PendingConfirm } from "./store";

const HEADINGS = [
  "Are you sure?",
  "Are you really sure?",
  "Last chance — still sure?",
  "Absolutely sure?",
  "Final answer?",
];

export function ConfirmRunDialog() {
  const pending = useArch((s) => s.pendingConfirm);
  if (!pending) return null;
  // keyed by round: each prompt is a fresh dialog with the commands as they stand
  return <Prompt key={`${pending.title}-${pending.round}`} pending={pending} />;
}

function Prompt({ pending }: { pending: PendingConfirm }) {
  const { title, commands, suggested, round, rounds, answer, notes = [] } = pending;
  const [edit, setEdit] = useState(commands);
  const usesSudo = edit.some((c) => /(^|[\s;&|(])sudo\s/.test(c));
  const changed = edit.map((c, i) => c.trim() !== (suggested[i] ?? "").trim());
  const empty = edit.some((c) => !c.trim());

  return (
    // a fresh dialog per round, so a late close event from one round can never answer the next
    <AlertDialog open onOpenChange={(o) => !o && answer(false)}>
      <AlertDialogContent className="bg-card">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {HEADINGS[Math.min(round, HEADINGS.length) - 1]}
            {rounds > 1 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({round} of {rounds})
              </span>
            )}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-xs">
            <span className="font-medium text-foreground">{title}</span> will run for real on this computer
            {usesSudo ? ", with administrator rights" : ""}:
          </AlertDialogDescription>
        </AlertDialogHeader>
        {notes.length > 0 && (
          <div className="space-y-0.5 rounded-md border border-warn/40 bg-warn/5 px-2 py-1 text-[11px] text-warn">
            {notes.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </div>
        )}
        <div className="max-h-64 space-y-1.5 overflow-auto">
          {edit.map((c, i) => (
            <div key={i}>
              <div className="flex items-start gap-1.5 rounded-md border bg-background px-2 py-1">
                <span className="select-none pt-px font-mono text-[11px] text-muted-foreground">$</span>
                <textarea
                  value={c}
                  onChange={(e) => setEdit((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))}
                  rows={Math.min(6, Math.max(1, Math.ceil(c.length / 70), c.split("\n").length))}
                  spellCheck={false}
                  aria-label={`command ${i + 1}`}
                  className="min-w-0 flex-1 resize-none bg-transparent font-mono text-[11px] leading-relaxed outline-none"
                />
              </div>
              {changed[i] && (
                <div className="flex items-center gap-2 px-1 text-[10px] text-warn">
                  {c.trim() ? "Changed by you: Fluff checked its own version, not this one." : "Empty: write a command, or cancel."}
                  <button className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => setEdit((xs) => xs.map((x, j) => (j === i ? suggested[i] : x)))}>
                    <Undo2 className="h-3 w-3" /> Fluff's version
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">You can change a command before it runs: what is in the boxes is what runs.</p>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => answer(false)}>No, cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={empty}
            onClick={() => answer(true, edit.map((c) => c.trim()))}
          >
            {round < rounds ? "Yes, continue" : "Yes, run it"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
