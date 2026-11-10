// Commands section container: the "My Commands" tab (the user's own saved commands,
// searchable, explainable, copyable) and the "Arch Commands" tab (the explainer panel, or a
// command's own page when one is open).
//
// The Commands section is for learning commands, not running them:
// nothing here runs. Your saved commands run from Home, where their sections are played.

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Copy, ChevronRight, SquareTerminal, Sparkles, BookOpenText } from "lucide-react";
import { useArch } from "./store";
import { flattenTree } from "./bits";
import { ArchCommands } from "./arch-commands";
import { CommandPage } from "./command-page";
import { NodeDialog, emptyDraft, type NodeDraft } from "./node-dialog";
import { useToast } from "@/hooks/use-toast";

export function CommandsView() {
  const { tree, loadTree, commandsTab, setCommandsTab, explain, commandPage } = useArch();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<{ open: boolean; draft: NodeDraft | null }>({
    open: false,
    draft: null,
  });

  // All command-category items, flattened with breadcrumbs
  const commands = useMemo(
    () =>
      flattenTree(tree, [], (n) => Boolean(n.content?.trim()) && n.category === "command").filter(
        ({ node }) => node.content?.trim()
      ),
    [tree]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      ({ node, path }) =>
        node.name.toLowerCase().includes(q) ||
        (node.content ?? "").toLowerCase().includes(q) ||
        path.some((p) => p.name.toLowerCase().includes(q))
    );
  }, [commands, query]);

  return (
    <Tabs value={commandsTab} onValueChange={(v) => setCommandsTab(v as "mine" | "arch")} className="gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="mine" className="gap-1.5 text-xs">
            <SquareTerminal className="h-3.5 w-3.5" /> My Commands
          </TabsTrigger>
          <TabsTrigger value="arch" className="gap-1.5 text-xs">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Arch Commands
          </TabsTrigger>
        </TabsList>
        <Badge variant="secondary" className="h-6 px-2 text-[11px] font-normal">
          {filtered.length} saved command{filtered.length === 1 ? "" : "s"}
        </Badge>
      </div>

      <TabsContent value="arch" className="mt-0">
        {commandPage ? <CommandPage name={commandPage} /> : <ArchCommands />}
      </TabsContent>

      <TabsContent value="mine" className="mt-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search commands…"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDialog({ open: true, draft: emptyDraft(null) })}
          >
            New section for commands
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Here you learn your saved commands: Explain shows each part, Copy takes it with you. They run from Home, where their sections are.
        </p>
        <div className="overflow-hidden rounded-md border">
          {filtered.length === 0 ? (
            <p className="p-8 text-center text-xs text-muted-foreground">
              No commands found. Add items with category “command” inside any section, or parse a doc.
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {filtered.map(({ node, path }) => (
                <div key={node.id} className="group flex items-center gap-2 px-3 py-2 hover:bg-accent/40">
                  <SquareTerminal className="h-3.5 w-3.5 shrink-0 text-cyan-400/80" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      {path.map((p) => (
                        <span key={p.id} className="flex items-center gap-1">
                          {p.name}
                          <ChevronRight className="h-2.5 w-2.5" />
                        </span>
                      ))}
                    </div>
                    <div className="truncate font-mono text-xs text-foreground">{node.content?.trim()}</div>
                    <div className="text-[10px] text-muted-foreground/70">{node.name}</div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => explain(node.content?.trim() ?? "")}
                    title="Explain this command, part by part"
                  >
                    <BookOpenText className="h-3 w-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => {
                      navigator.clipboard.writeText(node.content?.trim() ?? "");
                      toast({ title: "Fluff copied it", description: node.content?.trim().slice(0, 60) });
                    }}
                    title="Copy command"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </TabsContent>

      <NodeDialog
        open={dialog.open}
        draft={dialog.draft}
        onClose={() => setDialog({ open: false, draft: null })}
        onSaved={loadTree}
      />
    </Tabs>
  );
}
