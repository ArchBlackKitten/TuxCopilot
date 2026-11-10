// Security: who may control your keyboard and mouse — Allow / Ask / Block.
import { useCallback, useEffect, useState } from "react";
import { MousePointerClick } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { errText } from "@/lib/host";
import { runEnd } from "@/lib/api";
import { blockCosts, undoBlock, INPUT_MODES, inputControl, inputMode, inputModeCommand, LOCK_WORDS, locks, unfinished, XWAYLAND, type InputControl, type InputMode } from "@/lib/input-control";
import { useArch } from "./store";

export function InputControlPanel() {
  const { runQuick, dryRun, machineVersion, checkHands } = useArch();
  const { toast } = useToast();
  const [s, setS] = useState<InputControl | null>(null);
  const load = useCallback(() => void inputControl().then(setS, () => setS(null)), []);
  useEffect(load, [load, machineVersion]);
  if (!s) return null;
  const now = inputMode(s);
  const choose = async (to: InputMode) => {
    const label = `Keyboard and mouse control: ${INPUT_MODES.find((m) => m.id === to)!.label}`;
    const err = await runQuick(label, inputModeCommand(to, s), dryRun);
    if (err) toast({ title: `Fluff couldn't finish: ${label}`, description: errText(err), variant: "destructive" });
    else if (to === "block" && !dryRun && (await runEnd()).status === "success") {
      // the test: type the word and click the circle in time, or Fluff goes back by itself
      const back = now === "block" ? "ask" : now;
      await checkHands({
        title: "Can you still type and click?",
        what: `keyboard and mouse control goes back to ${INPUT_MODES.find((m) => m.id === back)!.label}`,
        undoLabel: `Keyboard and mouse control: back to ${INPUT_MODES.find((m) => m.id === back)!.label}`,
        undo: undoBlock(now, await inputControl()),
      });
    }
    load();
  };
  const costs = blockCosts(s);
  const toFinish = unfinished(s);
  return (
    <div className="space-y-1.5 rounded-md border p-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <MousePointerClick className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium">Programs controlling your keyboard and mouse</span>
        <span className="text-muted-foreground">(xdotool, ydotool, remote-control apps)</span>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-3">
        {INPUT_MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => (m.id !== now || (toFinish && m.id === "ask")) && void choose(m.id)}
            className={`rounded-md border px-2 py-1.5 text-left transition-colors ${now === m.id ? "border-primary/60 bg-primary/10" : "hover:bg-accent/40"}`}
          >
            <div className="flex items-center gap-1.5 font-medium">
              {m.label}
              {now === m.id && <Badge variant="outline" className="px-1 py-0 text-[9px]">now</Badge>}
              {m.id === "ask" && <Badge variant="outline" className="px-1 py-0 text-[9px] text-primary">Fluff recommends</Badge>}
              {m.id === "block" && <Badge variant="outline" className="px-1 py-0 text-[9px]">deny all</Badge>}
            </div>
            <div className="text-[10px] leading-relaxed text-muted-foreground">{m.what}</div>
          </button>
        ))}
      </div>
      <ul className="space-y-0.5">
        {locks(s).map((l) => (
          <li key={l.name} className="flex flex-wrap gap-x-1.5">
            <span className={l.state === "shut" ? "text-ok" : l.state === "open" ? "text-warn" : "text-muted-foreground"}>{l.state === "shut" ? "●" : "○"}</span>
            <span className="font-medium">{l.name}</span>
            <span className="text-muted-foreground">— {l.words}:</span>
            <span className={l.state === "shut" ? "text-ok" : l.state === "open" ? "text-warn" : ""}>{LOCK_WORDS[l.state]}</span>
          </li>
        ))}
      </ul>
      {toFinish && <p className="text-warn">Ask isn't finished: KWin's door hands out your keyboard and mouse with no window. Press Ask to shut it.</p>}
      {s.xtestForeign && <p className="text-warn">{XWAYLAND} is someone else's file, so Fluff leaves it alone and Block can't take XTEST away.</p>}
      {s.allowedApps.length > 0 && <p className="text-warn">Always allowed now, without asking: {s.allowedApps.join(", ")}. Ask and Block forget them.</p>}
      {s.uinputOpen && (
        <p className="text-muted-foreground">
          Right now any program of yours can type and click through /dev/uinput without a window{s.uinputGivers.length ? ` (opened by ${s.uinputGivers.join(", ")})` : ""}.
          {s.ydotoolOn ? " ydotool's service is on." : ""}
        </p>
      )}
      {costs.length > 0 && now !== "block" && <p className="text-warn">Block would mean: {costs.join("; ")}.</p>}
    </div>
  );
}
