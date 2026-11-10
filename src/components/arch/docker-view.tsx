// The Docker section: your Docker apps (compose folders in ~/docker and anything docker
// compose knows), each with Open / Start / Stop / Restart / Update / Logs and the plain
// command behind every button; apps to set up from their makers' own files; Troubleshoot.
import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown, ChevronRight, CircleAlert, Container as ContainerIcon, Copy, ExternalLink, FileText,
  Play, Plus, RefreshCw, RotateCw, Square, Stethoscope, Wrench, ArrowUpCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { openExternal } from "@/lib/host";
import {
  DOCKER_SETUP, RECIPES, appCommands, containerCommands, dockerLogs, dockerState, recipeCommand,
  type ComposeApp, type Container, type DockerCommand, type DockerState, type Recipe,
} from "@/lib/docker";
import { diagnoseDocker } from "@/lib/troubleshoot";
import { TroubleshootDialog } from "./troubleshoot-dialog";
import { useArch } from "./store";
import { PortHint } from "./ports-panel";

const BASICS: Array<{ command: string; note: string }> = [
  { command: "docker ps", note: "what is running right now" },
  { command: "docker ps -a", note: "every container, stopped ones too" },
  { command: "docker compose up -d", note: "start the app whose folder you are in (cd into it first)" },
  { command: "docker compose logs -f", note: "follow that app's log live (Ctrl+C to stop following)" },
  { command: "docker compose pull && docker compose up -d", note: "update that app" },
  { command: "docker system df", note: "how much space Docker uses" },
];

