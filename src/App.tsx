import { exportBackup, prepareBackup } from "@/lib/api";
import { errText } from "@/lib/host";
import { ScrollMemory } from "@/lib/scroll-memory";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { applyLook, decodeText, iconUrl, openFile, setWindowIcon } from "@/lib/look-runtime";
import { exportSigner, importVerdict, savedNote } from "@/lib/integrity";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  House,
  SquareTerminal,
  Package,
  History,
  Play,
  Square,
  TriangleAlert,
  Download,
  Upload,
  ClipboardList,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Cog,
  Copy,
  Bot,
  ChartNoAxesColumn,
  RefreshCw,
  Settings,
  Container,
  Globe,
  GitBranch,
  Network,
  Stethoscope,
  ShieldCheck,
  MessageSquareHeart,
  MessageCircleQuestion,
} from "lucide-react";
import { SettingsView } from "@/components/arch/settings-view";
import { ConfirmRunDialog } from "@/components/arch/confirm-run-dialog";
import { WreckDialog } from "@/components/arch/wreck-dialog";
import { HandsCheckDialog } from "@/components/arch/hands-check-dialog";
import { SectionNav, useSections } from "@/components/arch/section-nav";
import { ChangesBar } from "@/components/arch/changes-bar";
import { placeKey, useArch, initSettings, type View } from "@/components/arch/store";
import { HomeView } from "@/components/arch/home-view";
import { CommandsView } from "@/components/arch/commands-view";
import { AppsView } from "@/components/arch/apps-view";
import { AppManagerView } from "@/components/arch/appmanager-view";
import { OllamaView } from "@/components/arch/ollama-view";
import { DockerView } from "@/components/arch/docker-view";
import { TorView } from "@/components/arch/tor-view";
import { ServicesView } from "@/components/arch/services-view";
import { TroubleshootView } from "@/components/arch/troubleshoot-view";
import { UpdatesView } from "@/components/arch/updates-view";
import { SecurityView } from "@/components/arch/security-view";
import { FeedbackView } from "@/components/arch/feedback-view";
import { PortsPanel } from "@/components/arch/ports-panel";
import { GitPanel } from "@/components/arch/git-panel";
import { HistoryView } from "@/components/arch/history-view";
import { ParseManagerDialog } from "@/components/arch/parse-manager-dialog";
import { serializeTree } from "@/lib/serialize";
import { WelcomeDialog } from "@/components/arch/welcome-dialog";
import { Guide } from "@/components/arch/guide";
import { AskFluff } from "@/components/arch/ask-fluff";
import { TerminalPanel } from "@/components/arch/terminal-panel";
import { useToast } from "@/hooks/use-toast";

const NAV: Array<{ id: View; label: string; icon: typeof House; hint: string }> = [
  { id: "home", label: "Home", icon: House, hint: "sections with play / stop / parse" },
  { id: "commands", label: "Commands", icon: SquareTerminal, hint: "saved rare config commands" },
  { id: "apps", label: "Apps", icon: Package, hint: "pacman / yay / github installs" },
  { id: "updates", label: "Updates", icon: RefreshCw, hint: "safe updates: Arch news first, a snapshot, fresh mirrors, the AUR looked at" },
  { id: "appmanager", label: "App Manager", icon: ChartNoAxesColumn, hint: "background usage log, rankings & removal plans" },
  { id: "security", label: "Security", icon: ShieldCheck, hint: "every protection at a glance; the network (the firewall, DNS), devices, accounts and login, the system" },
  { id: "ports", label: "Ports", icon: Network, hint: "localhost ports: who holds which, on / off / dead, is a port free?" },
  { id: "services", label: "Services", icon: Cog, hint: "what runs in the background: running, failed, dormant — On / Off / Kill" },
  { id: "troubleshoot", label: "Troubleshoot", icon: Stethoscope, hint: "Fluff's checkup: what failed, errors since boot, settings files waiting after updates" },
  { id: "git", label: "Git", icon: GitBranch, hint: "your git clones: size, used or unused, update or remove" },
  { id: "docker", label: "Docker", icon: Container, hint: "your Docker apps: open, start, stop, update, logs, troubleshoot" },
  { id: "tor", label: "Tor", icon: Globe, hint: "the Tor service: connection, bridges, tools, troubleshoot" },
  { id: "ollama", label: "Ollama", icon: Bot, hint: "local LLMs, machine analysis & recommendations" },
  { id: "history", label: "History", icon: History, hint: "past runs & output" },
  { id: "feedback", label: "Feedback", icon: MessageSquareHeart, hint: "Fluff is new at this: tell its creator what went wrong, or what you'd like" },
  { id: "settings", label: "Settings", icon: Settings, hint: "your OS, what counts as the system, and run safety" },
];

