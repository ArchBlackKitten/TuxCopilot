// Settings → Fluff's brain: Ask Fluff answers with a model Ollama runs on this computer.
// Off until you choose one; it waits for Apply like every setting. Nothing leaves the computer.
import { useEffect } from "react";
import { Brain as BrainIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useArch } from "./store";

export function BrainPanel() {
  const { brain, setBrain, ollama, loadOllama, setView } = useArch();
  useEffect(() => {
    if (!ollama) void loadOllama();
  }, [ollama, loadOllama]);

  const models = ollama?.models ?? [];
  const chosenGone = brain.model !== null && ollama !== null && !models.some((m) => m.name === brain.model);
  const turn = (on: boolean) => {
    const model = brain.model ?? models[0]?.name ?? null;
    setBrain({ on: on && model !== null, model }, on ? `Ask Fluff: on, with ${model}` : "Ask Fluff: off");
  };
  const choose = (model: string) => setBrain({ on: true, model }, `Ask Fluff uses ${model}`);

  return (
    <section className="space-y-2 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2">
        <BrainIcon className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Fluff's brain</h2>
        <span className="text-[11px] text-muted-foreground">Ask Fluff answers with a local model (Ollama) — nothing leaves this computer</span>
        <Switch className="ml-auto" checked={brain.on} disabled={!models.length} onCheckedChange={turn} aria-label="Ask Fluff on or off" />
      </div>

      {ollama === null ? (
        <p className="text-[11px] text-muted-foreground">Fluff is looking for Ollama…</p>
      ) : !ollama.available ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-muted-foreground">Ollama isn't installed. It runs AI models on your own computer; the Ollama section installs it.</span>
          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => setView("ollama")}>
            Open Ollama
          </Button>
        </div>
      ) : !ollama.serverUp ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-muted-foreground">Ollama is installed but not running, so Fluff can't see its models.</span>
          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => setView("ollama")}>
            Start it in Ollama
          </Button>
        </div>
      ) : !models.length ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-muted-foreground">No model yet. The Ollama section recommends ones that fit this computer.</span>
          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => setView("ollama")}>
            Pick one in Ollama
          </Button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <label className="flex flex-wrap items-center gap-2 text-xs">
            Model
            <select
              value={brain.model ?? ""}
              onChange={(e) => choose(e.target.value)}
              className="h-7 min-w-0 flex-1 rounded-md border bg-popover px-2 text-xs text-popover-foreground"
              aria-label="Ask Fluff's model"
            >
              {brain.model === null && <option value="">Choose a model…</option>}
              {chosenGone && <option value={brain.model!}>{brain.model} (not installed any more)</option>}
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name} {m.sizeRaw ? `· ${m.sizeRaw}` : ""}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[10px] text-muted-foreground">
            {brain.on && brain.model
              ? `Ask Fluff (top bar) answers with ${brain.model}. A bigger model answers better and slower; the Ollama section says which fit this computer.`
              : "Switch it on and Ask Fluff (top bar) answers questions about your computer."}{" "}
            Fluff only suggests: every command it gives can be explained or copied, and runs only if you run it.
          </p>
          {chosenGone && <p className="text-[10px] text-warn">{brain.model} isn't installed any more: choose another, or pull it again in Ollama.</p>}
        </div>
      )}
    </section>
  );
}
