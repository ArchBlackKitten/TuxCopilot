// Ports (its own section): every port in use on this machine and who holds it, a "is this port
// free?" box, and PortHint — the warning any port box in the app shows while you type.
import { useCallback, useEffect, useState } from "react";
import { CircleCheck, CircleX, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TuxTag } from "./tux-tag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  KNOWN_PORTS, criticalUnit, keepOnCommand, listPorts, nearestFree, notAtBoot, ownerOf, portCommand, portOnCommand, portRecords, portState,
  takenBy, unitFamily, validPort, type PortUse, type UnitFamily,
  tuxcopilotRole,
  ownProcesses,
} from "@/lib/ports";
import { readText } from "@/lib/host";
import { CONF } from "@/lib/tor";
import { useArch } from "./store";
import type { Target } from "@/lib/changes";
import { AppLink } from "./app-link";
import { ThreeState, type Three } from "./three-state";
import { openExternal } from "@/lib/host";

/** The port number: a click opens http://localhost:<port> in your browser (TCP only). */
function PortNumber({ p, className = "" }: { p: PortUse; className?: string }) {
  if (p.proto !== "tcp") return <span className={`font-mono ${className}`}>{p.port}</span>;
  return (
    <button
      className={`font-mono underline-offset-2 hover:text-primary hover:underline ${className}`}
      title={`open http://localhost:${p.port} in your browser`}
      onClick={() => void openExternal(`http://localhost:${p.port}`)}
    >
      {p.port}
    </button>
  );
}
import { protectedReason } from "@/lib/protected";
// one lookup per service, shared by its tag and its switch
const families = new Map<string, Promise<UnitFamily | null>>();
function useUnitFamily(service: string | null): UnitFamily | null {
  const { machineVersion } = useArch();
  const [fam, setFam] = useState<UnitFamily | null>(null);
  useEffect(() => {
    if (!service) return;
    const key = `${service}:${machineVersion}`;
    if (!families.has(key)) families.set(key, unitFamily(service).catch(() => null));
    void families.get(key)!.then(setFam);
  }, [service, machineVersion]);
  return fam;
}

/**
 * "System" = base software the machine needs to run: a service the
 * machine can't run without, or one from a package of the learned core system. Not a service
 * you installed for yourself — Tor, Docker, a printer service are apps you chose.
 */
export function portSystemTag(p: PortUse, pkg: string | null): string | null {
  if (!p.service || p.program || p.container) return null;
  const why = criticalUnit(p.service) ?? (pkg ? protectedReason(pkg) : null);
  return why ? `part of your system: ${why}` : null;
}

export function SystemTag({ p }: { p: PortUse }) {
  const fam = useUnitFamily(p.service && !p.program ? p.service : null);
  const reason = portSystemTag(p, fam?.package ?? null);
  if (!reason) return null;
  return (
    <Badge variant="outline" className="shrink-0 border-sky-500/50 px-1 py-0 text-[9px] text-sky-300" title={reason}>
      System
    </Badge>
  );
}

/**
 * The switch for one port. A system service: Off / On for the service with what starts it on
 * demand (waits for Apply; locked for what the system needs), and "keep it on after
 * restarts" when it runs but would not start again. Your own program: End. A Docker
 * container: Stop.
 */
export function PortSwitch({ p }: { p: PortUse }) {
  const { stageSystem, machineVersion, history } = useArch();
  const { toast } = useToast();
  const fam = useUnitFamily(p.service && !p.program ? p.service : null);
  const stage = (label: string, command: string, target?: Target) => {
    const before = useArch.getState().history;
    stageSystem(label, command, undefined, target);
    const after = useArch.getState().history;
    if (after === before) return; // already waiting
    if (after.pending.length < before.pending.length) toast({ title: "Back to how it is — nothing waits", description: `${label}: that's how it is now, so Fluff took back the change that waited.` });
    else toast({ title: `${label} — pending`, description: "Apply (top bar) to do it, or Undo." });
  };
  if (p.container) {
    return (
      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => stage(`Stop container ${p.container}`, `docker stop ${p.container}`, { id: `container:${p.container}`, to: "stopped" })}>
        Stop
      </Button>
    );
  }
  if (p.program && p.pid) {
    return (
      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" title={`kill ${p.pid}`} onClick={() => stage(`End ${p.program} (pid ${p.pid})`, `kill ${p.pid}`, { id: `pid:${p.pid}`, to: "ended" })}>
        End
      </Button>
    );
  }
  if (!p.service) return null;
  const critical = criticalUnit(p.service);
  if (critical) {
    return (
      <span className="text-[10px] text-muted-foreground" title={critical}>locked</span>
    );
  }
  if (!fam) return <span className="text-[10px] text-muted-foreground">…</span>;
  const st = portState(fam);
  const pending = history.pending.some((c) => c.kind === "system" && c.label.startsWith(`${p.service}:`));
  const pick = (to: Three) =>
    stage(`${p.service}: make it ${to === "on" ? "On" : to === "off" ? "Off" : "Dead"}`, portCommand(p.service!, fam, p.port, to), { id: `unit:${p.service}`, to, from: st });
  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      {notAtBoot(fam) && (
        <button
          className="text-[10px] text-amber-300 underline"
          title={keepOnCommand(fam)}
          onClick={() => stage(`Keep ${p.service} on after restarts`, keepOnCommand(fam), { id: `unit.boot:${p.service}`, to: "on" })}
        >
          won't start after a restart — keep it on
        </button>
      )}
      {fam.package && <AppLink name={fam.package} className="text-[10px] text-muted-foreground" />}
      <ThreeState value={st} onPick={pick} pending={pending} size="xs" />
    </span>
  );
}

