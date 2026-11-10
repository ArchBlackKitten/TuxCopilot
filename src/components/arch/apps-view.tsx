import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Play, Copy, Plus, Pencil, Trash2, BookOpen } from "lucide-react";
import { Github, Package, Anvil, Bot, Boxes, Box, Wrench } from "lucide-react";
import { AppLink, AppLinks } from "./app-link";
import { useArch } from "./store";
import { flattenTree, SOURCE_PREFIX } from "./bits";
import { SourceLinkIcon } from "./source-link";
import { ReadmeDialog } from "./readme-dialog";
import { NodeDialog, emptyDraft, draftFromNode, type NodeDraft } from "./node-dialog";
import { useToast } from "@/hooks/use-toast";
import { checkRemovals, installedApps, packagingTools, removedFromMachine, type RemovedApp, type SnapState } from "@/lib/api";
import { appsHere, aurCommand, flatpakCommand as flatpakAgain, hereFor, pacmanCommand, type AppsHere } from "@/lib/penguin";
import { pendingRemovedAnswers } from "@/lib/changes";
import { FluffSays } from "./fluff-says";
import { AppPage } from "./app-page";
import { SafeToRemove } from "./safe-to-remove";
import { FLATPAK_SETUP, SNAP_SETUP, SNAP_START, flatpakCommand, snapCommand } from "@/lib/composer";
import type { NodeDTO, Source } from "@/lib/types";
import { TuxTag } from "./tux-tag";
import { tuxPackage } from "@/lib/tux-own";

const GROUPS: Array<{ source: Source; icon: typeof Package; blurb: string; color: string }> = [
  { source: "pacman", icon: Package, blurb: "official repos", color: "text-sky-400" },
  { source: "yay", icon: Anvil, blurb: "AUR helpers", color: "text-amber-400" },
  { source: "github", icon: Github, blurb: "git clones", color: "text-violet-400" },
  { source: "ollama", icon: Bot, blurb: "local LLMs", color: "text-emerald-400" },
  { source: "flatpak", icon: Boxes, blurb: "sandboxed apps from Flathub", color: "text-indigo-400" },
  { source: "snap", icon: Box, blurb: "sandboxed apps from the Snap Store", color: "text-orange-400" },
];

/** What a Flatpaks / Snaps section says when its tool is not ready, and the button that fixes it. */
function toolGap(source: Source, tools: { flatpak: boolean; snap: SnapState } | null) {
  if (!tools) return null;
  if (source === "flatpak" && !tools.flatpak)
    return { text: "flatpak is not installed.", button: "Set up flatpak", command: FLATPAK_SETUP };
  if (source === "snap" && tools.snap === "missing")
    return { text: "snap is not installed (snapd comes from the AUR).", button: "Set up snap", command: SNAP_SETUP };
  if (source === "snap" && tools.snap === "stopped")
    return { text: "snapd is installed but its service is not running, so snaps can't be listed or installed.", button: "Start snapd", command: SNAP_START };
  return null;
}

// The user's requested explainer text, shown in the book popup
const SYNC_OPTIONS = [
  {
    flag: "-Sy",
    text: "refresh the package databases, but don't upgrade installed packages. This can leave your system in a partial-upgrade state if you then install or upgrade individual packages.",
  },
  {
    flag: "-Syy",
    text: "force-refresh the databases, even if they appear current. Usually only needed to fix stale or inconsistent database files.",
  },
  {
    flag: "-Syu",
    text: "refresh databases and upgrade all installed packages. This is the normal full-system update.",
  },
  {
    flag: "-Syyuu",
    text: "force-refresh databases, then upgrade or downgrade packages as needed to match the versions in the sync databases. The doubled u permits downgrades; this is mainly for recovery or when switching repositories, not routine updates.",
  },
];

export function AppsView() {
  const { appPage } = useArch();
  return appPage ? <AppPage key={`${appPage.source}:${appPage.app}`} app={appPage.app} source={appPage.source} /> : <AppsLists />;
}

