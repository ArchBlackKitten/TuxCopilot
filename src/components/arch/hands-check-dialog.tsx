// "Can you still type and click?" — type the word, then click the circle, before the time runs out;
// otherwise Fluff goes back by itself (hands-check.ts).
import { useEffect, useState } from "react";
import { Hand } from "lucide-react";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { secondsLeft, typedRight } from "@/lib/hands-check";
import { useArch } from "./store";

export function HandsCheckDialog() {
  const { handsCheck: h } = useArch();
  const [typed, setTyped] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setTyped("");
    if (!h) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [h]);
  if (!h) return null;
  const left = secondsLeft(h.deadline, now);
  const right = typedRight(typed, h.word);
  return (
    <AlertDialog open>
      <AlertDialogContent className="max-w-md" onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Hand className="h-5 w-5 text-primary" /> {h.title}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-xs text-foreground">
              <p>
                Type <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm font-semibold">{h.word}</span>, then click the circle.
              </p>
              <input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="w-full rounded-md border bg-background px-2 py-1 font-mono text-sm"
                aria-label="the word"
              />
              <div className="flex items-center justify-center py-2">
                <button
                  aria-label="the circle"
                  disabled={!right}
                  onClick={() => h.done(true)}
                  className={`h-14 w-14 rounded-full border-4 transition-colors ${right ? "border-primary bg-primary/20 hover:bg-primary/40" : "border-muted opacity-40"}`}
                />
              </div>
              <p className={left <= 10 ? "text-bad" : "text-muted-foreground"}>
                {left} s left. Not done by then, and Fluff goes back by itself: {h.what}.
              </p>
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-md bg-code p-2 font-mono text-[10px] text-term-foreground">{h.undo}</pre>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => h.done(false)}>
            Go back now
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
