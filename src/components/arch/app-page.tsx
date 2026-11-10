// An app's own page (Apps → click an app): how it works, what it needs, what you can change,
// and Fix it. Read from pacman / flatpak and the app's files. Turning things on or off waits
// for Apply; Fix it runs at once (asked "Are you sure?" when live); removal opens the plans.
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft, Cog, Copy, ExternalLink, FileText, FolderCog, LifeBuoy, Package as PackageIcon, Puzzle, Trash2, Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { openExternal, readText } from "@/lib/host";
import { parsePasswd } from "@/lib/ports";
import { protectedReason } from "@/lib/protected";
import {
  FLATPAK_TOGGLES, clearCacheCommand, endCommand, installPkgCommand, mainProcesses, appCommand, appState, canBeDead, diffCommand, flatpakDetails, flatpakOverride, flatpakResetOverrides, hasPerm, optionalCommand,
  pacnewCommand, pkgDetails, reinstallCommand, resetCommand, restoreCommand, toggleable, unitCommand, unitLog,
  type AppDetails, type FlatpakDetails, type UnitState,
} from "@/lib/app-details";
import { EliminateDialog, type EliminateTarget } from "./eliminate-dialog";
import { AppLink } from "./app-link";
import { ThreeState } from "./three-state";
import { isPlannableName, sanitizeAppName } from "@/lib/eliminate";
import { useArch } from "./store";
import { TuxTag } from "./tux-tag";
import { tuxPackage, tuxPath, tuxUnit } from "@/lib/tux-own";

type Loaded = AppDetails | FlatpakDetails | { kind: "other" };

export function AppPage({ app, source }: { app: string; source: string }) {
  const { closeAppPage, openAppPage, runQuick, dryRun, stageSystem, machineVersion } = useArch();
  const { toast } = useToast();
  const [d, setD] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remove, setRemove] = useState<EliminateTarget | null>(null);
  const [log, setLog] = useState<{ title: string; text: string | null } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setD(source === "flatpak" ? await flatpakDetails(app) : source === "pacman" || source === "aur" ? await pkgDetails(app) : { kind: "other" });
    } catch (e) {
      setError(String(e));
    }
  }, [app, source]);
  useEffect(() => {
    void load();
  }, [load, machineVersion]);

  const run = async (label: string, command: string) => {
    if (!command) return;
    const err = await runQuick(label, command, dryRun);
    if (err) toast({ title: `Fluff couldn't finish: ${label}`, description: err, variant: "destructive" });
  };
  const stage = (label: string, command: string) => {
    stageSystem(label, command);
    toast({ title: `${label} — pending`, description: "Apply (top bar) to do it, or Undo." });
  };
  const copy = (command: string) => {
    void navigator.clipboard.writeText(command);
    toast({ title: "Fluff copied it", description: command.slice(0, 80) });
  };
  const showLog = async (u: UnitState) => {
    setLog({ title: u.name, text: null });
    try {
      setLog({ title: u.name, text: (await unitLog(u.name, u.user)) || "(nothing logged)" });
    } catch (e) {
      setLog({ title: u.name, text: String(e) });
    }
  };

  const system = protectedReason(app);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={closeAppPage}>
          <ArrowLeft className="h-3 w-3" /> Apps
        </Button>
        <h2 className="text-sm font-semibold">{app}</h2>
        {tuxPackage(app) && <TuxTag why={tuxPackage(app)!} />}
        <Badge variant="outline" className="px-1.5 py-0 text-[10px] capitalize">{source}</Badge>
        {system && (
          <Badge variant="outline" className="border-sky-500/50 px-1 py-0 text-[9px] text-sky-300" title={`Part of your system: ${system}`}>System</Badge>
        )}
        <div className="ml-auto flex items-center gap-3">
          {d?.kind === "pacman" && <OnOff d={d} system={system} stage={stage} />}
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setRemove({ app, source })}>
            <Trash2 className="h-3 w-3" /> Remove…
          </Button>
        </div>
      </div>

      {error && /is not installed/.test(error) && (source === "pacman" || source === "aur") ? (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-xs">{app} is not installed on this machine.</p>
          {isPlannableName(app) && sanitizeAppName(app) === app && (
            <Cmd label="Install" command={installPkgCommand(app, source === "aur")} onRun={() => run(`Install ${app}`, installPkgCommand(app, source === "aur"))} onCopy={copy} />
          )}
        </div>
      ) : (
        error && <p className="rounded-md border border-destructive/40 p-3 text-xs text-destructive">{error}</p>
      )}
      {!d && !error && <Skeleton className="h-40" />}

      {d?.kind === "pacman" && d.name !== app && (
        <p className="text-[11px] text-muted-foreground">“{app}” is provided by the package {d.name} — this is its page.</p>
      )}
      {d?.kind === "pacman" && (
        <PacmanPage d={d} source={d.foreign ? "aur" : "pacman"} run={run} stage={stage} copy={copy} showLog={showLog} openApp={(a) => openAppPage(a, "pacman")} />
      )}
      {d?.kind === "flatpak" && <FlatpakPage d={d} run={run} stage={stage} copy={copy} />}
      {d?.kind === "other" && (
        <Card icon={LifeBuoy} title="About this app">
          <p className="text-xs text-muted-foreground">
            {source === "snap"
              ? "A snap. In a terminal, `snap info " + app + "` describes it and `snap connections " + app + "` shows what it may access."
              : "Installed outside pacman and flatpak, so there is no package record to read. Its removal plans still know where such apps keep their files."}
          </p>
        </Card>
      )}

      <EliminateDialog target={remove} onClose={() => setRemove(null)} onOpen={setRemove} sourceOf={() => source} />
      <Dialog open={log !== null} onOpenChange={(o) => !o && setLog(null)}>
        <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-sm">Log: {log?.title}</DialogTitle>
            <DialogDescription className="text-xs">its last 80 lines</DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-term p-3 text-[10px] text-term-foreground">{log?.text ?? "Reading…"}</pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * On / Off / Dead for the whole app. Off: stopped for now, back at the next restart or login.
 * Dead: services disabled, login start removed, every copy ended — written down, so On puts
 * back exactly that. Waits for Apply; never for apps that are part of the system.
 */
