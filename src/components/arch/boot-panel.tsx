// Updates: a way back if an update breaks starting (boot.ts).
import { useCallback, useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Info, LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { errText } from "@/lib/host";
import { bootFacts, bootFindings, howToChoose, LOADER_NAMES, menuCheckCommand, secondKernel, secondKernelCommand, type BootFacts } from "@/lib/boot";
import { useArch } from "./store";

const ICON = { ok: CircleCheck, warn: CircleAlert, info: Info };
const TONE = { ok: "text-ok", warn: "text-warn", info: "text-muted-foreground" };

export function BootPanel() {
  const { runQuick, dryRun, machineVersion } = useArch();
  const { toast } = useToast();
  const [f, setF] = useState<BootFacts | null | undefined>(undefined);
  const load = useCallback(() => void bootFacts().then(setF, () => setF(null)), []);
  useEffect(load, [load, machineVersion]);
  if (f === undefined) return null;
  const run = async (label: string, command: string) => {
    const err = await runQuick(label, command, dryRun);
    if (err) toast({ title: `Fluff couldn't finish: ${label}`, description: errText(err), variant: "destructive" });
    load();
  };
  const second = f && secondKernel(f);
  return (
    <section id="sec-boot" data-guide="way-back" className="scroll-mt-2 space-y-1.5 rounded-md border p-3 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <LifeBuoy className="h-4 w-4 text-primary" />
        <h3 className="text-xs font-semibold">A way back</h3>
        <span className="text-muted-foreground">— if an update ever stops the computer from starting</span>
      </div>
      {!f ? (
        <p className="text-muted-foreground">Fluff couldn't read the kernels (pacman didn't answer).</p>
      ) : (
        <>
          {bootFindings(f).map((x) => {
            const Icon = ICON[x.level];
            return (
              <div key={x.title} className="flex gap-1.5">
                <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${TONE[x.level]}`} />
                <div>
                  <span className="font-medium">{x.title}.</span> <span className="text-muted-foreground">{x.detail}</span>
                </div>
              </div>
            );
          })}
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">How to choose: </span>
            {howToChoose(f)}
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {second && (
              <Button size="sm" className="h-7 text-xs" onClick={() => void run(`A second kernel: ${second[0]}`, secondKernelCommand(f))}>
                Install {second[0]}
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void run(`Check the start menu (${LOADER_NAMES[f.loader]})`, menuCheckCommand(f))}>
              Check the start menu
            </Button>
            <span className="self-center text-[10px] text-muted-foreground">It sits where only root may read, so it asks for your password: Fluff reads its names only.</span>
          </div>
        </>
      )}
    </section>
  );
}
