// Home: how much disk the apps take — the disk bar, what each kind of app uses, the apps that
// would free the most if removed (each a link to its page), and the package caches.
import { useCallback, useEffect, useState } from "react";
import { HardDrive, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { EMPTY_PACMAN_CACHE, FREE_AUR_CACHE, FREE_PACMAN_CACHE, diskOverview, formatBytes, type DiskOverview } from "@/lib/disk";
import { AppLink } from "./app-link";
import { useArch } from "./store";

function CacheButton({ label, command, note, danger }: { label: string; command: string; note: string; danger?: boolean }) {
  const { runQuick, dryRun } = useArch();
  const { toast } = useToast();
  return (
    <Button
      size="sm"
      variant={danger ? "destructive" : "outline"}
      className="h-6 px-2 text-[11px]"
      title={`${note}\n\n${command}`}
      onClick={async () => {
        const err = await runQuick(label.replace(/ \(.*\)$/, ""), command, dryRun);
        if (err) toast({ title: "Fluff couldn't start it", description: err, variant: "destructive" });
      }}
    >
      {label}
    </Button>
  );
}

export function DiskWidget() {
  const { machineVersion } = useArch();
  const [d, setD] = useState<DiskOverview | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setD(await diskOverview());
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, machineVersion]);

  const rows: Array<{ label: string; bytes: number; note?: string }> = d
    ? [
        { label: "System and apps (pacman + AUR)", bytes: d.packages.total, note: `${d.packages.count} packages` },
        ...(d.flatpak ? [{ label: "Flatpaks", bytes: d.flatpak.apps + d.flatpak.runtimes, note: `${d.flatpak.count} apps + their runtimes` }] : []),
        ...(d.docker !== null ? [{ label: "Docker", bytes: d.docker, note: "images, containers, volumes" }] : []),
        ...(d.ollama !== null ? [{ label: "Ollama models", bytes: d.ollama }] : []),
        ...(d.git ? [{ label: "Git clones", bytes: d.git.clones, note: `${d.git.count} repositories · your own projects ${formatBytes(d.git.yours)} more · the Git section shows which are unused` }] : []),
        { label: "Package caches", bytes: d.caches.pacman + d.caches.aur, note: `pacman ${formatBytes(d.caches.pacman)} · AUR builds ${formatBytes(d.caches.aur)}` },
      ]
    : [];
  const max = Math.max(1, ...rows.map((r) => r.bytes));

  return (
    <section className="rounded-md border bg-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <HardDrive className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Disk used by apps</span>
        {d?.disk && (
          <span className="text-[11px] text-muted-foreground">
            {formatBytes(d.disk.free)} free of {formatBytes(d.disk.total)}
          </span>
        )}
        <Button size="icon" variant="ghost" className="ml-auto h-6 w-6" onClick={() => void load()} aria-label="Read again">
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {!d ? (
        <Skeleton className="h-24" />
      ) : (
        <div className="space-y-3">
          {d.disk && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted" title={`${Math.round((d.disk.used / d.disk.total) * 100)}% of the disk is used`}>
              <div
                className={`h-full rounded-full ${d.disk.free / d.disk.total < 0.1 ? "bg-destructive/80" : "bg-primary/70"}`}
                style={{ width: `${(d.disk.used / d.disk.total) * 100}%` }}
              />
            </div>
          )}

          <div className="space-y-1.5">
            {rows.map((r) => (
              <div key={r.label} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 sm:grid-cols-[14rem_1fr_auto]">
                <span className="truncate text-xs">{r.label}</span>
                <div className="hidden h-1.5 overflow-hidden rounded-full bg-muted sm:block">
                  <div className="h-full rounded-full bg-sky-500/70" style={{ width: `${Math.max(1, (r.bytes / max) * 100)}%` }} />
                </div>
                <span className="text-right font-mono text-xs">{formatBytes(r.bytes)}</span>
                {r.note && <span className="col-span-2 -mt-0.5 text-[10px] text-muted-foreground sm:col-span-3">{r.note}</span>}
              </div>
            ))}
          </div>

          {d.topApps.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] text-muted-foreground">The apps that would free the most if removed (with what only they need):</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {d.topApps.map((a) => (
                  <span key={a.name} className="text-xs">
                    <AppLink name={a.name} source={a.kind} /> <span className="font-mono text-[10px] text-muted-foreground">{formatBytes(a.frees)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1 rounded-md border border-dashed p-2">
            <p className="text-[11px] text-muted-foreground">
              Free the package caches — pacman keeps a copy of every package it downloaded, yay keeps its build folders.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <CacheButton label={`Free pacman cache (${formatBytes(d.caches.pacman)})`} command={FREE_PACMAN_CACHE} note="keeps the versions installed now, so you can still reinstall them offline" />
              <CacheButton label="Empty it completely" command={EMPTY_PACMAN_CACHE} danger note="every cached package goes; going back to an older version then needs the internet" />
              <CacheButton label={`Free AUR builds (${formatBytes(d.caches.aur)})`} command={FREE_AUR_CACHE} note="yay's build folders; it rebuilds what it needs next time" />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