/**
 * Your apps: every app on this computer, and the ones removed from it, which stay listed
 * (marked removed, with Install again) until you forget them. Fluff asks once for each.
 */
function InstalledApps() {
  const { openAppPage, machineVersion, history, stageChange, runQuick, dryRun } = useArch();
  const { toast } = useToast();
  const [apps, setApps] = useState<Array<{ name: string; kind: string }> | null>(null);
  const [removed, setRemoved] = useState<Array<RemovedApp & { kept: boolean }>>([]);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    installedApps().then(setApps, () => setApps([]));
    void checkRemovals()
      .catch(() => {})
      .then(() => removedFromMachine())
      .then(setRemoved, () => setRemoved([]));
  }, [machineVersion]);
  const answers = pendingRemovedAnswers(history.pending);
  const stillListed = removed.filter((r) => answers.get(r.app) !== "forget");
  const unanswered = stillListed.filter((r) => !r.kept && !answers.has(r.app));
  const f = filter.trim().toLowerCase();
  const shown = (apps ?? []).filter((a) => a.name.toLowerCase().includes(f));
  const shownRemoved = stillListed.filter((r) => r.app.toLowerCase().includes(f));
  const answer = (list: string[], a: "keep" | "forget") =>
    stageChange({ kind: "apps.removed", label: `${a === "keep" ? "Keep" : "Forget"} ${list.length === 1 ? list[0] : `${list.length} removed apps`} in Your apps`, apps: list, answer: a });
  const installAgain = async (r: RemovedApp) => {
    let command: string;
    try {
      command = r.source === "aur" ? aurCommand([r.app]) : r.source === "flatpak" ? flatpakAgain([r.app]) : pacmanCommand([r.app]);
    } catch (e) {
      return toast({ title: "Fluff can't install that one", description: String(e), variant: "destructive" });
    }
    const err = await runQuick(`Install ${r.app} again`, command, dryRun);
    if (err) toast({ title: "Fluff couldn't install it", description: err, variant: "destructive" });
  };
  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-3">
        <span className="text-sm font-semibold">Your apps</span>
        <Badge variant="outline" className="text-[10px] text-muted-foreground">{apps?.length ?? "…"} on this computer</Badge>
        {stillListed.length > 0 && <Badge variant="outline" className="text-[10px] text-muted-foreground">{stillListed.length} removed</Badge>}
        <span className="text-[11px] text-muted-foreground">click an app: how it works, what it needs, what you can change</span>
        <input
          className="ml-auto h-7 w-40 rounded-md border bg-transparent px-2 text-xs"
          placeholder="find an app…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {unanswered.length > 0 && (
        <div className="border-b border-border/60 p-3">
          <FluffSays
            title="Fluff asks"
            action={
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => answer(unanswered.map((r) => r.app), "keep")}>
                  Keep {unanswered.length === 1 ? "it" : "them"} listed
                </Button>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => answer(unanswered.map((r) => r.app), "forget")}>
                  Forget {unanswered.length === 1 ? "it" : "them"}
                </Button>
              </div>
            }
          >
            <b>{unanswered.map((r) => r.app).join(", ")}</b> {unanswered.length === 1 ? "was" : "were"} removed from this computer. Keep{" "}
            {unanswered.length === 1 ? "it" : "them"} in Your apps — to install again later with one click — or forget{" "}
            {unanswered.length === 1 ? "it" : "them"}? (Apply keeps your answer.)
          </FluffSays>
        </div>
      )}
      <div className="flex max-h-48 flex-wrap gap-1 overflow-y-auto p-3">
        {shown.map((a) => (
          <button
            key={`${a.kind}:${a.name}`}
            onClick={() => openAppPage(a.name, a.kind)}
            className="rounded-md border px-2 py-0.5 text-[11px] transition-colors hover:border-primary/50 hover:bg-primary/10"
            title={`${a.name}
            {tuxPackage(a.name) && <TuxTag why={tuxPackage(a.name)!} />} (${a.kind})`}
          >
            {a.name}
          </button>
        ))}
        {shownRemoved.map((r) => (
          <span key={`removed:${r.app}`} className="flex items-center gap-1 rounded-md border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground" title={`removed ${new Date(r.noticedAt).toLocaleDateString()}`}>
            {r.app}
            <Badge variant="outline" className="px-1 py-0 text-[9px]">removed</Badge>
            <button className="text-[10px] text-primary hover:underline" onClick={() => void installAgain(r)}>
              install again
            </button>
            <button className="text-[10px] hover:underline" title="forget it" onClick={() => answer([r.app], "forget")}>
              ×
            </button>
          </span>
        ))}
        {apps && shown.length === 0 && shownRemoved.length === 0 && <span className="text-[11px] text-muted-foreground">no app matches</span>}
      </div>
    </div>
  );
}

