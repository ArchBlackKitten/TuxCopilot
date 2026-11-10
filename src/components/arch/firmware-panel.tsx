// Updates → Firmware: what fwupd offers for this computer's own parts, in plain words.
import { useCallback, useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { firmwareState, installCommand, listAge, partWords, REFRESH, REFRESH_DAILY, URGENCY_WORDS, type Firmware } from "@/lib/firmware";
import { useArch } from "./store";

export function FirmwarePanel() {
  const { runQuick, dryRun, machineVersion } = useArch();
  const [f, setF] = useState<Firmware | null>(null);
  const load = useCallback(() => void firmwareState().then(setF, () => setF(null)), []);
  useEffect(load, [load, machineVersion]);
  if (!f || !f.available) return null;
  const age = listAge(f);
  const run = (label: string, command: string) => void runQuick(label, command, dryRun).then(load);
  return (
    <section id="sec-firmware" className="scroll-mt-2 space-y-1.5 rounded-md border p-3 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <Cpu className="h-4 w-4 text-primary" />
        <h3 className="text-xs font-semibold">Firmware</h3>
        <span className="text-muted-foreground">— the computer's own parts: BIOS, Secure Boot's keys, the SSD (fwupd)</span>
      </div>
      <p className={age !== null && age > 30 ? "text-warn" : "text-muted-foreground"}>
        {age === null ? "fwupd has never fetched the list of updates." : `fwupd's list of updates is ${age} day${age === 1 ? "" : "s"} old.`}{" "}
        <button className="underline" onClick={() => run("Look for new firmware", REFRESH)}>
          Look for new ones
        </button>
        {!f.refreshTimer && (
          <>
            {" · "}
            <button className="underline" onClick={() => run("Look for firmware every day", REFRESH_DAILY)}>
              let fwupd look by itself
            </button>
          </>
        )}
      </p>
      {f.updates.length === 0 && <p className="text-ok">No firmware update offered.</p>}
      {f.updates.map((u) => (
        <div key={u.deviceId} className="flex flex-wrap items-start gap-2 border-t pt-1.5">
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{u.name}</span>
              <span className="font-mono text-muted-foreground">
                {u.current} → {u.version}
              </span>
              {u.urgency && <Badge variant="outline" className={`px-1 py-0 text-[9px] ${/high|critical/.test(u.urgency) ? "text-warn border-warn/40" : ""}`}>{URGENCY_WORDS[u.urgency] ?? u.urgency}</Badge>}
            </div>
            {u.summary && <p className="text-muted-foreground">{u.summary}</p>}
            <p className="text-muted-foreground">{partWords(u, f)}</p>
          </div>
          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => run(`Firmware: ${u.name} ${u.version}`, installCommand(u))}>
            Install
          </Button>
        </div>
      ))}
    </section>
  );
}
