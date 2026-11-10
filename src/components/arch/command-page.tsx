// A command's own page (Commands → click any command): what it does, how it is used, examples
// you can copy or open in the explainer, its options, what it is often used with, what needs it
// and what it needs — and, one click away, its real --help from this computer.
//
// ─── Perfected for fresh Arch beginners ─────────────────────────────────────
//   • "When you'd reach for it" — a one-line callout derived from the command's
//     group, so a beginner knows the moment a command is the right tool.
//   • "Try this first" — the safest example is highlighted, with a green/amber/red
//     safety badge on every example so danger is visible at a glance.
//   • "If you're new to Arch" — surfaces the most-related neighbour commands as
//     quick links with one-line "what"s, so the page is also a small map.

import { useEffect, useState } from "react";
import { BookOpenText, Copy, Sparkles, TriangleAlert, Compass, Star, LifeBuoy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { errText, inv } from "@/lib/host";
import { commandDoc, needs, usedWith } from "@/lib/commands/catalog";
import { installLine, notInstalled, packageOf } from "@/lib/commands/install-line";
import { CommandText } from "./command-text";
import { useArch } from "./store";

type Safety = "safe" | "caution" | "danger";

/** Look at an example command and say how careful to be with it. */
function safetyOf(command: string): Safety {
  if (/\brm\s+-[a-zA-Z]*r[a-zA-Z]*f|\brm\s+-[a-zA-Z]*f[a-zA-Z]*r/.test(command)) return "danger";
  if (/\bsudo\s+rm\b/.test(command)) return "danger";
  if (/(^|\s)\/\s*$|\$HOME|~\/\s*$/.test(command) && /\brm\b/.test(command)) return "danger";
  if (/--force\b|--noconfirm|chmod\s+777/.test(command)) return "caution";
  return "safe";
}

/** A one-line "reach for this when…" derived from the command's group. */
const GROUP_WHEN: Record<string, string> = {
  "Files and folders": "when you need to make, move, copy or remove files and folders",
  "Reading files": "when you want to see what's inside a file",
  "Editing files": "when you want to change a file's text",
  "Finding things": "when you're looking for a file, or a word inside files",
  Text: "when you want to slice, count, sort or rearrange lines",
  "Permissions and users": "when you're controlling who can do what",
  Archives: "when you're packing or unpacking an archive",
  Network: "when you're reaching another computer or the internet",
  System: "when you want to know what the machine is doing or has",
  "Programs running": "when you want to see, watch or stop running programs",
  Help: "when you want the full manual for a command",
  Packages: "when you're installing, updating or removing Arch software",
  Services: "when you're managing background services or their logs",
  Development: "when you're coding, building or running development tools",
  Security: "when you're hardening the system or your traffic",
  Safety: "when you want to undo a change, or go back to a known state",
};

function Links({ title, names }: { title: string; names: string[] }) {
  const openCommand = useArch((s) => s.openCommand);
  if (!names.length) return null;
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium">{title}</div>
      <div className="flex flex-wrap gap-1">
        {names.map((n) => (
          <button key={n} onClick={() => openCommand(n)} className="rounded border px-1.5 py-0.5 font-mono text-[11px] text-primary hover:bg-primary/10">
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

export function CommandPage({ name }: { name: string }) {
  const { explain, openCommand } = useArch();
  const { toast } = useToast();
  const doc = commandDoc(name);
  const [help, setHelp] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(true); // auto-show on mount
  const [helpLoading, setHelpLoading] = useState(false);
  // Auto-load the real --help on mount and whenever the command changes —
  // the command page IS the replacement for opening a terminal and running --help.
  useEffect(() => {
    setHelp(null);
    setHelpOpen(true);
    let cancelled = false;
    setHelpLoading(true);
    inv<string>("command_help", { name })
      .then((text) => { if (!cancelled) { setHelp(text); setHelpLoading(false); } })
      .catch((e) => { if (!cancelled) { setHelp(errText(e)); setHelpLoading(false); } });
    return () => { cancelled = true; };
  }, [name]);

  if (!doc) return <p className="p-4 text-xs text-muted-foreground">Fluff doesn't know {name} yet.</p>;
  const copy = (c: string) => {
    void navigator.clipboard.writeText(c);
    toast({ title: "Fluff copied it", description: c });
  };
  const showHelp = async () => {
    setHelpOpen(true);
    if (help !== null) return;
    try {
      setHelp(await inv<string>("command_help", { name }));
    } catch (e) {
      setHelp(errText(e));
    }
  };
  const { neededBy, needs: needsList } = needs(name);

  // pick the safest example to highlight as "try this first"
  const tryFirst = doc.examples.length > 0
    ? [...doc.examples].sort((a, b) => {
        const order: Safety[] = ["safe", "caution", "danger"];
        return order.indexOf(safetyOf(a.command)) - order.indexOf(safetyOf(b.command));
      })[0]
    : null;

  const whenLine = GROUP_WHEN[doc.group] ?? "when you need to do what its line above says";

  // first three neighbour names for the "new to Arch" box
  const newToArchNames = [...new Set([...usedWith(name).slice(0, 3), ...neededBy.slice(0, 2), ...needsList.slice(0, 2)])]
    .slice(0, 4);

  return (
    <div className="space-y-4 rounded-md border bg-card p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="font-mono text-lg font-semibold text-primary">{doc.name}</h2>
        <Badge variant="outline" className="text-[10px]">{doc.group}</Badge>
        <span className="text-[10px] text-muted-foreground">from the package {doc.pkg}</span>
      </div>

      {/* ── When you'd reach for it ─────────────────────────────────────────── */}
      <div className="flex items-start gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-foreground/85">
        <Compass className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <span><b className="text-foreground">When you'd reach for it:</b> {whenLine}.</span>
      </div>

      <p className="text-sm"><CommandText text={doc.what} skip={doc.name} /></p>

      <div className="space-y-1">
        <div className="text-xs font-medium">How it is used</div>
        <code className="block rounded bg-muted px-2 py-1 font-mono text-xs"><CommandText text={doc.usage} line skip={doc.name} /></code>
        <p className="text-[10px] text-muted-foreground">&lt;…&gt; is something you fill in; […] is optional; … means one or more.</p>
      </div>
      {doc.caution && (
        <div className="rounded-md border border-warn/40 bg-warn/5 p-2">
          <p className="flex items-start gap-1.5 text-[11px]">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" /> <span><CommandText text={doc.caution} skip={doc.name} /></span>
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="text-xs font-medium">Examples</div>
        {doc.examples.map((e) => {
          const s = safetyOf(e.command);
          const isTryFirst = tryFirst?.command === e.command;
          return (
            <div
              key={e.command}
              className={`flex flex-wrap items-center gap-2 rounded px-1.5 py-1 ${
                isTryFirst ? "border border-primary/40 bg-primary/5" : ""
              }`}
            >
              {isTryFirst && (
                <Badge variant="outline" className="gap-1 border-primary/40 px-1 py-0 text-[9px] text-primary">
                  <Star className="h-2.5 w-2.5" /> try this first
                </Badge>
              )}
              <code className="rounded bg-term px-1.5 py-0.5 font-mono text-[11px] text-term-foreground"><CommandText text={e.command} line skip={doc.name} /></code>
              <span className="min-w-0 flex-1 text-[11px] text-muted-foreground"><CommandText text={e.meaning} skip={doc.name} /></span>
              <Badge
                variant="outline"
                className={`px-1 py-0 text-[9px] ${
                  s === "danger" ? "border-bad/50 text-bad" : s === "caution" ? "border-warn/40 text-warn" : "border-ok/40 text-ok"
                }`}
                title={s === "danger" ? "destructive — read twice" : s === "caution" ? "careful — has a sharp edge" : "safe to try"}
              >
                {s}
              </Badge>
              <Button size="icon" variant="ghost" className="h-6 w-6" title="Copy" onClick={() => copy(e.command)}>
                <Copy className="h-3 w-3" />
              </Button>
              <Button size="icon" variant="ghost" className="h-6 w-6" title="Explain it, part by part" onClick={() => explain(e.command)}>
                <Sparkles className="h-3 w-3" />
              </Button>
            </div>
          );
        })}
      </div>

      {doc.options.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium">Options worth knowing</div>
          <div className="divide-y divide-border/40 rounded-md border">
            {doc.options.map((o) => (
              <div key={o.token} className="flex items-start gap-2 px-2 py-1">
                <code className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] text-primary">{o.token}</code>
                <span className="text-[11px]"><CommandText text={o.meaning} skip={doc.name} /></span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Links title="Often used with" names={usedWith(name)} />
        <Links title="Needed by" names={neededBy} />
        <Links title="It needs" names={needsList} />
      </div>

      {/* ── If you're new to Arch ─────────────────────────────────────────────── */}
      {newToArchNames.length > 0 && (
        <div className="rounded-md border border-ok/30 bg-ok/5 p-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-ok">
            <LifeBuoy className="h-3.5 w-3.5" /> If you're new to Arch — meet {name}'s neighbours
          </div>
          <div className="space-y-1">
            {newToArchNames.map((n) => {
              const d = commandDoc(n);
              return (
                <button
                  key={n}
                  onClick={() => openCommand(n)}
                  className="flex w-full items-start gap-2 rounded px-1.5 py-0.5 text-left hover:bg-ok/10"
                  title={`${n}: its page`}
                >
                  <code className="w-24 shrink-0 font-mono text-[11px] text-primary">{n}</code>
                  <span className="text-[11px] text-foreground/75">{d?.what ?? "(no page yet)"}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-1 pl-1 text-[10px] text-muted-foreground/80">
            Click any name to open its page — they appear here because they're often used with, or needed by, {name}.
          </p>
        </div>
      )}

      <div className="space-y-1.5 border-t pt-3">
        <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" onClick={() => (helpOpen ? setHelpOpen(false) : void showHelp())}>
          <BookOpenText className="h-3 w-3" /> {helpOpen ? "Hide" : "Show"} its own --help (from this computer)
        </Button>
        {helpOpen && (
          <pre className="max-h-96 overflow-auto rounded-md bg-term p-2 text-[10px] text-term-foreground">{help ?? `Fluff is asking ${name}…`}</pre>
        )}
        {help !== null && notInstalled(help) && installLine(doc.pkg) && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-[11px]">
            <span>
              {name} isn't on this computer yet. It comes in the package <code>{packageOf(doc.pkg)}</code>; to get it:
            </span>
            <code className="rounded bg-code px-1.5 py-0.5 font-mono text-[10px] text-term-foreground">{installLine(doc.pkg)}</code>
            <button className="text-muted-foreground hover:text-foreground" title="Copy" onClick={() => copy(installLine(doc.pkg)!)}>
              <Copy className="h-3 w-3" />
            </button>
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">
          The whole manual: <code>man {name}</code> in a terminal{help !== null && notInstalled(help) ? `, once ${name} is installed` : ""}.
        </p>
      </div>
    </div>
  );
}