function OnOff({ d, system, stage }: { d: AppDetails; system: string | null; stage: (l: string, c: string) => void }) {
  const { history } = useArch();
  const state = appState(d);
  const running = mainProcesses(d.processes).length;
  const pending = history.pending.some((c) => c.kind === "system" && c.label.startsWith(`${d.name}:`));
  const locked = system ? `part of your system (${system}) — it can't be switched off from here` : null;
  const hasMenu = !!d.menu[0];
  return (
    <span className="flex items-center gap-1.5">
      <ThreeState
        value={state}
        pending={pending}
        unavailable={{
          ...(locked ? { off: locked, dead: locked } : {}),
          ...(!locked && !canBeDead(d) ? { dead: "nothing starts it by itself (no service, no login start): Off is all it takes" } : {}),
          ...(state === "off" && !hasMenu && !d.units.some((u) => u.enabled === "enabled") ? { on: "it has no menu entry or service to start — open it from a terminal" } : {}),
        }}
        onPick={(to) => stage(`${d.name}: make it ${to === "on" ? "On" : to === "off" ? "Off" : "Dead"}`, appCommand(d, to))}
      />
      <span className="text-[10px] text-muted-foreground">
        {pending ? "waiting for Apply" : state === "on" ? (running ? `running (${running})` : "its service runs") : state === "off" ? "not running" : "kept from starting"}
      </span>
    </span>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────

function Card({ icon: Icon, title, hint, children }: { icon: typeof Cog; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border bg-card">
      <div className="flex items-baseline gap-2 border-b border-border/60 px-3 py-2">
        <Icon className="h-3.5 w-3.5 self-center text-primary" />
        <span className="text-sm font-semibold">{title}</span>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      <div className="space-y-2 p-3">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="w-32 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 text-xs">{children}</div>
    </div>
  );
}

function Cmd({ label, command, onRun, onCopy, danger, note }: { label: string; command: string; onRun?: () => void; onCopy: (c: string) => void; danger?: boolean; note?: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        {onRun && (
          <Button size="sm" variant={danger ? "destructive" : "outline"} className="h-6 shrink-0 gap-1 px-2 text-[11px]" onClick={onRun}>
            <Wrench className="h-3 w-3" /> {label}
          </Button>
        )}
        {!onRun && <span className="shrink-0 text-[11px]">{label}</span>}
        <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground" title={command}>{command}</code>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onCopy(command)} aria-label="Copy">
          <Copy className="h-3 w-3" />
        </Button>
      </div>
      {note && <p className="pl-1 text-[10px] text-muted-foreground">{note}</p>}
    </div>
  );
}

const Chips = ({ items, onClick }: { items: string[]; onClick?: (s: string) => void }) =>
  items.length === 0 ? (
    <span className="text-muted-foreground">nothing</span>
  ) : (
    <span className="flex flex-wrap gap-1">
      {items.map((i) =>
        onClick ? (
          <button key={i} onClick={() => onClick(i)} className="rounded border px-1.5 py-0.5 font-mono text-[10px] hover:bg-accent">{i}</button>
        ) : (
          <code key={i} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{i}</code>
        ),
      )}
    </span>
  );

// ── pacman / AUR ─────────────────────────────────────────────────────────

function PacmanPage({ d, source, run, stage, copy, showLog, openApp }: {
  d: AppDetails; source: string;
  run: (l: string, c: string) => void; stage: (l: string, c: string) => void; copy: (c: string) => void;
  showLog: (u: UnitState) => void; openApp: (a: string) => void;
}) {
  const i = d.info;
  const settings = d.home.filter((h) => h.place === "settings" || h.place === "state");
  const caches = d.home.filter((h) => h.place === "cache");
  const autostartMine = d.home.filter((h) => h.place === "autostart");
  const withBackups = d.home.filter((h) => h.backups.length > 0);

  return (
    <div className="space-y-3">
      <Card icon={Cog} title="How it works">
        <p className="text-xs">{i.description}</p>
        <Row label="version">{i.version}{i.from ? ` · from ${i.from}` : ""} · {i.size} · {d.fileCount} files</Row>
        <Row label="installed">{i.installDate} · {i.explicit ? "by you" : "as something another package needed"}</Row>
        {i.url && (
          <Row label="home page">
            <button className="inline-flex items-center gap-1 underline" onClick={() => void openExternal(i.url!)}>
              {i.url} <ExternalLink className="h-3 w-3" />
            </button>
          </Row>
        )}
        <Row label="programs"><Chips items={d.programs} /></Row>
        <Row label="running now">
          <Running d={d} run={run} />
        </Row>
        <Row label="in your menu">{d.menu.length ? d.menu.map((m) => m.split("/").pop()).join(", ") : "no menu entry"}</Row>
        <Row label="background">
          {d.units.length === 0 ? (
            "no services — it only runs while you have it open"
          ) : (
            <span className="space-y-1">
              {d.units.map((u) => (
                <span key={u.name} className="flex flex-wrap items-center gap-1.5">
                  <code className="text-[10px]">{u.name}</code>
                  {tuxUnit(u.name) && <TuxTag why={tuxUnit(u.name)!} />}
                  <Badge variant="outline" className={`px-1 py-0 text-[9px] ${u.active === "active" ? "text-emerald-400" : "text-muted-foreground"}`}>
                    {u.active || "?"}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">{u.user ? "your session" : "system"} · {u.enabled || "?"}</span>
                  <button className="text-[10px] underline" onClick={() => showLog(u)}>log</button>
                </span>
              ))}
            </span>
          )}
        </Row>
        <Row label="starts at login">
          {d.autostart.length || autostartMine.length
            ? [...d.autostart.map((a) => `${a.split("/").pop()} (for everyone)`), ...autostartMine.map((a) => `${a.path.split("/").pop()} (yours)`)].join(", ")
            : "no"}
        </Row>
      </Card>

      <Card icon={Puzzle} title="What it needs">
        <Row label="needs"><Chips items={i.depends} onClick={openApp} /></Row>
        <Row label="needed by">
          {i.requiredBy.length ? <Chips items={i.requiredBy} onClick={openApp} /> : "nothing — no other package needs it"}
        </Row>
        {i.optional.length > 0 && (
          <Row label="optional extras">
            <span className="space-y-1">
              {i.optional.map((o) => (
                <span key={o.name} className="flex flex-wrap items-center gap-1.5">
                  {o.installed ? <AppLink name={o.name} className="text-[10px]" /> : <code className="text-[10px]">{o.name}</code>}
                  <span className="text-[10px] text-muted-foreground">{o.why}</span>
                  {o.installed ? (
                    <Badge variant="outline" className="px-1 py-0 text-[9px] text-emerald-400">installed</Badge>
                  ) : (
                    <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px]" title={optionalCommand(o.name)} onClick={() => run(`Install ${o.name}`, optionalCommand(o.name))}>
                      add
                    </Button>
                  )}
                </span>
              ))}
            </span>
          </Row>
        )}
      </Card>

      <Card icon={FolderCog} title="What you can change">
        <Row label="services">
          {d.units.filter(toggleable).length === 0 ? (
            <span className="text-muted-foreground">nothing to switch on or off</span>
          ) : (
            <span className="space-y-1">
              {d.units.filter(toggleable).map((u) => (
                <span key={u.name} className="flex items-center gap-2">
                  <Switch
                    checked={u.enabled === "enabled"}
                    onCheckedChange={(on) => stage(`${on ? "Turn on" : "Turn off"} ${u.name}`, unitCommand(u, on))}
                    aria-label={`${u.name} on at start`}
                  />
                  <code className="text-[10px]">{u.name}</code>
                  {tuxUnit(u.name) && <TuxTag why={tuxUnit(u.name)!} />}
                  <span className="text-[10px] text-muted-foreground">{u.user ? "starts with your session" : "starts at boot"}</span>
                </span>
              ))}
            </span>
          )}
        </Row>
        <Row label="system settings">
          {i.configs.length === 0 ? (
            <span className="text-muted-foreground">it ships no files in /etc</span>
          ) : (
            <span className="space-y-1">
              {i.configs.map((c) => (
                <span key={c.path} className="block">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <code className="text-[10px]">{c.path}</code>
                    {tuxPath(c.path) && <TuxTag why={tuxPath(c.path)!} />}
                    {c.modified ? (
                      <Badge variant="outline" className="px-1 py-0 text-[9px] text-amber-400">you changed it</Badge>
                    ) : (
                      <Badge variant="outline" className="px-1 py-0 text-[9px] text-muted-foreground">as shipped</Badge>
                    )}
                    {d.pacnew.includes(c.path) && (
                      <Badge variant="outline" className="px-1 py-0 text-[9px] text-sky-300" title="the package brought a newer default; yours was kept">newer default waiting</Badge>
                    )}
                  </span>
                  {c.modified && <Cmd label="what you changed" command={diffCommand(c.path, i.name, i.version)} onCopy={copy} note="paste into a terminal; it needs the package still in pacman's cache" />}
                  {d.pacnew.includes(c.path) && <Cmd label="what the new default changes" command={pacnewCommand(c.path)} onCopy={copy} />}
                </span>
              ))}
              <span className="block text-[10px] text-muted-foreground">edit them as root, e.g. sudoedit {i.configs[0].path}</span>
            </span>
          )}
        </Row>
        <Row label="your settings">
          {d.home.length === 0 ? (
            <span className="text-muted-foreground">no folder of its own found in your home (it may not have been opened yet, or uses another name)</span>
          ) : (
            <span className="space-y-0.5">
              {d.home.map((h) => (
                <span key={h.path} className="flex flex-wrap items-center gap-1.5">
                  <code className="text-[10px]">{h.path.replace(/^\/home\/[^/]+/, "~")}</code>
                  {tuxPath(h.path) && <TuxTag why={tuxPath(h.path)!} />}
                  <span className="text-[10px] text-muted-foreground">{h.place}{h.backups.length ? ` · ${h.backups.length} backup${h.backups.length === 1 ? "" : "s"}` : ""}</span>
                </span>
              ))}
            </span>
          )}
        </Row>
        {autostartMine.map((a) => (
          <Cmd key={a.path} label="Stop starting at login" command={`rm -f '${a.path}'`} onRun={() => stage(`Stop ${i.name} at login`, `rm -f '${a.path}'`)} onCopy={copy} />
        ))}
      </Card>

      <Card icon={LifeBuoy} title="Troubleshoot" hint="when it misbehaves — top to bottom, gentlest first">
        {caches.length > 0 && (
          <Cmd label="Clear its cache" command={clearCacheCommand(caches.map((c) => c.path))} onRun={() => run(`Clear ${i.name} cache`, clearCacheCommand(caches.map((c) => c.path)))} onCopy={copy} note="only throw-away files; it rebuilds them" />
        )}
        {settings.length > 0 && (
          <Cmd label="Reset its settings" command={resetCommand(settings.map((s) => s.path))} onRun={() => run(`Reset ${i.name} settings`, resetCommand(settings.map((s) => s.path)))} onCopy={copy} note="your settings are set aside as .bak-<date>, not deleted — Restore brings them back. Close the app first." />
        )}
        {withBackups.map((h) => (
          <Cmd
            key={h.path}
            label="Restore settings"
            command={restoreCommand(h.path, h.backups[h.backups.length - 1])}
            onRun={() => run(`Restore ${i.name} settings`, restoreCommand(h.path, h.backups[h.backups.length - 1]))}
            onCopy={copy}
            note={`puts back ${h.backups[h.backups.length - 1].split("/").pop()}; what is there now is kept as .after-reset-<date>`}
          />
        ))}
        <Cmd label="Reinstall" command={reinstallCommand(i.name, source === "aur")} onRun={() => run(`Reinstall ${i.name}`, reinstallCommand(i.name, source === "aur"))} onCopy={copy} note="puts back missing or damaged program files; your settings and edited /etc files stay" />
        {d.units.map((u) => (
          <Cmd key={u.name} label={`Restart ${u.name}`} command={u.user ? `systemctl --user restart ${u.name}` : `sudo systemctl restart ${u.name}`} onRun={() => run(`Restart ${u.name}`, u.user ? `systemctl --user restart ${u.name}` : `sudo systemctl restart ${u.name}`)} onCopy={copy} />
        ))}
        {d.programs[0] && <Cmd label="Recent crashes" command={`coredumpctl list --no-pager ${d.programs[0]}`} onCopy={copy} note="paste into a terminal; “No coredumps found” is good news" />}
      </Card>
      <p className="flex items-center gap-1 text-[10px] text-muted-foreground"><PackageIcon className="h-3 w-3" /> read from pacman’s own record of {i.name}</p>
    </div>
  );
}

function Running({ d, run }: { d: AppDetails; run: (l: string, c: string) => void }) {
  const [users, setUsers] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    void readText("/etc/passwd").then((t) => setUsers(parsePasswd(t ?? "")));
  }, []);
  const mains = mainProcesses(d.processes);
  if (mains.length === 0) return <span className="text-muted-foreground">not running</span>;
  const mine = mains.filter((p) => p.mine).map((p) => p.pid);
  return (
    <span className="space-y-0.5">
      {mains.map((p) => (
        <span key={p.pid} className="flex flex-wrap items-center gap-1.5">
          <code className="text-[10px]">pid {p.pid}</code>
          <span className="text-[10px]">{p.name}</span>
          {tuxPackage(p.name) && <TuxTag why={tuxPackage(p.name)!} />}
          <span className="text-[10px] text-muted-foreground">
            {p.mine ? "yours" : `as ${users.get(p.uid) ?? `uid ${p.uid}`}`}
            {p.helpers > 0 ? ` · ${p.helpers} helper process${p.helpers === 1 ? "" : "es"}` : ""}
          </span>
        </span>
      ))}
      {mine.length > 0 && (
        <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px]" title={endCommand(mine)} onClick={() => run(`End ${d.info.name}`, endCommand(mine))}>
          End it
        </Button>
      )}
      {mine.length < mains.length && (
        <span className="block text-[10px] text-muted-foreground">system processes: use its service's Restart below instead of ending them</span>
      )}
    </span>
  );
}

