// "Fluff won't run this one": a command that would wreck the system (wreck.rs) is never run by
// Fluff. The window says what it does and why you must not run it; if you still want to, you copy
// it and run it yourself.
import { Copy, ShieldX } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useArch } from "./store";

export function WreckDialog() {
  const { wreck, closeWreck } = useArch();
  const { toast } = useToast();
  if (!wreck) return null;
  const copy = () => {
    void navigator.clipboard.writeText(wreck.command);
    toast({ title: "Fluff copied it", description: "If you run it, you run it yourself. Read it twice first." });
  };
  return (
    <AlertDialog open onOpenChange={(o) => !o && closeWreck()}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldX className="h-5 w-5 text-bad" /> Fluff won't run this one
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-xs text-foreground">
              <p>
                <span className="font-medium">What it does:</span> {wreck.what}.
              </p>
              <p>
                <span className="font-medium">Why you must not run it:</span> {wreck.why}.
              </p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-code p-2 font-mono text-[11px] text-term-foreground">{wreck.command}</pre>
              {wreck.part !== wreck.command && (
                <p className="text-[11px] text-muted-foreground">
                  The part that does it: <code className="font-mono">{wreck.part}</code>
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                If you are really sure, copy it and run it in a terminal yourself — Fluff won't. (Fluff does not support terrorism.)
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={copy}>
            <Copy className="h-3 w-3" /> Copy it
          </Button>
          <AlertDialogAction onClick={closeWreck}>Don't run it</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