/** Ports TuxCopilot switched off: they no longer listen, so they are listed here to turn back on. */
function SwitchedOff() {
  const { stageSystem, machineVersion } = useArch();
  const [recs, setRecs] = useState<Array<[string, string]>>([]);
  useEffect(() => {
    portRecords().then(setRecs, () => setRecs([]));
  }, [machineVersion]);
  if (!recs.length) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-dashed">
      {recs.map(([unit, rec]) => (
        <div key={unit} className="flex items-center gap-2 px-3 py-1.5 text-xs">
          <span className="font-mono">{rec.match(/^port (\d+)/m)?.[1] ?? "?"}</span>
          <span className="min-w-0 flex-1 truncate">{unit.replace(/\.service$/, "")} <span className="text-[10px] text-muted-foreground">switched off by TuxCopilot</span></span>
          <ThreeState
            value="dead"
            size="xs"
            unavailable={{ off: "open its package's page to bring back only its start at restart" }}
            onPick={() => stageSystem(`${unit}: make it On`, portOnCommand(unit, null), undefined, { id: `unit:${unit}`, to: "on", from: "dead" })}
          />
        </div>
      ))}
    </div>
  );
}

/** The ports in use, read again every few seconds while something shows them. */
export function usePorts(everyMs = 5000) {
  const { machineVersion } = useArch();
  const [ports, setPorts] = useState<PortUse[] | null>(null);
  const load = useCallback(() => listPorts().then(setPorts, () => setPorts([])), []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), everyMs);
    return () => clearInterval(t);
  }, [load, everyMs, machineVersion]);
  return { ports, reload: load };
}

/**
 * Under a port box: says while you type whether the port is free, or who holds it.
 * `mine`: holders that are the thing being configured itself (no warning for them).
 */
export function PortHint({ port, mine }: { port: number; mine?: (p: PortUse) => boolean }) {
  const { ports } = usePorts();
  if (!ports || !validPort(port)) return null;
  const holder = takenBy(ports, port);
  if (!holder) return <span className="text-[10px] text-emerald-400">port {port} is free</span>;
  if (mine?.(holder)) return <span className="text-[10px] text-muted-foreground">port {port} is this one's own</span>;
  const free = nearestFree(ports, port + 1);
  return (
    <span className="text-[10px] text-amber-300">
      port {port} is taken by {ownerOf(holder)}
      {holder.pid ? ` (pid ${holder.pid})` : ""}
      {free ? ` — ${free} is free` : ""}
    </span>
  );
}

