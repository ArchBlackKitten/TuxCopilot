// Security: USB sticks, USB disks and SD cards — Allow / Ask / Block.
import { useCallback, useEffect, useState } from "react";
import { Usb } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { errText } from "@/lib/host";
import { STORAGE_MODES, storageControl, storageMode, storageModeCommand, storageNotes, type StorageControl, type StorageMode } from "@/lib/storage-control";
import { useArch } from "./store";

export function StorageControlPanel() {
  const { runQuick, dryRun, machineVersion } = useArch();
  const { toast } = useToast();
  const [s, setS] = useState<StorageControl | null>(null);
  const load = useCallback(() => void storageControl().then(setS, () => setS(null)), []);
  useEffect(load, [load, machineVersion]);
  if (!s) return null;
  const now = storageMode(s);
  const choose = async (to: StorageMode) => {
    const label = `USB sticks and SD cards: ${STORAGE_MODES.find((m) => m.id === to)!.label}`;
    let command: string;
    try {
      command = storageModeCommand(to, s);
    } catch (e) {
      return toast({ title: "Fluff didn't run it", description: errText(e), variant: "destructive" });
    }
    const err = await runQuick(label, command, dryRun);
    if (err) toast({ title: `Fluff couldn't finish: ${label}`, description: errText(err), variant: "destructive" });
    load();
  };
  return (
    <div className="space-y-1.5 rounded-md border p-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <Usb className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium">USB sticks, USB disks and SD cards</span>
        <span className="text-muted-foreground">(what you plug in to read or copy files)</span>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-3">
        {STORAGE_MODES.map((m) => {
          const off = m.id === "block" && s.systemRemovable;
          return (
            <button
              key={m.id}
              disabled={off}
              onClick={() => m.id !== now && void choose(m.id)}
              className={`rounded-md border px-2 py-1.5 text-left transition-colors disabled:opacity-50 ${now === m.id ? "border-primary/60 bg-primary/10" : "hover:bg-accent/40"}`}
            >
              <div className="flex items-center gap-1.5 font-medium">
                {m.label}
                {now === m.id && <Badge variant="outline" className="px-1 py-0 text-[9px]">now</Badge>}
                {m.id === "ask" && <Badge variant="outline" className="px-1 py-0 text-[9px] text-primary">Fluff recommends</Badge>}
              </div>
              <div className="text-[10px] leading-relaxed text-muted-foreground">{m.what}</div>
            </button>
          );
        })}
      </div>
      {storageNotes(s).map((n) => (
        <p key={n} className="text-warn">{n}</p>
      ))}
      <p className="text-muted-foreground">
        A stick that pretends to be a keyboard (a “BadUSB”) is a different danger: USBGuard, just below, stops that.
      </p>
    </div>
  );
}
