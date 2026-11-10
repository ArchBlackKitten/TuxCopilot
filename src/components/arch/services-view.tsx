// The Services section: every systemd service of the system and of your user, in plain states,
// with On / Off / Kill (a killed one reads "Dead") and its log. Each button shows its command
// in "Are you sure?" and runs in the terminal; Fluff speaks up for what failed or was killed,
// and keeps the services your computer needs out of reach.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Cog, FileText, Power, PowerOff, RefreshCw, Search, Skull } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { unitLog } from "@/lib/app-details";
import { STATE_WORDS, buttons, fluffSays, killCommand, offCommand, onCommand, protectedWhy, servicesList, type Service, type ServiceState } from "@/lib/services";
import { FluffSays } from "./fluff-says";
import { TuxTag } from "./tux-tag";
import { tuxUnit } from "@/lib/tux-own";
import { useArch } from "./store";

const ORDER: ServiceState[] = ["failed", "dead", "running", "dormant", "ran once", "off", "on demand", "never started", "blocked"];
const LABEL: Record<ServiceState, string> = {
  failed: "Failed",
  dead: "Dead",
  running: "Running",
  dormant: "Dormant",
  "ran once": "Ran once",
  off: "Off",
  "on demand": "On demand",
  "never started": "Never started",
  blocked: "Blocked",
};
const TONE: Record<ServiceState, string> = {
  failed: "text-bad border-bad/40",
  dead: "text-bad border-bad/40",
  running: "text-ok border-ok/40",
  dormant: "text-info border-info/40",
  "ran once": "text-muted-foreground",
  off: "text-muted-foreground",
  "on demand": "text-muted-foreground",
  "never started": "text-muted-foreground",
  blocked: "text-warn border-warn/40",
};