function AppsLists() {
  const { tree, loadTree, startPlay, runQuick, needed, toggleNeeded, dryRun, nodeUpdate, nodeDelete, machineVersion } = useArch();
  const [tools, setTools] = useState<{ flatpak: boolean; snap: SnapState } | null>(null);
  const [here, setHere] = useState<AppsHere | null>(null); // what is installed here, as moving house takes it
  useEffect(() => {
    // read again after every real run, so "Set up" disappears once it worked
    packagingTools().then(setTools, () => setTools(null));
    appsHere().then(setHere, () => setHere(null));
  }, [machineVersion]);
  const { toast } = useToast();
  const [dialog, setDialog] = useState<{ open: boolean; draft: NodeDraft | null }>({
    open: false,
    draft: null,
  });
  const [bookOpen, setBookOpen] = useState(false);
  const [readmeRepo, setReadmeRepo] = useState<string | null>(null);
  const [quickBusy, setQuickBusy] = useState<string | null>(null);

  // All download-category items with content, flattened
  const apps = useMemo(
    () =>
      flattenTree(tree, [], (n) => Boolean(n.content?.trim()) && n.category === "download").filter(
        ({ node }) => node.content?.trim()
      ),
    [tree]
  );

  const bySource = (s: Source) => apps.filter(({ node }) => node.source === s);
  const unsorted = apps.filter(({ node }) => !node.source);

  const toggle = (node: NodeDTO, enabled: boolean) =>
    nodeUpdate(node.id, { enabled }, `${enabled ? "Switch on" : "Switch off"} "${node.name}"`);

  const remove = (node: NodeDTO) => {
    if (!window.confirm(`Remove "${node.name}"?`)) return;
    nodeDelete(node.id, `Remove "${node.name}"`);
    toast({ title: "Removed — pending", description: `${node.name} · Apply to save, or Undo` });
  };

  const copyFor = (node: NodeDTO) => {
    const content = node.content?.trim() ?? "";
    const text =
      node.source === "github"
        ? content.startsWith("http")
          ? `git clone ${content}`
          : `git clone https://github.com/${content.replace(/\.git$/, "")}.git`
        : node.source === "ollama"
          ? `ollama pull ${content}`
          : node.source === "flatpak"
            ? flatpakCommand(content.split(/\s+/).filter(Boolean))
            : node.source === "snap"
              ? content.split(/\s+/).filter((t) => t && !t.startsWith("-")).map((n) => snapCommand(n, /--classic/.test(content))).join(" && ")
              : node.source
            ? `${node.source === "pacman" ? "sudo pacman -Syu" : "yay -Syu"}${needed ? " --needed" : ""} ${content}`
            : content;
    navigator.clipboard.writeText(text);
    toast({ title: "Fluff copied it", description: text.slice(0, 70) });
  };

  const playGroup = async (s: Source) => {
    // Play the first parent section that holds items of this source
    const items = bySource(s);
    if (items.length === 0) return;
    const first = items[0].node;
    const err = await startPlay(first.id);
    if (err) toast({ title: "Fluff couldn't play it", description: err, variant: "destructive" });
  };

  const quickSync = async (label: string, command: string) => {
    setQuickBusy(label);
    const err = await runQuick(label, command, dryRun);
    setQuickBusy(null);
    if (err) toast({ title: `Fluff couldn't finish: ${label}`, description: err, variant: "destructive" });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="h-6 px-2 text-[11px] font-normal">
          {apps.length} app{apps.length === 1 ? "" : "s"}
        </Badge>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleNeeded}
                className={`rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                  needed
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground line-through"
                }`}
              >
                --needed
              </button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">
              {needed
                ? "--needed is integrated into pacman/yay installs (skips up-to-date packages)"
                : "--needed disabled — pacman will reinstall even if up to date"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <p className="hidden text-[11px] text-muted-foreground md:block">
          click a source symbol to open its real page — greyed out means not found
        </p>
      </div>

      <InstalledApps />
      <SafeToRemove />

      {GROUPS.map(({ source, icon: Icon, blurb, color }) => {
        const items = bySource(source);
        const onHere = hereFor(source, here, items.map(({ node }) => node.content ?? ""));
        return (
          <div key={source} className="overflow-hidden rounded-md border bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-3">
              <Icon className={`h-4 w-4 ${color}`} />
              <span className="text-sm font-semibold capitalize">{source}</span>
              <span className="text-[11px] text-muted-foreground">{blurb}</span>
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {SOURCE_PREFIX[source]}
                {(source === "pacman" || source === "yay") && !needed ? " (off)" : ""}
              </code>
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                {items.length}
              </Badge>

              {(() => {
                const gap = toolGap(source, tools);
                return (
                  gap && (
                    <span className="flex items-center gap-1.5 text-[11px] text-amber-300">
                      {gap.text}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={quickBusy !== null}
                        className="h-6 gap-1 px-2 text-[11px]"
                        title={gap.command}
                        onClick={() => quickSync(gap.button, gap.command)}
                      >
                        <Wrench className="h-3 w-3" /> {gap.button}
                      </Button>
                    </span>
                  )
                );
              })()}

              {/* pacman sync/update denominations + book */}
              {source === "pacman" && (
                <TooltipProvider delayDuration={300}>
                  <div className="flex items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={quickBusy !== null}
                          className="h-7 px-2 font-mono text-[11px]"
                          onClick={() => quickSync("pacman -Syy", "sudo pacman -Syy")}
                        >
                          -Syy
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">force-refresh the package databases</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={quickBusy !== null}
                          className="h-7 px-2 font-mono text-[11px]"
                          onClick={() => quickSync("pacman -Syu", "sudo pacman -Syu --noconfirm")}
                        >
                          -Syu
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">refresh databases + full-system upgrade</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 px-0 text-primary hover:text-primary"
                          onClick={() => setBookOpen(true)}
                          aria-label="pacman sync/update options"
                        >
                          <BookOpen className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">what do -Sy / -Syy / -Syu / -Syyuu mean?</TooltipContent>
                    </Tooltip>
                  </div>
                </TooltipProvider>
              )}

              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-[11px]"
                  onClick={() =>
                    setDialog({
                      open: true,
                      draft: { ...emptyDraft(null), kind: "item", category: "download", source },
                    })
                  }
                >
                  <Plus className="h-3 w-3" /> Add
                </Button>
                {items.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 px-2 text-[11px] text-primary hover:text-primary"
                    onClick={() => playGroup(source)}
                  >
                    <Play className="h-3 w-3" /> Play group
                  </Button>
                )}
              </div>
            </div>
            {onHere.length > 0 && (
              <details open className="border-b border-border/60 px-3 py-2">
                <summary className="cursor-pointer text-[11px] text-muted-foreground">
                  On this computer ({onHere.length}) — read from the system; they move house with Fluff
                </summary>
                <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1">
                  {onHere.map((a) =>
                    source === "pacman" || source === "yay" ? (
                      <AppLink key={a.name} name={a.name} source={source === "yay" ? "aur" : "pacman"} className="text-[11px]" />
                    ) : (
                      <span key={a.name} className="font-mono text-[11px]" title={a.detail}>
                        {a.name}
                        {a.detail && <span className="text-muted-foreground"> ({a.detail})</span>}
                      </span>
                    ),
                  )}
                </div>
              </details>
            )}
            {items.length === 0 ? (
              onHere.length === 0 && (
                <p className="p-4 text-center text-xs text-muted-foreground">
                  Nothing here yet — add apps with source “{source}”.
                </p>
              )
            ) : (
              <div className="divide-y divide-border/60">
                {items.map(({ node, path }) => (
                  <div key={node.id} className="group flex items-center gap-2 px-3 py-1.5 hover:bg-accent/40">
                    {node.source && (
                      <SourceLinkIcon source={node.source} content={node.content?.trim() ?? ""} name={node.name} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{node.name}</span>
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">
                        {node.source === "pacman" || node.source === "yay" ? (
                          <AppLinks names={(node.content ?? "").split(/[\s,]+/).filter((t) => t && !t.startsWith("#"))} source={node.source === "yay" ? "aur" : "pacman"} sep=" " />
                        ) : (
                          node.content?.trim()
                        )}
                      </span>
                    </span>
                    <span className="hidden max-w-[180px] truncate text-[10px] text-muted-foreground md:block">
                      {path.map((p) => p.name).join(" › ")}
                    </span>
                    {node.source === "github" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-primary hover:text-primary"
                        title="Instruction look up — read the official README"
                        onClick={() => setReadmeRepo(node.content?.trim() ?? null)}
                      >
                        <BookOpen className="h-3 w-3" />
                      </Button>
                    )}
                    <Switch
                      checked={node.enabled}
                      onCheckedChange={(v) => toggle(node, v)}
                      className="scale-[0.8]"
                      aria-label={`Include ${node.name} in Play`}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => copyFor(node)}
                      title="Copy install command"
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100"
                      onClick={() => setDialog({ open: true, draft: draftFromNode(node) })}
                      title="Edit"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-destructive opacity-0 hover:text-destructive group-hover:opacity-100"
                      onClick={() => remove(node)}
                      title="Remove"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {unsorted.length > 0 && (
        <div className="overflow-hidden rounded-md border bg-card">
          <div className="border-b border-border/60 p-3 text-sm font-semibold text-muted-foreground">
            Unsorted downloads <span className="text-[11px] font-normal">(no source set)</span>
          </div>
          <div className="divide-y divide-border/60">
            {unsorted.map(({ node, path }) => (
              <div key={node.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-xs">{node.name}</span>
                <span className="hidden text-[10px] text-muted-foreground md:block">
                  {path.map((p) => p.name).join(" › ")}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => setDialog({ open: true, draft: draftFromNode(node) })}
                  title="Edit to set a source"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <NodeDialog
        open={dialog.open}
        draft={dialog.draft}
        onClose={() => setDialog({ open: false, draft: null })}
        onSaved={loadTree}
      />

      <ReadmeDialog open={readmeRepo !== null} repo={readmeRepo} onClose={() => setReadmeRepo(null)} />

      {/* Book popup — pacman sync/update options */}
      <Dialog open={bookOpen} onOpenChange={setBookOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <BookOpen className="h-4 w-4 text-primary" />
              pacman sync/update options
            </DialogTitle>
            <DialogDescription className="text-xs">
              These are pacman sync/update options:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2.5">
            {SYNC_OPTIONS.map(({ flag, text }) => (
              <div key={flag} className="rounded-md border border-border/60 bg-muted/30 p-2.5">
                <code className="font-mono text-xs font-bold text-primary">{flag}</code>
                <span className="ml-2 text-[11px] leading-relaxed text-foreground/85">— {text}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Rule of thumb: routine update = -Syu. Reach for -Syy (and -Syyuu) only when something is broken.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
