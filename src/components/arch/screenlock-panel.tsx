// Security: the screen lock — by itself, after sleep, how soon, the lid, the login screen.
import { useCallback, useEffect, useState } from "react";
import { MonitorSmartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lockFindings, screenLock, type ScreenLock } from "@/lib/screenlock";
import { useArch } from "./store";

export function ScreenLockPanel() {
  const { runQuick, dryRun, machineVersion } = useArch();
  const [s, setS] = useState<ScreenLock | null>(null);
  const load = useCallback(() => void screenLock().then(setS, () => setS(null)), []);
  useEffect(load, [load, machineVersion]);
  if (!s) return null;
  return (
    <div className="space-y-1 rounded-md border p-2 text-[11px]">
      <div className="flex items-center gap-2">
        <MonitorSmartphone className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium">The screen lock</span>
      </div>
      {lockFindings(s).map((f) => (
        <div key={f.text} className="flex flex-wrap items-center gap-2">
          <span className={f.level === "ok" ? "text-ok" : "text-warn"}>{f.level === "ok" ? "●" : "○"}</span>
          <span className="min-w-0 flex-1">{f.text}</span>
          {f.fix && (
            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => void runQuick(f.fix!.label, f.fix!.command, dryRun).then(load)}>
              {f.fix.label}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
