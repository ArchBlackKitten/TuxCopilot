// Security: USBGuard — new USB devices blocked until you allow them (BadUSB).
import { useCallback, useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { runEnd } from "@/lib/api";
import { errText } from "@/lib/host";
import { allowCommand, deviceSays, switchOn, USBGUARD_AT_BOOT, USBGUARD_OFF, usbguardState, type UsbDevice, type UsbGuard } from "@/lib/usbguard";
import { useArch } from "./store";

export function UsbGuardPanel() {
  const { runQuick, dryRun, machineVersion, checkHands } = useArch();
  const { toast } = useToast();
  const [g, setG] = useState<UsbGuard | null>(null);
  const load = useCallback(() => void usbguardState().then(setG, () => setG(null)), []);
  useEffect(load, [load, machineVersion]);
  if (!g) return null;
  const run = async (label: string, command: string) => {
    const err = await runQuick(label, command, dryRun);
    if (err) toast({ title: `Fluff couldn't finish: ${label}`, description: errText(err), variant: "destructive" });
    return err;
  };
  const on = async () => {
    await switchOn(g, { run, runEnd, state: () => usbguardState().catch(() => null), checkHands, dryRun });
    load();
  };
  const state = !g.installed ? "off — not installed" : !g.active ? "off" : g.enabled ? "on" : "on until the next restart";
  return (
    <div className="space-y-1.5 rounded-md border p-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldAlert className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium">New USB devices (USBGuard)</span>
        <Badge variant="outline" className={`px-1 py-0 text-[9px] ${g.active ? "text-ok" : ""}`}>{state}</Badge>
      </div>
      <p className="text-muted-foreground">
        A USB stick can pretend to be a keyboard (a “BadUSB”) and type commands faster than you can see. With USBGuard on, any USB device that wasn't plugged in
        when you switched it on is blocked until you allow it here — your keyboard, mouse and everything plugged in now keep working.
        {!g.installed && " Switching it on installs USBGuard (the whole system is updated first)."}
      </p>
      <p className="text-muted-foreground">
        Switching on can't lock you out: it starts for now only, then Fluff asks you to type a word and click a circle; not done in time, and Fluff switches it off by itself.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {!g.active && (
          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => void on()}>
            Switch it on
          </Button>
        )}
        {g.active && !g.enabled && (
          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => void run("USBGuard: at every start", USBGUARD_AT_BOOT).then(load)}>
            At every start too
          </Button>
        )}
        {g.installed && (g.active || g.enabled) && (
          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => void run("USBGuard: off", USBGUARD_OFF).then(load)}>
            Switch it off
          </Button>
        )}
      </div>
      {g.active && g.blocked === null && <p className="text-warn">Fluff can't see what USBGuard blocked (it gives your account "list only" when Fluff switches it on).</p>}
      {g.blocked?.map((d) => (
        <Blocked key={d.number} d={d} run={run} load={load} />
      ))}
      {g.blocked?.length === 0 && <p className="text-muted-foreground">Nothing blocked right now.</p>}
    </div>
  );
}

function Blocked({ d, run, load }: { d: UsbDevice; run: (l: string, c: string) => Promise<string | null>; load: () => void }) {
  const says = deviceSays(d);
  return (
    <div className="flex flex-wrap items-start gap-2 border-t pt-1.5">
      <div className="min-w-0 flex-1">
        <div>
          <span className="font-medium">Blocked: {d.name || "a USB device"}</span> <span className="font-mono text-muted-foreground">{d.id}</span>
          {d.port && <span className="text-muted-foreground"> (port {d.port})</span>}
        </div>
        <p className="text-muted-foreground">It says it is: {says.kinds.join(", ") || "nothing"}.</p>
        {says.warn && <p className="text-warn">{says.warn}</p>}
      </div>
      <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => void run(`USBGuard: let in ${d.name || d.id} until unplugged`, allowCommand(d, false)).then(load)}>
        Allow once
      </Button>
      <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => void run(`USBGuard: always let in ${d.name || d.id}`, allowCommand(d, true)).then(load)}>
        Always allow
      </Button>
    </div>
  );
}