export function ServicesView() {
  const { runQuick, dryRun, machineVersion } = useArch();
  const { toast } = useToast();
  const [all, setAll] = useState<Service[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState<ServiceState | "all">("all");
  const [whose, setWhose] = useState<"system" | "user">("system");
  const [find, setFind] = useState("");
  const [log, setLog] = useState<{ name: string; text: string | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAll(await servicesList());
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load, machineVersion]);

  const mine = useMemo(() => (all ?? []).filter((s) => (whose === "user") === s.user), [all, whose]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(ORDER.map((s) => [s, 0])) as Record<ServiceState, number>;
    for (const s of mine) c[s.state]++;
    return c;
  }, [mine]);
  const shown = useMemo(() => {
    const f = find.trim().toLowerCase();
    return mine
      .filter((s) => (show === "all" ? true : s.state === show))
      .filter((s) => !f || s.name.toLowerCase().includes(f) || s.description.toLowerCase().includes(f))
      .sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.name.localeCompare(b.name));
  }, [mine, show, find]);
  const troubled = (all ?? []).filter((s) => s.state === "failed" || s.state === "dead");

  const run = async (label: string, build: () => string) => {
    let command: string;
    try {
      command = build();
    } catch (e) {
      return toast({ title: "Fluff didn't run it", description: String(e), variant: "destructive" });
    }
    const err = await runQuick(label, command, dryRun);
    if (err) toast({ title: `Fluff couldn't finish: ${label}`, description: err, variant: "destructive" });
  };
  const showLog = async (s: Service) => {
    setLog({ name: s.name, text: null });
    try {
      setLog({ name: s.name, text: (await unitLog(s.name, s.user)) || "(nothing in its log)" });
    } catch (e) {
      setLog({ name: s.name, text: String(e) });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Cog className="h-5 w-5 text-primary" />
        <h2 className="text-sm font-semibold">Services</h2>
        <span className="text-[11px] text-muted-foreground">the programs systemd runs in the background — what runs, what failed, what sleeps</span>
        <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1 px-2 text-[11px]" onClick={() => void load()}>
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {troubled.length > 0 && (
        <FluffSays>
          {troubled.length === 1 ? "One service needs a look: " : `${troubled.length} services need a look: `}
          <b>{troubled.map((s) => s.name).join(", ")}</b>. Open its log (the page button) to see why; then On tries again, or Off if you
          don't use it.
        </FluffSays>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {(["system", "user"] as const).map((w) => (
          <button key={w} onClick={() => setWhose(w)} className={`rounded-md border px-2.5 py-1 text-[11px] ${whose === w ? "border-primary/60 bg-primary/10" : "hover:bg-accent/40"}`}>
            {w === "system" ? "The system's" : "Yours"} ({(all ?? []).filter((s) => (w === "user") === s.user).length})
          </button>
        ))}
        <div className="relative ml-auto w-56">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a service…" className="h-7 pl-6 text-xs" />
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        <button onClick={() => setShow("all")} className={`rounded border px-2 py-0.5 text-[10px] ${show === "all" ? "border-primary/60 bg-primary/10" : ""}`}>
          All {mine.length}
        </button>
        {ORDER.filter((s) => counts[s] > 0).map((s) => (
          <button key={s} title={STATE_WORDS[s]} onClick={() => setShow(s)} className={`rounded border px-2 py-0.5 text-[10px] ${show === s ? "border-primary/60 bg-primary/10" : ""} ${TONE[s]}`}>
            {LABEL[s]} {counts[s]}
          </button>
        ))}
      </div>
      {show !== "all" && <p className="text-[11px] text-muted-foreground">{LABEL[show]}: {STATE_WORDS[show]}.</p>}

      {loading && !all ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <section className="divide-y divide-border/60 overflow-hidden rounded-md border bg-card">
          {shown.length === 0 && <p className="p-3 text-[11px] text-muted-foreground">Nothing here.</p>}
          {shown.map((s) => {
            const b = buttons(s);
            const why = protectedWhy(s);
            const advice = fluffSays(s);
            return (
              <div key={`${s.user}:${s.name}`} className="space-y-1 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={`px-1.5 py-0 text-[9px] ${TONE[s.state]}`} title={STATE_WORDS[s.state]}>
                    {LABEL[s.state]}
                  </Badge>
                  <span className="font-mono text-xs">{s.name.replace(/\.service$/, "")}</span>
                  {tuxUnit(s.name) && <TuxTag why={tuxUnit(s.name)!} />}
                  <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{s.description}</span>
                  {s.enabled && s.enabled !== "static" && <span className="text-[10px] text-muted-foreground">{s.enabled === "enabled" ? "starts at boot" : s.enabled}</span>}
                  <div className="flex gap-1">
                    {b.on && (
                      <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[10px]" title={onCommand(s)} onClick={() => void run(`On: ${s.name}`, () => onCommand(s))}>
                        <Power className="h-3 w-3" /> On
                      </Button>
                    )}
                    {b.off && (
                      <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[10px]" title={offCommand(s)} onClick={() => void run(`Off: ${s.name}`, () => offCommand(s))}>
                        <PowerOff className="h-3 w-3" /> Off
                      </Button>
                    )}
                    {b.kill && (
                      <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[10px] text-bad" title={killCommand(s)} onClick={() => void run(`Kill: ${s.name}`, () => killCommand(s))}>
                        <Skull className="h-3 w-3" /> Kill
                      </Button>
                    )}
                    {s.state !== "never started" && (
                      <Button size="icon" variant="ghost" className="h-6 w-6" title="its log" onClick={() => void showLog(s)}>
                        <FileText className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
                {why && (s.state === "running" || s.state === "dormant") && <p className="text-[10px] text-muted-foreground">Fluff keeps this one on: {why}.</p>}
                {advice && <FluffSays>{advice}</FluffSays>}
                {log?.name === s.name && (
                  <pre className="max-h-56 overflow-auto rounded-md bg-term p-2 text-[10px] text-term-foreground">{log.text ?? "Fluff is reading its log…"}</pre>
                )}
              </div>
            );
          })}
        </section>
      )}
      <p className="text-[10px] text-muted-foreground">
        On switches a service on and starts it; Off stops it and keeps it from starting at boot; Kill stops it at once, and it reads Dead. Each
        shows its command first.
      </p>
    </div>
  );
}
