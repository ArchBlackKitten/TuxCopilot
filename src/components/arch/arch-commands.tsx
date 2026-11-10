// "Arch Commands" — type a command in the block below and this panel:
//   1. validates every token against a curated Arch KB + entries discovered
//      on THIS machine (--help parsing, installed packages),
//   2. proposes "did you mean" chips for anything wrong — click to fix,
//   3. explains each flag/subcommand and what the mix does together,
//   4. raises Arch-specific warnings (partial upgrades, sudo+yay, forced push…).
//
// ─── Perfected for fresh Arch beginners ─────────────────────────────────────
//   • "Start here" rail — the eight commands a fresh archer meets first,
//     one tap loads them into the explainer.
//   • Plain token roles — each token now carries a beginner-readable caption
//     ("an option of pacman", "a package name", "a value you fill in")
//     instead of the bare role word.
//   • "What happens when you press Enter" preview — a one-line intent summary
//     built from the segments + warnings, shown above the warnings.
//   • Keyboard nav on the describe-it search — ↑ ↓ walks matches, Enter loads.
//   • Inline "?" help overlay — explains what each part of the panel does.

import { archKb, archSync } from "@/lib/arch-sync";
import { errText } from "@/lib/host";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  RefreshCw,
  Wand2,
  TriangleAlert,
  Info,
  OctagonAlert,
  CircleCheck,
  BookOpen,
  ChevronRight,
  Sparkles,
  MessageSquareText,
  HelpCircle,
  Rocket,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  Bot,
} from "lucide-react";
import { searchCommands } from "@/lib/command-search";
import { CommandText } from "./command-text";
import { useArch } from "./store";
import { explainCommand, buildSuggestionsMap, plainLabel, type ExplainResult } from "@/lib/arch-explain";
import { KNOWN_BINARIES } from "@/lib/arch-kb";
import { CATALOG, groups, commandDoc } from "@/lib/commands/catalog";
import type { KbItem } from "@/lib/arch-kb";
import { useToast } from "@/hooks/use-toast";
import { AiRefreshDialog } from "./ai-refresh-dialog";

interface KbState {
  dynamic: Record<string, Array<{ token: string; kind: string; meaning: string }>>;
  installed: string[];
  lastSync: { at: string; found: string[]; missing: string[]; kernel: string | null } | null;
}

/** The eight a fresh archer meets first — one tap loads them. */
const START_HERE: Array<{ label: string; command: string; why: string }> = [
  { label: "Update everything", command: "sudo pacman -Syu", why: "the normal full-system update" },
  { label: "Install an app", command: "sudo pacman -Syu --needed firefox", why: "install from the official repos" },
  { label: "Install from the AUR", command: "yay -Syu --needed brave-bin", why: "yay wraps the AUR; never sudo it" },
  { label: "Check a service", command: "systemctl status bluetooth", why: "is it running, with its last logs" },
  { label: "See why it failed", command: "journalctl -xe", why: "end of the journal + explanations" },
  { label: "What's here", command: "ls -la", why: "everything in this folder, hidden too" },
  { label: "Read the manual", command: "man pacman", why: "the whole manual for a command" },
  { label: "Download a project", command: "git clone https://aur.archlinux.org/yay-bin.git", why: "clones a repo, AUR included" },
];

const EXAMPLES = [
  "sudo pacman -Sy neofetch",
  "pacman -Syyu",
  "sudo pacman -R firefox",
  "yay -Sy google-chrome",
  "git push origin main",
  "git comit -m 'fix mirrorlist'",
  "sudo systemctl enable NetworkManager",
  "journalctl -xe",
  "sudo pacman -Sy linux-zen",
];