export function DockerView() {
  const { runQuick, dryRun, machineVersion } = useArch();
  const { toast } = useToast();
  const [state, setState] = useState<DockerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [logs, setLogs] = useState<{ title: string; text: string | null } | null>(null);
  const [open, setOpen] = useState<string | null>(null); // which app's commands are unfolded

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setState(await dockerState());
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, machineVersion]);

  const run = async (label: string, command: string) => {
    const err = await runQuick(label, command, dryRun);
    if (err) toast({ title: `Fluff couldn't finish: ${label}`, description: err, variant: "destructive" });
  };
  const copy = (command: string) => {
    void navigator.clipboard.writeText(command);
    toast({ title: "Fluff copied it", description: command.slice(0, 80) });
  };
  const showLogs = async (title: string, target: string) => {
    setLogs({ title, text: null });
    try {
      setLogs({ title, text: (await dockerLogs(target)) || "(it has not printed anything yet)" });
    } catch (e) {
      setLogs({ title, text: String(e) });
    }
  };

  const installedApps = state?.apps ?? [];
  const setUp = new Set(installedApps.map((a) => a.name));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ContainerIcon className="h-5 w-5 text-sky-400" />
        <h2 className="text-sm font-semibold">Docker</h2>
        {loading && !state ? (
          <Skeleton className="h-5 w-24" />
        ) : !state?.installed ? (
          <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-400">not installed</Badge>
        ) : !state.reachable ? (
          <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-400">installed · not answering</Badge>
        ) : (
          <Badge variant="outline" className="border-emerald-500/40 text-[10px] text-emerald-400">
            running · {installedApps.length} app{installedApps.length === 1 ? "" : "s"}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => void load()}>
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setDoctorOpen(true)}>
            <Stethoscope className="h-3 w-3" /> Troubleshoot
          </Button>
        </div>
      </div>

      {state && !state.installed && (
        <Callout text="Docker is not installed. This installs it with its compose plugin, starts it at every boot, and lets you use it without sudo (after you log out and back in). Using it without sudo means being in the docker group, which lets any program you run act as root without your password — Security can take you out again.">
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" title={DOCKER_SETUP} onClick={() => void run("Set up Docker", DOCKER_SETUP)}>
            <Wrench className="h-3 w-3" /> Set up Docker
          </Button>
        </Callout>
      )}
      {state?.installed && !state.reachable && (
        <Callout text="Docker is installed but does not answer, so your apps can't be listed or started. Troubleshoot finds out why.">
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setDoctorOpen(true)}>
            <Stethoscope className="h-3 w-3" /> Troubleshoot
          </Button>
        </Callout>
      )}

      {/* your apps */}
      <section className="overflow-hidden rounded-md border bg-card">
        <div className="flex items-center gap-2 border-b border-border/60 p-3">
          <span className="text-sm font-semibold">Your Docker apps</span>
          <Badge variant="outline" className="text-[10px] text-muted-foreground">{installedApps.length}</Badge>
          <span className="text-[11px] text-muted-foreground">folders in ~/docker, and anything docker compose has started</span>
        </div>
        {installedApps.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            None yet. Set one up below, or put an app's folder (with its compose.yml) in ~/docker.
          </p>
        ) : (
          <div className="divide-y divide-border/60">
            {installedApps.map((a) => (
              <AppRow
                key={a.name}
                app={a}
                unfolded={open === a.name}
                onFold={() => setOpen(open === a.name ? null : a.name)}
                onRun={run}
                onCopy={copy}
                onLogs={() => a.file && void showLogs(a.name, a.file)}
              />
            ))}
          </div>
        )}
      </section>

      {/* recipes */}
      <section className="overflow-hidden rounded-md border bg-card">
        <div className="flex items-center gap-2 border-b border-border/60 p-3">
          <Plus className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Set up an app that needs Docker</span>
        </div>
        <div className="divide-y divide-border/60">
          {RECIPES.map((r) => (
            <RecipeRow key={r.id} recipe={r} done={setUp.has(r.folder)} onRun={run} onCopy={copy} />
          ))}
        </div>
        <p className="border-t border-border/60 p-3 text-[10px] leading-relaxed text-muted-foreground">
          The files come from the app's makers when you press Set up, so they are always their
          current ones. If they have changed in a way this recipe does not expect, it stops before
          starting anything and points you to their guide.
        </p>
      </section>

      {/* loose containers */}
      {state && state.loose.length > 0 && (
        <section className="overflow-hidden rounded-md border bg-card">
          <div className="flex items-center gap-2 border-b border-border/60 p-3">
            <span className="text-sm font-semibold">Other containers</span>
            <span className="text-[11px] text-muted-foreground">started with docker run, not compose</span>
          </div>
          <div className="divide-y divide-border/60">
            {state.loose.map((c) => (
              <ContainerRow key={c.name} c={c} onRun={run} onCopy={copy} onLogs={() => void showLogs(c.name, c.name)} />
            ))}
          </div>
        </section>
      )}

      {/* basics */}
      <section className="rounded-md border bg-card p-3">
        <p className="mb-2 text-sm font-semibold">The commands worth remembering</p>
        <div className="space-y-1">
          {BASICS.map((b) => (
            <div key={b.command} className="flex items-center gap-2">
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{b.command}</code>
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{b.note}</span>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => copy(b.command)} aria-label="Copy">
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      </section>

      <TroubleshootDialog open={doctorOpen} onClose={() => { setDoctorOpen(false); void load(); }} title="Docker" diagnose={diagnoseDocker} />

      <Dialog open={logs !== null} onOpenChange={(o) => !o && setLogs(null)}>
        <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-sm">Log: {logs?.title}</DialogTitle>
            <DialogDescription className="text-xs">the last 200 lines; newest at the bottom</DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-term p-3 text-[10px] leading-relaxed text-term-foreground">
            {logs?.text ?? "Reading…"}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Callout({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 sm:flex-row sm:items-center">
      <CircleAlert className="h-4 w-4 shrink-0 text-amber-400" />
      <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-foreground/85">{text}</p>
      {children}
    </div>
  );
}

function OpenButton({ ports, running }: { ports: number[]; running: boolean }) {
  if (!ports.length) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-6 gap-1 px-2 text-[11px] text-primary"
      disabled={!running}
      title={running ? `open http://localhost:${ports[0]}` : "start it first"}
      onClick={() => void openExternal(`http://localhost:${ports[0]}`)}
    >
      <ExternalLink className="h-3 w-3" /> Open
    </Button>
  );
}

function CommandList({ commands, onRun, onCopy }: { commands: DockerCommand[]; onRun: (l: string, c: string) => void; onCopy: (c: string) => void }) {
  return (
    <div className="space-y-1.5 bg-muted/30 px-3 py-2">
      {commands.map((c) => (
        <div key={c.id}>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant={c.danger ? "destructive" : "outline"}
              className="h-6 shrink-0 px-2 text-[11px]"
              disabled={c.id === "shell"}
              title={c.id === "shell" ? "needs a terminal: copy it and paste it into one" : undefined}
              onClick={() => onRun(c.label, c.command)}
            >
              {c.label}
            </Button>
            <code className="min-w-0 flex-1 truncate font-mono text-[10px]" title={c.command}>{c.command}</code>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onCopy(c.command)} aria-label="Copy">
              <Copy className="h-3 w-3" />
            </Button>
          </div>
          <p className={`pl-1 text-[10px] ${c.danger ? "text-destructive/90" : "text-muted-foreground"}`}>{c.note}</p>
        </div>
      ))}
    </div>
  );
}

