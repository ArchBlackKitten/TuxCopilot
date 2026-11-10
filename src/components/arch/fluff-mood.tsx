// Fluff's mood (Home): one look at the whole system — Fluff's checkup, worst finding first.
// Calm when nothing needs you, unsure when something is waiting, worried when something failed.
// A click opens Troubleshoot, where each finding says what it means and how to fix it.
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { findings, mood, runCheckup, type Finding } from "@/lib/checkup";
import { iconUrl } from "@/lib/look-runtime";
import { servicesList } from "@/lib/services";
import { useArch } from "./store";

const SAYS = {
  calm: { line: "Fluff is calm", tone: "border-ok/40", dot: "bg-ok" },
  unsure: { line: "Fluff is unsure", tone: "border-warn/50", dot: "bg-warn" },
  worried: { line: "Fluff is worried", tone: "border-bad/50", dot: "bg-bad" },
} as const;

export function FluffMood() {
  const { setView, machineVersion } = useArch();
  const icon = useArch((s) => s.look.icon);
  const [f, setF] = useState<Finding[] | null>(null);

  useEffect(() => {
    let gone = false;
    void Promise.all([runCheckup(), servicesList().catch(() => null)])
      .then(([c, s]) => !gone && setF(findings(c, s)))
      .catch(() => !gone && setF(null));
    return () => {
      gone = true;
    };
  }, [machineVersion]);

  if (!f) return null;
  const m = mood(f);
  const look = f.filter((x) => x.level === "bad" || x.level === "warn");
  return (
    <button onClick={() => setView("troubleshoot")} className={`flex w-full items-center gap-3 rounded-md border bg-card p-2.5 text-left transition-colors hover:bg-accent/30 ${SAYS[m].tone}`} title="Open Troubleshoot: Fluff's checkup">
      <img src={iconUrl(icon)} alt="" className="h-9 w-9 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <span className={`h-2 w-2 rounded-full ${SAYS[m].dot}`} /> {SAYS[m].line}
        </div>
        <p className="truncate text-[11px] text-muted-foreground">
          {look.length === 0 ? "Nothing needs you right now." : `${look[0].title}${look.length > 1 ? ` — and ${look.length - 1} more` : ""}`}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