export function PortsPanel() {
  const { ports, reload } = usePorts();
  const [ask, setAsk] = useState("");
  const [udp, setUdp] = useState(false);
  const n = Number(ask);
  const asked = ask.trim() !== "" && validPort(n);
  const holder = asked && ports ? takenBy(ports, n) : null;
  const shown = (ports ?? []).filter((p) => udp || p.proto === "tcp");
  // TuxCopilot's own Tor file: the ports it sets carry TuxCopilot's tag
  const [torConf, setTorConf] = useState<string | null>(null);
  useEffect(() => {
    readText(CONF).then(setTorConf, () => setTorConf(null));
  }, [ports?.length]);
  // and TuxCopilot's own processes (itself, its dev preview), known by what they are
  const [own, setOwn] = useState<Map<number, string>>(new Map());
  const pids = [...new Set((ports ?? []).map((p) => p.pid).filter((x): x is number => x !== null))].sort((a, b) => a - b).join(",");
  useEffect(() => {
    if (!pids) return setOwn(new Map());
    ownProcesses(pids.split(",").map(Number)).then(setOwn, () => setOwn(new Map()));
  }, [pids]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
        <span className="text-xs font-medium">Is a port free?</span>
        <Input
          className="h-7 w-28 font-mono text-xs"
          inputMode="numeric"
          placeholder="e.g. 8080"
          value={ask}
          onChange={(e) => setAsk(e.target.value.replace(/\D/g, "").slice(0, 5))}
        />
        {asked && ports && (
          holder ? (
            <span className="flex items-center gap-1 text-xs text-amber-300">
              <CircleX className="h-3.5 w-3.5" /> taken by {ownerOf(holder)}
              {holder.pid ? ` (pid ${holder.pid})` : ""} · {holder.reach}
              {nearestFree(ports, n + 1) ? ` — ${nearestFree(ports, n + 1)} is free` : ""}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <CircleCheck className="h-3.5 w-3.5" /> {n} is free{n < 1024 ? " (below 1024 only system services may use it)" : ""}
            </span>
          )
        )}
        {ask.trim() !== "" && !validPort(n) && <span className="text-xs text-muted-foreground">a number from 1 to 65535</span>}
        <div className="flex items-center gap-1 sm:ml-auto">
          <button
            onClick={() => setUdp(!udp)}
            className={`rounded-md border px-2 py-1 text-[11px] ${udp ? "border-primary/50 bg-primary/10 text-primary" : "text-muted-foreground"}`}
          >
            {udp ? "TCP + UDP" : "TCP only"}
          </button>
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => void reload()}>
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
        </div>
      </div>

      {!ports ? (
        <Skeleton className="h-32" />
      ) : shown.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">No port is in use.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div className="grid grid-cols-[4.5rem_1fr_auto] gap-2 border-b bg-muted/40 px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground sm:grid-cols-[4.5rem_1fr_9rem_8rem]">
            <span>port</span>
            <span>taken by</span>
            <span className="hidden sm:block">reachable from</span>
            <span>process</span>
          </div>
          {shown.map((p, i) => (
            <div key={`${p.proto}-${p.address}-${p.port}-${i}`} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2 border-b px-3 py-1.5 last:border-b-0 sm:grid-cols-[4.5rem_1fr_9rem_8rem]">
              <span className="text-xs">
                <PortNumber p={p} />
                {p.proto === "udp" && <span className="ml-1 text-[9px] text-muted-foreground">udp</span>}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 truncate text-xs">
                  {ownerOf(p)} <SystemTag p={p} />
                  {tuxcopilotRole(p, torConf, own) && <TuxTag why={tuxcopilotRole(p, torConf, own)!} />}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {[KNOWN_PORTS[p.port], p.service && p.program ? p.service : null, p.user && p.user !== "root" && !p.program ? `user ${p.user}` : null]
                    .filter(Boolean)
                    .join(" · ") || " "}
                </span>
              </span>
              <span className="hidden sm:block">
                <Badge variant="outline" className={`px-1 py-0 text-[9px] ${p.reach === "your network" ? "text-amber-300" : "text-muted-foreground"}`}>
                  {p.reach}
                </Badge>
              </span>
              <span className="flex items-center justify-end gap-2">
                <span className="hidden font-mono text-[10px] text-muted-foreground lg:inline">{p.pid ? `pid ${p.pid}` : p.service ? "service" : "—"}</span>
                <PortSwitch p={p} />
              </span>
            </div>
          ))}
        </div>
      )}
      <SwitchedOff />
      <p className="text-[10px] text-muted-foreground">
        “this computer” = only programs on this machine can connect; “your network” = other devices on your network can too.
        System programs show the service they run in; their process ids need a password to read, so they are not shown.
      </p>
    </div>
  );
}

/** Home: the ports in use at a glance, and the "is it free?" box. */
export function PortsWidget() {
  const { ports } = usePorts();
  const { setView } = useArch();
  const [ask, setAsk] = useState("");
  const n = Number(ask);
  const tcp = (ports ?? []).filter((p) => p.proto === "tcp");
  const seen = new Set<number>();
  const unique = tcp.filter((p) => (seen.has(p.port) ? false : (seen.add(p.port), true)));
  return (
    <section className="rounded-md border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Localhost ports</span>
        <span className="text-[11px] text-muted-foreground">{ports ? `${unique.length} taken` : "reading…"}</span>
        <Input
          className="ml-auto h-7 w-36 font-mono text-xs"
          inputMode="numeric"
          placeholder="is a port free?"
          value={ask}
          onChange={(e) => setAsk(e.target.value.replace(/\D/g, "").slice(0, 5))}
        />
      </div>
      {ask && validPort(n) && (
        <div className="mb-2">
          <PortHint port={n} />
        </div>
      )}
      {!ports ? (
        <Skeleton className="h-16" />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {unique.map((p) => (
            <div key={p.port} className="flex w-full items-center gap-2 text-[11px]" title={`${p.reach}${p.pid ? ` · pid ${p.pid}` : ""}${KNOWN_PORTS[p.port] ? ` · usually ${KNOWN_PORTS[p.port]}` : ""}`}>
              <PortNumber p={p} className="w-12 text-left" />
              <span className="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground">
                <span className="truncate">
                  {ownerOf(p)}
                  {KNOWN_PORTS[p.port] ? ` · ${KNOWN_PORTS[p.port]}` : ""}
                </span>
                <SystemTag p={p} />
              </span>
              <PortSwitch p={p} />
            </div>
          ))}
          <SwitchedOff />
        </div>
      )}
      <button className="mt-2 text-[10px] text-muted-foreground underline" onClick={() => setView("ports")}>
        every port, with process ids and who can reach it → Ports
      </button>
    </section>
  );
}