// ── flatpak ──────────────────────────────────────────────────────────────

function FlatpakPage({ d, run, stage, copy }: { d: FlatpakDetails; run: (l: string, c: string) => void; stage: (l: string, c: string) => void; copy: (c: string) => void }) {
  const ctx = d.perms.Context ?? {};
  const reset = d.data ? resetCommand([d.data]) : "";
  return (
    <div className="space-y-3">
      <Card icon={Cog} title="How it works">
        <p className="text-xs">{d.info.Title ?? d.id}</p>
        <Row label="version">{d.info.Version ?? "?"} · {d.info["Installed"] ?? d.info["Installed size"] ?? ""}</Row>
        <Row label="from">{d.info.Origin ?? "?"} · {d.info.Installation ?? ""}</Row>
        <Row label="runs on">{d.info.Runtime ?? "?"}</Row>
        <Row label="sandbox">a flatpak runs in its own box; it only reaches what it is allowed below</Row>
      </Card>
      <Card icon={FolderCog} title="What you can change" hint="its permissions — changes wait for Apply">
        {FLATPAK_TOGGLES.map((t) => {
          const on = hasPerm(d.perms, t.section, t.field, t.value);
          return (
            <span key={t.key} className="flex items-center gap-2">
              <Switch checked={on} onCheckedChange={(v) => stage(`${d.id}: ${v ? "allow" : "deny"} ${t.label.toLowerCase()}`, flatpakOverride(d.id, v ? t.on : t.off))} aria-label={t.label} />
              <span className="text-xs">{t.label}</span>
            </span>
          );
        })}
        <Row label="all it may use">
          <span className="space-y-0.5">
            {Object.entries(ctx).map(([k, v]) => (
              <span key={k} className="block text-[10px]"><span className="text-muted-foreground">{k}:</span> {v.join(", ")}</span>
            ))}
          </span>
        </Row>
        {Object.keys(d.overrides).length > 0 && (
          <Cmd label="Undo my permission changes" command={flatpakResetOverrides(d.id)} onRun={() => stage(`${d.id}: undo permission changes`, flatpakResetOverrides(d.id))} onCopy={copy} />
        )}
      </Card>
      <Card icon={LifeBuoy} title="Troubleshoot">
        {reset && <Cmd label="Reset its settings" command={reset} onRun={() => run(`Reset ${d.id}`, reset)} onCopy={copy} note="its whole ~/.var/app folder is set aside as .bak-<date>, not deleted. Close the app first." />}
        <Cmd label="Repair" command="flatpak repair --user" onRun={() => run("Repair flatpaks", "flatpak repair --user")} onCopy={copy} note="checks every flatpak's files and fetches damaged ones again" />
        <Cmd label="Run it from a terminal" command={`flatpak run ${d.id}`} onCopy={copy} note="shows its error messages as it starts" />
      </Card>
      <p className="flex items-center gap-1 text-[10px] text-muted-foreground"><FileText className="h-3 w-3" /> read from flatpak info</p>
    </div>
  );
}
