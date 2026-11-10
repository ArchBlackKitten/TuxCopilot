// Settings → Window: the size TuxCopilot opens at. Like every setting it waits for Apply; it
// takes effect the next time TuxCopilot opens.
import { AppWindow } from "lucide-react";
import { Input } from "@/components/ui/input";
import { WINDOW_MODES } from "@/lib/window";
import { useArch } from "./store";

export function WindowPanel() {
  const { windowPref, setWindowPref } = useArch();
  const label = (id: string) => WINDOW_MODES.find((m) => m.id === id)!.label;
  const size = (k: "width" | "height", v: string) => {
    const n = Number(v.replace(/\D/g, "")) || 0;
    setWindowPref({ ...windowPref, mode: "custom", [k]: n }, `Opens at my own size`);
  };
  return (
    <section className="space-y-2 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2">
        <AppWindow className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Window</h2>
        <span className="text-[11px] text-muted-foreground">the size TuxCopilot opens at — from its next start</span>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {WINDOW_MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setWindowPref({ ...windowPref, mode: m.id }, `Opens ${label(m.id).toLowerCase()}`)}
            className={`rounded-md border px-2.5 py-1.5 text-left ${windowPref.mode === m.id ? "border-primary/60 bg-primary/10" : "hover:bg-accent/40"}`}
          >
            <div className="text-xs font-medium">{m.label}</div>
            <div className="text-[10px] text-muted-foreground">{m.note}</div>
          </button>
        ))}
      </div>
      {windowPref.mode === "custom" && (
        <div className="flex items-center gap-2 text-xs">
          <Input inputMode="numeric" className="h-7 w-20 text-xs" value={String(windowPref.width)} onChange={(e) => size("width", e.target.value)} aria-label="width" />
          ×
          <Input inputMode="numeric" className="h-7 w-20 text-xs" value={String(windowPref.height)} onChange={(e) => size("height", e.target.value)} aria-label="height" />
          <span className="text-[10px] text-muted-foreground">pixels; from 480 × 420 up</span>
        </div>
      )}
    </section>
  );
}