/** The page's scroll: each place keeps its own (new places open at the top). */
function PageScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const memory = useRef(new ScrollMemory());
  const { view, appPage, commandPage, commandsTab, securityTab, lastMove } = useArch();
  const key = placeKey({ view, appPage, commandPage, commandsTab, securityTab });
  const at = useRef(key);
  useEffect(() => {
    const el = ref.current;
    if (!el || at.current === key) return;
    at.current = key;
    const top = memory.current.target(key, lastMove);
    el.scrollTop = top;
    if (top === 0) return;
    // the page may still be loading: try again while it grows, for a moment
    let tries = 0;
    const again = () => {
      if (at.current !== key || el.scrollTop >= top - 1 || ++tries > 30) return;
      el.scrollTop = top;
      requestAnimationFrame(again);
    };
    requestAnimationFrame(again);
  }, [key, lastMove]);
  return (
    <div ref={ref} onScroll={(e) => memory.current.remember(at.current, e.currentTarget.scrollTop)} className="min-h-0 flex-1 overflow-y-auto p-4">
      {children}
    </div>
  );
}

/** Back / Up / Forward — and Alt+←/↑/→ and the mouse's side buttons, as in a browser. */
function NavButtons() {
  const { nav, goBack, goForward, goUp, view, appPage, commandPage } = useArch();
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const go = { ArrowLeft: goBack, ArrowRight: goForward, ArrowUp: goUp }[e.key];
      if (go) {
        e.preventDefault();
        go();
      }
    };
    const mouse = (e: MouseEvent) => {
      if (e.button === 3) goBack();
      if (e.button === 4) goForward();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("mouseup", mouse);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("mouseup", mouse);
    };
  }, [goBack, goForward, goUp]);
  const canUp = !!commandPage || !!appPage || view !== "home";
  const b = "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <div className="flex items-center">
      <button className={b} disabled={!nav.past.length} onClick={goBack} title="Back (Alt+←)" aria-label="Back">
        <ArrowLeft className="h-4 w-4" />
      </button>
      <button className={b} disabled={!canUp} onClick={goUp} title={commandPage || appPage ? "Up: back to the list (Alt+↑)" : "Up: Home (Alt+↑)"} aria-label="Up">
        <ArrowUp className="h-4 w-4" />
      </button>
      <button className={b} disabled={!nav.future.length} onClick={goForward} title="Forward (Alt+→)" aria-label="Forward">
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function App() {
  const { view, setView, dryRun, toggleDryRun, needed, toggleNeeded, run, pollRun, stopRun, loadTree, startPlay } =
    useArch();
  const { profile, refreshing, refreshKnowledge } = useArch();
  const { toast } = useToast();
  const initialized = useRef(false);
  const [parseManagerOpen, setParseManagerOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);

  // the look shows as soon as it is chosen (Apply keeps it): colours, and the window's icon
  const look = useArch((s) => s.look);
  useEffect(() => applyLook(look), [look]);
  const iconKey = look.icon ? (look.icon.svg ?? look.icon.png ?? "") : "";
  const iconShown = useRef("");
  useEffect(() => {
    if (iconKey === iconShown.current) return; // Fluff is the window's own at start
    iconShown.current = iconKey;
    void setWindowIcon(look.icon).catch(() => {});
  }, [iconKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Init: settings, tree, initial run state + polling loop
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    initSettings();
    loadTree();
    pollRun();
    const timer = setInterval(() => {
      const state = useArch.getState();
      if (state.run?.status === "running" || state.terminalOpen) state.pollRun();
    }, 500);
    return () => clearInterval(timer);
  }, []);

  const running = run?.status === "running";

  const copySetup = async () => {
    const markup = serializeTree(useArch.getState().tree);
    if (!markup.trim()) return toast({ title: "Fluff found nothing to copy yet", description: "Your sections are empty." });
    try {
      await navigator.clipboard.writeText(markup);
      toast({ title: "Fluff copied it", description: "Your sections, as plain markup: paste them anywhere; Parse manager → Import markup brings them in." });
    } catch {
      toast({ title: "Fluff couldn't reach the clipboard", description: "Parse manager → Copy markup shows the text to copy by hand.", variant: "destructive" });
    }
  };
  const viewLabel = NAV.find((n) => n.id === view)?.label ?? view;
  const sections = useSections(NAV); // your order (the ≡ handles), for the narrow window's bar too

  const doPlayAll = async () => {
    if (dryRun && !running) {
      // gentle heads-up the first time is unnecessary — dry run is safe
    }
    const err = await startPlay("all");
    if (err) toast({ title: "Fluff couldn't play it", description: err, variant: "destructive" });
  };

  const toggleLive = () => {
    if (dryRun) {
      toast({
        title: "Live mode ON",
        description: "Play will now execute commands on this machine for real.",
        variant: "destructive",
      });
    }
    toggleDryRun();
  };

  const doRefresh = async () => {
    const { done, failed } = await refreshKnowledge();
    toast({
      title: failed.length ? "Refreshed, with gaps" : "Knowledge refreshed",
      description: done.join(" · ") + (failed.length ? ` — could not read: ${failed.join(", ")}` : ""),
      variant: failed.length ? "destructive" : undefined,
    });
  };

  const exportData = async () => {
    try {
      const saved = await exportBackup();
      if (saved) toast({ title: "Fluff saved the backup", description: savedNote(saved, exportSigner()) });
    } catch (err) {
      toast({ title: "Fluff couldn't export it", description: errText(err), variant: "destructive" });
    }
  };

  // opened through TuxCopilot's own picker, so its checksum and signature are checked too
  const importData = async () => {
    try {
      const file = await openFile("backup");
      if (!file) return;
      const verdict = importVerdict(file.integrity);
      if (!verdict.ok) return toast({ title: "Fluff refused the import", description: verdict.note, variant: "destructive" });
      const data = prepareBackup(decodeText(file.base64));
      useArch.getState().importNodes(data.roots, "replace", `Restore backup (${data.total} nodes)`);
      toast({ title: "Backup loaded — pending", description: `${data.total} nodes replace your tree when you Apply. ${verdict.note}` });
    } catch (err) {
      toast({
        title: "Import failed",
        description: errText(err, "Invalid file"),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Mobile top nav */}
      <nav className="flex items-center gap-1 border-b px-2 py-1.5 md:hidden" aria-label="Sections">
        <Logo />
        <div className="ml-auto flex min-w-0 gap-1 overflow-x-auto">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              data-guide={`nav-${id}`}
              onClick={() => setView(id)}
              className={`rounded p-1.5 ${view === id ? "bg-accent text-primary" : "text-muted-foreground"}`}
              aria-label={label}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      </nav>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside className="hidden min-h-0 w-52 shrink-0 flex-col border-r bg-sidebar md:flex">
          <div className="flex items-center gap-2 p-4">
            <Logo />
          </div>
          <SectionNav nav={NAV} />
          <div className="space-y-1 border-t p-2">
            <p className="px-2 pb-1 text-[10px] leading-relaxed text-muted-foreground">
              {profile
                ? `${profile.osName}${profile.desktop ? ` · ${profile.desktop}` : ""} · ${profile.core.length} core packages protected`
                : "Learning this machine…"}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-xs text-muted-foreground"
              onClick={() => setParseManagerOpen(true)}
            >
              <ClipboardList className="h-3.5 w-3.5" /> Parse manager
            </Button>
          </div>
        </aside>

        {/* Main */}
        <main className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="flex items-center gap-1.5 border-b px-3 py-2.5">
            <NavButtons />
            <h1 className="shrink-0 text-sm font-semibold">{viewLabel}</h1>
            <Button size="sm" variant="outline" className="h-7 shrink-0 gap-1 px-2 text-[11px]" title="Ask Fluff: questions about your computer, answered by your local model" onClick={() => setAskOpen(true)}>
              <MessageCircleQuestion className="h-3.5 w-3.5" /> <span className="hidden xl:inline">Ask Fluff</span>
            </Button>
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    data-guide="dryrun"
                    onClick={toggleLive}
                    className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] transition-colors ${
                      dryRun
                        ? "border-dry/50 bg-dry/10 text-dry"
                        : "border-destructive/60 bg-destructive/10 text-destructive"
                    }`}
                  >
                    {dryRun ? <TriangleAlert className="h-3 w-3" /> : <TriangleAlert className="h-3 w-3" />}
                    {dryRun ? "Dry Run" : "LIVE"}
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-[240px] text-xs">
                  {dryRun
                    ? "Dry Run: Play shows the composed script without executing. Click to go live."
                    : "LIVE: Play executes commands on this machine. Click to go back to Dry Run."}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={toggleNeeded}
                    className={`shrink-0 whitespace-nowrap rounded-md border px-2 py-1 font-mono text-[11px] transition-colors ${
                      needed ? "border-border text-muted-foreground" : "border-border text-muted-foreground/50 line-through"
                    }`}
                  >
                    --needed
                  </button>
                </TooltipTrigger>
                <TooltipContent className="text-xs">
                  {needed ? "--needed integrated in pacman/yay installs" : "--needed disabled for pacman/yay installs"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <div className="ml-auto flex items-center gap-1.5">
              {/* pending changes: undo / redo / apply / discard */}
              <ChangesBar />
              <span className="mx-1 hidden h-4 w-px bg-border md:block" />
              {/* Top-bar data tools: refresh / export / import / parse manager */}
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1.5 px-2 text-[11px]"
                      onClick={doRefresh}
                      disabled={refreshing}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                      <span className="hidden xl:inline">{refreshing ? "Refreshing…" : "Refresh"}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[260px] text-xs">
                    re-learn this machine: its OS and core system, installed apps, hardware, the commands it
                    knows and Ollama — everything the app's advice is based on
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-[11px]" onClick={exportData}>
                      <Download className="h-3.5 w-3.5" />
                      <span className="hidden xl:inline">Export</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">download the whole set-up as a JSON backup</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-[11px]" onClick={importData}>
                      <Upload className="h-3.5 w-3.5" />
                      <span className="hidden xl:inline">Import</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">restore from a JSON backup file</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-[11px]" onClick={copySetup}>
                      <Copy className="h-3.5 w-3.5" />
                      <span className="hidden xl:inline">Copy</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[240px] text-xs">copy your sections as plain markup, to paste and share (anyone can bring it in with Parse manager)</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1.5 px-2 text-[11px] text-primary hover:text-primary"
                      onClick={() => setParseManagerOpen(true)}
                    >
                      <ClipboardList className="h-3.5 w-3.5" />
                      <span className="hidden xl:inline">Parse manager</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">
                    copy your tree as &lt;section&gt; markup, or paste markup to import
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <span className="mx-1 hidden h-4 w-px bg-border md:block" />
              {running && (
                <span className="flex items-center gap-1.5 text-[11px] text-primary">
                  <span className="running-dot h-2 w-2 rounded-full bg-primary" />
                  running{run && run.steps.length > 0 ? ` ${run.currentStepIndex + 1}/${run.steps.length}` : ""}
                </span>
              )}
              {running ? (
                <Button size="sm" variant="destructive" className="gap-1.5" onClick={stopRun}>
                  <Square className="h-3.5 w-3.5" /> Stop
                </Button>
              ) : (
                <Button size="sm" className="shrink-0 gap-1.5 whitespace-nowrap" onClick={doPlayAll} title="Play All: run every section that is switched on">
                  <Play className="h-3.5 w-3.5" /> <span className="hidden xl:inline">Play All</span>
                </Button>
              )}
            </div>
          </header>

          {/* View content */}
          <PageScroll>
            {view === "home" && <HomeView />}
            {view === "commands" && <CommandsView />}
            {view === "apps" && <AppsView />}
            {view === "appmanager" && <AppManagerView />}
            {view === "ports" && <PortsPanel />}
            {view === "git" && <GitPanel />}
            {view === "docker" && <DockerView />}
            {view === "tor" && <TorView />}
            {view === "services" && <ServicesView />}
            {view === "troubleshoot" && <TroubleshootView />}
            {view === "updates" && <UpdatesView />}
            {view === "security" && <SecurityView />}
            {view === "feedback" && <FeedbackView sections={sections.filter((n) => n.id !== "feedback").map((n) => n.label)} />}
            {view === "ollama" && <OllamaView />}
            {view === "history" && <HistoryView />}
            {view === "settings" && <SettingsView />}
          </PageScroll>

          {/* Terminal drawer */}
          <TerminalPanel />
        </main>
      </div>

      <ParseManagerDialog open={parseManagerOpen} onClose={() => setParseManagerOpen(false)} />
      <ConfirmRunDialog />
      <WreckDialog />
      <HandsCheckDialog />
      <AskFluff open={askOpen} onClose={() => setAskOpen(false)} />
      <WelcomeDialog />
      <Guide />
    </div>
  );
}

function Logo() {
  const icon = useArch((s) => s.look.icon);
  const src = useMemo(() => iconUrl(icon), [icon]);
  return (
    <div className="flex items-center gap-2">
      <img src={src} alt="" className="h-7 w-7" />
      <div className="leading-none">
        <div className="text-sm font-bold tracking-tight">
          Tux<span className="text-primary">Copilot</span>
        </div>
        <div className="text-[9px] uppercase tracking-widest text-muted-foreground">btw i use arch</div>
      </div>
    </div>
  );
}