export function ArchCommands() {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [kb, setKb] = useState<KbState>({ dynamic: {}, installed: [], lastSync: null });
  const [kbLoading, setKbLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState("");
  const [toolTab, setToolTab] = useState<string>("all");
  const openCommand = useArch((st) => st.openCommand);
  const [liveResult, setLiveResult] = useState<ExplainResult | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [describe, setDescribe] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [aiRefreshOpen, setAiRefreshOpen] = useState(false);

  // "Explain" pressed on a saved command somewhere else: load it here
  const explainTarget = useArch((st) => st.explainTarget);
  useEffect(() => {
    if (explainTarget) setInput(explainTarget.command);
  }, [explainTarget]);

  const loadKb = useCallback(async () => {
    try {
      setKb((await archKb()) as KbState);
    } catch {
      // keep empty
    } finally {
      setKbLoading(false);
    }
  }, []);

  useEffect(() => {
    loadKb();
  }, [loadKb]);

  // live explain (debounced)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const text = input.trim();
    if (!text) {
      setLiveResult(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setLiveResult(
        explainCommand(text, { installed: kb.installed, dynamic: dynamicToKbItems(kb.dynamic) })
      );
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [input, kb]);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const data = await archSync();
      toast({
        title: "Fluff learned what this computer knows",
        description: `From: ${data.found.join(", ") || "nothing"} · ${data.newEntries} new entries${
          data.installedCount ? ` · ${data.installedCount} packages cached` : ""
        }${data.note ? ` — ${data.note}` : ""}`,
      });
      await loadKb();
    } catch (err) {
      toast({
        title: "Fluff couldn't sync",
        description: errText(err, "Fluff doesn't know why"),
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  };

  const matches = useMemo(
    () => (describe.trim() ? searchCommands(describe, dynamicToKbItems(kb.dynamic)) : []),
    [describe, kb.dynamic]
  );

  // keep matchIndex in range as matches change
  useEffect(() => {
    setMatchIndex((i) => (matches.length === 0 ? 0 : Math.min(i, matches.length - 1)));
  }, [matches.length]);

  const suggestions = useMemo(
    () => (liveResult ? buildSuggestionsMap(liveResult) : []),
    [liveResult]
  );

  /** Replace the first occurrence of a wrong token with the picked suggestion. */
  const applySuggestion = (wrong: string, suggestion: string) => {
    setInput((prev) => {
      const idx = prev.indexOf(wrong);
      if (idx === -1) return prev;
      return prev.slice(0, idx) + suggestion + prev.slice(idx + wrong.length);
    });
  };

  // keyboard nav on the describe-it search: ↑ ↓ walks matches, Enter loads
  const onDescribeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMatchIndex((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMatchIndex((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const m = matches[matchIndex];
      if (m) setInput(m.command);
    }
  };

  // ------------------------------------------------------------- reference browser
  const tool = KNOWN_BINARIES.find((t) => t.binary === toolTab);
  const dynamicForTool = kb.dynamic[toolTab] ?? [];
  const curatedTokens = new Set(tool?.items.map((i) => i.token) ?? []);
  const extraDynamic = dynamicForTool.filter((d) => !curatedTokens.has(d.token));

  const refQuery = filter.trim().toLowerCase();
  const curatedItems = (tool?.items ?? []).filter(
    (i) =>
      !refQuery ||
      i.token.toLowerCase().includes(refQuery) ||
      i.meaning.toLowerCase().includes(refQuery)
  );

  /** Every token row in a per-tool tab is clickable:
   *  • if the token is itself a catalogue command (e.g. mkinitcpio in the system tab) → open its page;
   *  • else if the item has an example → load the example into the explainer;
   *  • else in the system tab → load just the token (its flag parent isn't tracked);
   *  • else → load `<binary> <token>` (e.g. `pacman -S`, `git clone`). */
  const onTokenClick = (item: KbItem) => {
    if (commandDoc(item.token)) {
      openCommand(item.token);
    } else if (item.example) {
      setInput(item.example);
    } else if (toolTab === "system") {
      setInput(item.token);
    } else {
      setInput(`${toolTab} ${item.token}`);
    }
  };

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <div className="flex-1">
          <p className="text-xs text-muted-foreground">
            Self-updating Arch command reference: type or paste a command — get meanings, fixes and warnings.
            Known entries come from pacman / yay / git / systemctl / journalctl on this machine.
          </p>
        </div>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]" onClick={() => setHelpOpen((v) => !v)}>
                <HelpCircle className="h-3 w-3" /> What does this do?
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[260px] text-xs">
              A short tour of what each part of this panel is for.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-[11px] text-primary hover:text-primary"
                onClick={() => setAiRefreshOpen(true)}
              >
                <Bot className="h-3 w-3" /> Ask AI to refresh
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[300px] text-xs">
              Give an AI of your choice what Fluff knows about commands; paste its answer back. Fluff
              shows only what it would add (gaps and new --help options), and what you tick waits for
              Apply. It moves house with Fluff.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]" onClick={syncNow} disabled={syncing}>
                <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} /> Sync from system
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[260px] text-xs">
              Runs read-only <code>pacman/yay/git/systemctl --help</code> and <code>pacman -Qq</code> on this
              machine and merges what it learns into the reference.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {kb.lastSync && (
          <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
            last sync {new Date(kb.lastSync.at).toLocaleString()}
            {kb.lastSync.kernel ? ` · ${kb.lastSync.kernel}` : ""}
          </Badge>
        )}
      </div>

      {/* ── Start here rail ───────────────────────────────────────────────────── */}
      <div className="rounded-md border bg-card p-2.5">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
          <Rocket className="h-3.5 w-3.5 text-primary" /> Start here — the eight you meet first
        </div>
        <div className="flex flex-wrap gap-1.5">
          {START_HERE.map((s) => (
            <button
              key={s.label}
              onClick={() => setInput(s.command)}
              title={s.why}
              className="group flex items-center gap-1.5 rounded border border-border/60 bg-muted/30 px-2 py-1 text-[11px] transition-colors hover:border-primary/50 hover:bg-primary/5"
            >
              <span className="font-semibold text-foreground/90">{s.label}</span>
              <code className="font-mono text-[10px] text-muted-foreground group-hover:text-primary">{s.command}</code>
            </button>
          ))}
        </div>
      </div>

      {/* ── Help overlay ─────────────────────────────────────────────────────── */}
      {helpOpen && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-[11px] leading-relaxed text-foreground/80">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
            <HelpCircle className="h-3.5 w-3.5 text-primary" /> How this panel works
          </div>
          <ul className="ml-4 list-disc space-y-1">
            <li><b>Start here</b> — one tap loads the command a beginner reaches for first.</li>
            <li><b>Describe it in words</b> — type what you want to do ("update everything"); the matches update live. <ArrowUp className="inline h-3 w-3" /><ArrowDown className="inline h-3 w-3" /> walk them, <CornerDownLeft className="inline h-3 w-3" /> loads one into the explainer.</li>
            <li><b>Your command</b> — type or paste a command (or a whole pipeline). It is explained token by token as you type.</li>
            <li><b>Did you mean…</b> — anything it does not recognize is crossed out; click a green chip to fix it in place.</li>
            <li><b>What happens when you press Enter</b> — a one-line preview of the intent, before any warnings.</li>
            <li><b>Warnings</b> — partial upgrades, <code>sudo yay</code>, <code>git push --force</code>, <code>rm -rf /</code>… Click a fix to apply it; the safer alternative is the primary button.</li>
            <li><b>Reference</b> on the right — every flag and subcommand the panel knows; click <b>All commands</b> for the {CATALOG.length}-command catalogue, each one opening its own page.</li>
            <li><b>Sync from system</b> — runs read-only <code>--help</code> on this machine and adds what it learns (marked "learned").</li>
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ------------------------------------------------ explainer column */}
        <div className="space-y-3">
          {/* words → command */}
          <div className="rounded-md border bg-card p-3">
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold" htmlFor="arch-describe-input">
              <MessageSquareText className="h-3.5 w-3.5 text-primary" /> describe it in words
              {matches.length > 0 && (
                <span className="ml-auto flex items-center gap-1 text-[9px] font-normal text-muted-foreground">
                  <ArrowUp className="h-2.5 w-2.5" /><ArrowDown className="h-2.5 w-2.5" /> walk
                  <CornerDownLeft className="h-2.5 w-2.5" /> load
                </span>
              )}
            </label>
            <Input
              id="arch-describe-input"
              value={describe}
              onChange={(e) => setDescribe(e.target.value)}
              onKeyDown={onDescribeKeyDown}
              placeholder="e.g. remove packages nothing needs anymore"
              className="h-8 text-xs"
            />
            {describe.trim() && (
              <div className="mt-2 space-y-1.5">
                {matches.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    Nothing in the knowledge base fits those words. Try other words, or press Sync to learn this
                    machine's commands.
                  </p>
                ) : (
                  matches.map((m, i) => (
                    <button
                      key={m.command}
                      onClick={() => setInput(m.command)}
                      onMouseEnter={() => setMatchIndex(i)}
                      className={`block w-full rounded border px-2 py-1.5 text-left transition-colors ${
                        i === matchIndex ? "border-primary/60 bg-primary/5" : "bg-muted/30 hover:border-primary/40"
                      }`}
                      title="Explain this command below"
                    >
                      <span className="flex items-center gap-2">
                        <code className="font-mono text-[11px] text-primary"><CommandText text={m.command} line /></code>
                        {commandDoc(m.tool) ? (
                          <span
                            role="link"
                            onClick={(e) => {
                              e.stopPropagation();
                              openCommand(m.tool);
                            }}
                            className="ml-auto cursor-pointer text-[9px] text-primary underline decoration-dotted underline-offset-2"
                            title={`${m.tool}: its page`}
                          >
                            {m.tool}
                          </span>
                        ) : (
                          <span className="ml-auto text-[9px] text-muted-foreground">{m.tool}</span>
                        )}
                        <span className="h-1 w-10 overflow-hidden rounded bg-muted">
                          <span className="block h-full bg-primary/70" style={{ width: `${Math.round(m.score * 100)}%` }} />
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[10px] text-muted-foreground"><CommandText text={m.meaning} /></span>
                    </button>
                  ))
                )}
                {matches.some((m) => m.command.includes("<")) && (
                  <p className="text-[10px] text-muted-foreground">
                    Replace the parts in &lt;angle brackets&gt; with your own package, file or service.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="rounded-md border bg-card p-3">
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold" htmlFor="arch-cmd-input">
              <Wand2 className="h-3.5 w-3.5 text-primary" /> your command
            </label>
            <Textarea
              id="arch-cmd-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={"e.g.  sudo pacman -Sy neofetch\nor paste a whole pipeline:\nsudo pacman -Syyu && yay -Sua"}
              className="min-h-[72px] resize-y bg-code font-mono text-xs"
              spellCheck={false}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setInput(ex)}
                  className="rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          {/* did-you-mean chips */}
          {suggestions.length > 0 && (
            <div className="rounded-md border border-warn/40 bg-warn/5 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-warn">
                <TriangleAlert className="h-3.5 w-3.5" /> did you mean…
              </div>
              <div className="space-y-2">
                {suggestions.map(({ token, suggestions: suggs }) => (
                  <div key={token} className="flex flex-wrap items-center gap-1.5">
                    <code className="rounded bg-destructive/15 px-1.5 py-0.5 font-mono text-[11px] text-destructive line-through">
                      {token}
                    </code>
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    {suggs.map((s) => (
                      <button
                        key={s}
                        onClick={() => applySuggestion(token, s)}
                        className="rounded border border-ok/40 bg-ok/10 px-2 py-0.5 font-mono text-[11px] text-ok transition-colors hover:bg-ok/20"
                        title="click to fix the input"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground">click a suggestion to correct the input</p>
            </div>
          )}

          {/* result breakdown */}
          {liveResult && (
            <div className="rounded-md border bg-card">
              <div className="flex items-center gap-2 border-b border-border/60 p-2.5">
                {liveResult.clean ? (
                  <Badge variant="outline" className="gap-1 border-ok/40 text-[10px] text-ok">
                    <CircleCheck className="h-3 w-3" /> all tokens recognized
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 border-warn/40 text-[10px] text-warn">
                    <TriangleAlert className="h-3 w-3" /> fix the highlighted tokens
                  </Badge>
                )}
                <span className="text-[10px] text-muted-foreground">
                  {liveResult.segments.length} segment{liveResult.segments.length === 1 ? "" : "s"}
                </span>
              </div>

              {/* ── preview: "what happens when you press Enter" ─────────────────── */}
              {liveResult.preview && (
                <div className="flex items-start gap-1.5 border-b border-border/60 bg-muted/30 p-2.5 text-[11px] leading-relaxed">
                  <CornerDownLeft className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                  <span className="text-foreground/85">
                    <span className="font-semibold text-foreground">When you press Enter: </span>
                    {liveResult.preview}
                  </span>
                </div>
              )}

              <div className="divide-y divide-border/60">
                {liveResult.segments.map((seg, i) => (
                  <div key={i} className="p-2.5">
                    <div className="mb-1 flex items-center gap-1.5">
                      {seg.connector && (
                        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-warn">
                          {seg.connector}
                        </code>
                      )}
                      <code className="truncate font-mono text-[11px] text-foreground"><CommandText text={seg.text} line /></code>
                    </div>
                    <div className="space-y-0.5 pl-2">
                      {seg.tokens.map((t, j) => (
                        <div key={j} className="flex items-start gap-1.5 text-[11px]">
                          {t.role === "binary" && commandDoc(t.raw.toLowerCase()) ? (
                            <button
                              onClick={() => openCommand(t.raw.toLowerCase())}
                              title={`${t.raw}: its page — how it is used, examples, what goes with it`}
                              className="shrink-0 rounded bg-primary/10 px-1 font-mono text-primary underline decoration-dotted underline-offset-2 hover:bg-primary/20"
                            >
                              {t.raw}
                            </button>
                          ) : (
                          <code
                            className={`shrink-0 rounded px-1 font-mono ${
                              t.ok
                                ? t.role === "flag" || t.role === "sub"
                                  ? "bg-primary/10 text-primary"
                                  : "bg-muted text-muted-foreground"
                                : "bg-destructive/15 text-destructive"
                            }`}
                          >
                            {t.raw}
                          </code>
                          )}
                          <div className="min-w-0 flex-1">
                            <span className={t.ok ? "text-muted-foreground" : "text-destructive"}>
                              {t.meaning ? <CommandText text={t.meaning} /> : plainLabel(t.role, seg.binary)}
                              {t.expanded && (
                                <span className="text-muted-foreground/70"> [{t.expanded.join(" ")}]</span>
                              )}
                            </span>
                            {/* beginner-readable role caption — only when the main line carries a
                                real meaning, so plainLabel isn't shown twice for bare args/paths */}
                            {t.meaning && (
                              <div className="text-[9px] text-muted-foreground/70">{plainLabel(t.role, seg.binary)}</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {liveResult.combined && (
                <div className="border-t border-border/60 p-2.5">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
                    <BookOpen className="h-3.5 w-3.5 text-primary" /> what this mix does
                  </div>
                  <div className="whitespace-pre-line pl-5 text-[11px] leading-relaxed text-foreground/85">
                    <CommandText text={liveResult.combined} />
                  </div>
                </div>
              )}
              {liveResult.warnings.length > 0 && (
                <div className="space-y-1.5 border-t border-border/60 p-2.5">
                  {liveResult.warnings.map((w, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-1.5 rounded p-1.5 text-[11px] leading-relaxed ${
                        w.level === "danger"
                          ? "bg-destructive/10 text-destructive"
                          : w.level === "warn"
                            ? "bg-warn/10 text-warn"
                            : "bg-muted/50 text-muted-foreground"
                      }`}
                    >
                      {w.level === "danger" ? (
                        <OctagonAlert className="mt-0.5 h-3 w-3 shrink-0" />
                      ) : w.level === "warn" ? (
                        <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                      ) : (
                        <Info className="mt-0.5 h-3 w-3 shrink-0" />
                      )}
                      <span className="flex-1">
                        <CommandText text={w.text} />
                        {/* the safer alternative is the primary button; the in-place fix the secondary */}
                        {w.safeAlt && (
                          <button
                            onClick={() => setInput(w.safeAlt!)}
                            className="ml-1.5 rounded border border-primary/60 bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary transition-colors hover:bg-primary/25"
                            title="use this safer command instead"
                          >
                            {w.safeAlt}
                          </button>
                        )}
                        {w.fix && (
                          <button
                            onClick={() => setInput((prev) => applyFix(prev, w.fix!))}
                            className={`ml-1.5 rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                              w.safeAlt
                                ? "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/50"
                                : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                            }`}
                          >
                            {w.fix.startsWith("use ") ? w.fix.slice(4) : w.fix}
                          </button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ------------------------------------------------- reference column */}
        <div className="rounded-md border bg-card">
          <div className="flex flex-wrap items-center gap-1 border-b border-border/60 p-2.5">
            <button
              onClick={() => setToolTab("all")}
              className={`rounded px-2 py-1 text-[11px] transition-colors ${toolTab === "all" ? "bg-accent font-semibold text-foreground" : "text-muted-foreground hover:bg-accent/50"}`}
            >
              All commands <span className="text-[9px]">{CATALOG.length}</span>
            </button>
            <button
              onClick={() => setToolTab("installed")}
              className={`rounded px-2 py-1 text-[11px] transition-colors ${toolTab === "installed" ? "bg-accent font-semibold text-foreground" : "text-muted-foreground hover:bg-accent/50"}`}
            >
              Installed <span className="text-[9px]">{kb.installed.length}</span>
            </button>
            {KNOWN_BINARIES.map((t) => (
              <button
                key={t.binary}
                onClick={() => setToolTab(t.binary)}
                className={`rounded px-2 py-1 font-mono text-[11px] transition-colors ${
                  toolTab === t.binary
                    ? "bg-accent font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-accent/50"
                }`}
              >
                {t.binary}
                {kb.dynamic[t.binary]?.length ? (
                  <span className="ml-1 text-[9px] text-ok">●{kb.dynamic[t.binary].length}</span>
                ) : null}
              </button>
            ))}
          </div>
          {toolTab === "all" ? (
            <AllCommands filter={filter} setFilter={setFilter} open={openCommand} />
          ) : toolTab === "installed" ? (
            <InstalledPackages filter={filter} setFilter={setFilter} installed={kb.installed} open={openCommand} setInput={setInput} />
          ) : (
          <>
          <div className="p-2.5">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`filter ${toolTab} tokens…`}
              className="h-7 text-xs"
            />
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              {tool?.blurb}
              {extraDynamic.length > 0 && (
                <span className="text-ok"> · {extraDynamic.length} learned from this machine</span>
              )}
            </p>
          </div>
          <div className="max-h-[480px] divide-y divide-border/40 overflow-y-auto">
            {kbLoading ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            ) : (
              <>
                {curatedItems.map((item) => (
                  <KbRow key={item.token + item.kind} item={item} curated onClick={() => onTokenClick(item)} />
                ))}
                {extraDynamic.map((d) => {
                  const item: KbItem = { token: d.token, kind: d.kind as KbItem["kind"], meaning: d.meaning };
                  return <KbRow key={d.token + d.kind} item={item} onClick={() => onTokenClick(item)} />;
                })}
                {curatedItems.length === 0 && extraDynamic.length === 0 && (
                  <p className="p-4 text-center text-xs text-muted-foreground">no tokens match “{filter}”</p>
                )}
              </>
            )}
          </div>
          </>
          )}
        </div>
      </div>

      {/* AI refresh dialog — mounts here so it overlays the whole panel */}
      <AiRefreshDialog open={aiRefreshOpen} onClose={() => setAiRefreshOpen(false)} />
    </div>
  );
}

/** Every command in the catalogue, by group; click one for its page. */
function AllCommands({ filter, setFilter, open }: { filter: string; setFilter: (v: string) => void; open: (name: string) => void }) {
  const q = filter.trim().toLowerCase();
  const fits = (c: (typeof CATALOG)[number]) => !q || c.name.includes(q) || c.what.toLowerCase().includes(q) || c.words.some((w) => w.includes(q));
  return (
    <>
      <div className="p-2.5">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="find a command: a name, or a word like folder, disk, wifi…" className="h-7 text-xs" />
        <p className="mt-1.5 text-[10px] text-muted-foreground">Click a command for its page: how it is used, examples, what goes with it.</p>
      </div>
      <div className="max-h-[480px] space-y-2 overflow-y-auto px-2.5 pb-2.5">
        {groups().map((g) => {
          const list = CATALOG.filter((c) => c.group === g && fits(c));
          if (!list.length) return null;
          return (
            <div key={g}>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{g}</div>
              {list.map((c) => (
                <button key={c.name} onClick={() => open(c.name)} className="flex w-full items-start gap-2 rounded px-1.5 py-1 text-left hover:bg-accent/40">
                  <code className="w-24 shrink-0 font-mono text-[11px] text-primary">{c.name}</code>
                  <span className="text-[11px] text-foreground/80"><CommandText text={c.what} skip={c.name} /></span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Installed packages from this machine's `pacman -Qq`. Each is clickable:
 *  if the package name is also a catalogue command → open its page;
 *  otherwise load `<name>` into the explainer so the user can see what it is. */
function InstalledPackages({
  filter,
  setFilter,
  installed,
  open,
  setInput,
}: {
  filter: string;
  setFilter: (v: string) => void;
  installed: string[];
  open: (name: string) => void;
  setInput: (v: string) => void;
}) {
  const q = filter.trim().toLowerCase();
  const fits = (name: string) => !q || name.toLowerCase().includes(q);
  const sorted = [...new Set(installed)].sort((a, b) => a.localeCompare(b)).filter(fits);
  return (
    <>
      <div className="p-2.5">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter installed packages…" className="h-7 text-xs" />
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          {installed.length} packages installed on this machine (from <code>pacman -Qq</code>).
          Click one: if it&rsquo;s in the catalogue, its page opens; otherwise it loads into the explainer.
        </p>
      </div>
      <div className="max-h-[480px] divide-y divide-border/40 overflow-y-auto">
        {sorted.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">no packages match &ldquo;{filter}&rdquo;</p>
        ) : (
          sorted.map((name) => {
            const isCatalogue = Boolean(commandDoc(name));
            return (
              <button
                key={name}
                onClick={() => (isCatalogue ? open(name) : setInput(name))}
                title={isCatalogue ? `open ${name}'s page` : `load ${name} into the explainer`}
                className="flex w-full items-center gap-2 px-3 py-1 text-left transition-colors hover:bg-accent/40"
              >
                <code className="w-40 shrink-0 truncate font-mono text-[11px] text-primary">{name}</code>
                <span className="text-[9px] text-muted-foreground">{isCatalogue ? "in catalogue" : "installed package"}</span>
                {isCatalogue && <span className="ml-auto text-[9px] text-ok">page →</span>}
              </button>
            );
          })
        )}
      </div>
    </>
  );
}

function KbRow({ item, curated, onClick }: { item: KbItem; curated?: boolean; onClick?: () => void }) {
  // The title tells the user what clicking will do — "open X's page" vs "load 'X Y' into the explainer".
  const title = onClick
    ? commandDoc(item.token)
      ? `open ${item.token}'s page`
      : item.example
        ? `load this example into the explainer: ${item.example}`
        : `load into the explainer`
    : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={title}
      className="flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors enabled:cursor-pointer enabled:hover:bg-accent/40 disabled:cursor-default"
    >
      <code className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] text-primary">
        {item.token}
      </code>
      <span className="flex-1 text-[11px] leading-relaxed text-foreground/80"><CommandText text={item.meaning} /></span>
      <Badge variant="outline" className="shrink-0 px-1 py-0 text-[9px] text-muted-foreground">
        {curated ? "curated" : "learned"}
      </Badge>
    </button>
  );
}

function dynamicToKbItems(dynamic: KbState["dynamic"]): Record<string, KbItem[]> {
  const out: Record<string, KbItem[]> = {};
  for (const [toolName, list] of Object.entries(dynamic)) {
    out[toolName] = list.map((d) => ({ token: d.token, kind: d.kind as KbItem["kind"], meaning: d.meaning }));
  }
  return out;
}

/** Best-effort application of a warning fix onto the raw input. */
function applyFix(input: string, fix: string): string {
  if (fix.startsWith("remove ")) {
    const what = fix.slice(7).trim();
    return input.replace(new RegExp(`\\b${what}\\b\\s*`), "");
  }
  if (fix.startsWith("use ")) {
    // e.g. "use 'pacman -Syu <pkg>' or run 'pacman -Syu' first"
    if (fix.includes("-Syu")) {
      const replaced = input.replace(/-Sy(?![a-zA-Zu])/, "-Syu");
      return replaced !== input ? replaced : `${input} -u`;
    }
    const quoted = /'([^']+)'/.exec(fix);
    return quoted ? quoted[1] : input;
  }
  if (fix === "-Rns") return input.replace(/(^|\s)-R(?=\s|$)/, "$1-Rns");
  if (fix === "--force-with-lease") return input.replace(/--force(?!-with-lease)(?!\S)/, "--force-with-lease");
  if (fix.startsWith("-m ")) return `${input} -m "message"`;
  return `${input} ${fix}`;
}
