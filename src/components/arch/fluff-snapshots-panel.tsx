// History: each change Fluff made to the system carries its snapshot pair (history.ts) —
// "What it changed" and "Undo this change", both shown first.
// Undo lists the files first, then asks: snapper puts back everything that changed between the
// two, not only Fluff's change.
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { errText } from "@/lib/host";
import { undoCommand, whatChangedCommand, type FluffSnapshot } from "@/lib/snapshot";
import { useArch } from "./store";

export function PairButtons({ pair, after }: { pair: FluffSnapshot; after: () => void }) {
  const { runQuick, dryRun } = useArch();
  const { toast } = useToast();
  const run = async (label: string, command: string) => {
    const err = await runQuick(label, command, dryRun);
    if (err) toast({ title: `Fluff couldn't finish: ${label}`, description: errText(err), variant: "destructive" });
    after();
    return err;
  };
  // the files it puts back, listed in the panel below, then "Are you sure?" for the undo itself
  const undo = async () => {
    if (await run(`What it changed: ${pair.label}`, whatChangedCommand(pair))) return;
    await run(`Undo: ${pair.label}`, undoCommand(pair));
  };
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => void run(`What it changed: ${pair.label}`, whatChangedCommand(pair))}>
        What it changed
      </Button>
      <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => void undo()}>
        Undo this change
      </Button>
    </span>
  );
}
