// Security → Network → who talks to the internet now: each program and what it talks to.
import { useCallback, useEffect, useState } from "react";
import { Radio, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ALL_AS_ROOT, byProgram, connections, connWords, plainWeb, type Conn } from "@/lib/conns";
import { tuxPackage } from "@/lib/tux-own";
import { useArch } from "./store";
import { TuxTag } from "./tux-tag";

export function ConnsPanel() {
  const { runQuick, dryRun } = useArch();
  const [cs, setCs] = useState<Conn[] | null>(null);
  const load = useCallback(() => void connections().then(setCs, () => setCs(null)), []);
  useEffect(load, [load]);
  if (!cs) return null;
  const groups = byProgram(cs);
  const plain = plainWeb(cs);
  return (
    <section className="space-y-1.5 rounded-md border p-3 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <Radio className="h-4 w-4 text-primary" />
        <h3 className="text-xs font-semibold">Talking to other computers now</h3>
        <span className="text-muted-foreground">— by program; addresses only (looking up their names would ask the internet)</span>
        <Button size="sm" variant="ghost" className="ml-auto h-6 gap-1 px-2 text-[10px]" onClick={load}>
          <RefreshCw className="h-3 w-3" /> Look again
        </Button>
      </div>
      {cs.length === 0 && <p className="text-muted-foreground">Nothing is talking to another computer right now.</p>}
      {plain.length > 0 && <p className="text-warn">{plain.length} connection{plain.length === 1 ? " uses" : "s use"} plain web (not encrypted): anyone on the way can read it.</p>}
      {groups.map((g) => (
        <div key={g.program || "system"} className="border-t pt-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{g.program || "The system's own programs"}</span>
            {g.package && <span className="text-muted-foreground">({g.package})</span>}
            {g.package && tuxPackage(g.package) && <TuxTag why={tuxPackage(g.package)!} />}
            <Badge variant="outline" className="px-1 py-0 text-[9px]">{g.conns.length}</Badge>
          </div>
          {g.program === "" && (
            <p className="text-muted-foreground">
              Only root may see which programs these are.{" "}
              <button className="underline" onClick={() => void runQuick("Connections, with every program", ALL_AS_ROOT, dryRun)}>
                See them as root
              </button>
            </p>
          )}
          <ul className="ml-4 list-disc text-muted-foreground">
            {g.conns.slice(0, 8).map((c, i) => (
              <li key={i}>{connWords(c)}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