function AppRow({ app, unfolded, onFold, onRun, onCopy, onLogs }: {
  app: ComposeApp; unfolded: boolean; onFold: () => void;
  onRun: (l: string, c: string) => void; onCopy: (c: string) => void; onLogs: () => void;
}) {
  const cmds = appCommands(app);
  const by = (id: string) => cmds.find((c) => c.id === id);
  const running = app.running > 0;
  const quick = (id: string, Icon: typeof Play) => {
    const c = by(id);
    return c ? (
      <Button size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[11px]" title={c.command} onClick={() => onRun(`${c.label} ${app.name}`, c.command)}>
        <Icon className="h-3 w-3" /> {c.label}
      </Button>
    ) : null;
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button onClick={onFold} className="flex min-w-0 flex-1 items-center gap-1.5 text-left" aria-expanded={unfolded}>
          {unfolded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate text-sm font-medium">{app.name}</span>
          <Badge variant="outline" className={`px-1 py-0 text-[9px] ${running ? "text-emerald-400 border-emerald-400/40" : "text-muted-foreground"}`}>
            {app.total === 0 ? "not started yet" : running ? `running ${app.running}/${app.total}` : "stopped"}
          </Badge>
          {app.ports.length > 0 && <span className="text-[10px] text-muted-foreground">localhost:{app.ports.join(", ")}</span>}
        </button>
        <OpenButton ports={app.ports} running={running} />
        {running ? quick("stop", Square) : quick("start", Play)}
        {quick("restart", RotateCw)}
        {quick("update", ArrowUpCircle)}
        {app.file && (
          <Button size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[11px]" onClick={onLogs}>
            <FileText className="h-3 w-3" /> Logs
          </Button>
        )}
      </div>
      {unfolded && (
        <>
          {app.dir && <p className="bg-muted/30 px-3 pt-2 text-[10px] text-muted-foreground">folder: {app.dir} · settings are in its .env file</p>}
          {cmds.length ? <CommandList commands={cmds} onRun={onRun} onCopy={onCopy} /> : (
            <p className="bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">Docker no longer knows where this app's compose file is.</p>
          )}
        </>
      )}
    </div>
  );
}

function ContainerRow({ c, onRun, onCopy, onLogs }: { c: Container; onRun: (l: string, c: string) => void; onCopy: (c: string) => void; onLogs: () => void }) {
  const [unfolded, setUnfolded] = useState(false);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button onClick={() => setUnfolded(!unfolded)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          {unfolded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <span className="truncate font-mono text-xs">{c.name}</span>
          <span className="truncate text-[10px] text-muted-foreground">{c.image} · {c.status}</span>
        </button>
        <OpenButton ports={c.ports} running={c.state === "running"} />
        <Button size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[11px]" onClick={onLogs}>
          <FileText className="h-3 w-3" /> Logs
        </Button>
      </div>
      {unfolded && <CommandList commands={containerCommands(c)} onRun={onRun} onCopy={onCopy} />}
    </div>
  );
}

function RecipeRow({ recipe, done, onRun, onCopy }: { recipe: Recipe; done: boolean; onRun: (l: string, c: string) => void; onCopy: (c: string) => void }) {
  const [show, setShow] = useState(false);
  const cmd = recipeCommand(recipe);
  return (
    <div className="px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{recipe.name}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{recipe.blurb}</span>
        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => void openExternal(recipe.docs)}>
          their guide <ExternalLink className="ml-1 h-3 w-3" />
        </Button>
        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => setShow(!show)}>
          {show ? "hide" : "what it does"}
        </Button>
        <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]" disabled={done} title={done ? "already set up — see Your Docker apps" : cmd} onClick={() => onRun(`Set up ${recipe.name}`, cmd)}>
          <Wrench className="h-3 w-3" /> {done ? "Set up" + " ✓" : "Set up"}
        </Button>
      </div>
      {!done && (
        <div className="mt-0.5">
          <PortHint port={recipe.port} />
        </div>
      )}
      {show && (
        <div className="mt-2 space-y-1 rounded-md bg-muted/30 p-2 text-[11px] leading-relaxed text-muted-foreground">
          <p>
            Makes <code>~/docker/{recipe.folder}</code>, downloads the makers' own files into it,
            fills in the secrets their guide asks you to invent (random ones), your time zone and
            port {recipe.port}, then starts it. Afterwards it opens at http://localhost:{recipe.port}.
          </p>
          <div className="flex items-start gap-1.5">
            <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[10px]">{cmd.split(" && ").join(" &&\n")}</code>
            <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => onCopy(cmd)} aria-label="Copy">
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
