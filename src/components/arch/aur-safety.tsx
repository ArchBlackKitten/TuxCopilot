// Before yay builds AUR packages: what stands out about each one (orphaned, brand new, gone
// from the AUR, flagged out of date, few votes), from the AUR's own facts. Only the ones that
// stand out are listed; each links to its AUR page.
import { useEffect, useState } from "react";
import { ExternalLink, ShieldAlert } from "lucide-react";
import { openExternal } from "@/lib/host";
import { aurSafety, type AurLook } from "@/lib/updates";

export function AurSafety({ names }: { names: string[] }) {
  const [looks, setLooks] = useState<AurLook[] | null | undefined>(undefined);
  const key = names.join(" ");
  useEffect(() => {
    let gone = false;
    setLooks(undefined);
    void aurSafety(key ? key.split(" ") : []).then((l) => !gone && setLooks(l));
    return () => {
      gone = true;
    };
  }, [key]);

  if (!names.length || looks === undefined) return null;
  if (looks === null) return <p className="text-[10px] text-muted-foreground">Fluff couldn't ask the AUR about these (no network?): look at each one's AUR page before installing.</p>;
  const stand = looks.filter((l) => l.level !== "ok");
  if (!stand.length) return <p className="text-[10px] text-muted-foreground">Fluff asked the AUR: nothing stands out about these {looks.length}.</p>;
  return (
    <div className="space-y-1 rounded-md border border-warn/40 bg-warn/5 p-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium">
        <ShieldAlert className="h-3.5 w-3.5 text-warn" /> Fluff recommends a closer look at {stand.length === 1 ? "this one" : `these ${stand.length}`}
      </div>
      {stand.map((l) => (
        <div key={l.name} className="flex flex-wrap items-baseline gap-2 text-[10px]">
          <span className={`font-mono ${l.level === "careful" ? "text-warn" : ""}`}>{l.name}</span>
          <span className="min-w-0 flex-1 text-muted-foreground">{l.why.join("; ")}</span>
          <button className="flex items-center gap-0.5 text-primary hover:underline" onClick={() => void openExternal(l.page)}>
            <ExternalLink className="h-2.5 w-2.5" /> AUR page
          </button>
        </div>
      ))}
    </div>
  );
}
