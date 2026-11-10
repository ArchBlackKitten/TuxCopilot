// Parse Manager — one dialog for the round trip:
//   · "Copy markup"  → the whole tree serialised as <section>/<subsection>
//     markup, ready to copy to the clipboard.
//   · "Import markup" → paste markup, preview it, and import (append/replace).

import { useMemo, useState } from "react";
import { prepareParsed } from "@/lib/api";
import { errText } from "@/lib/host";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ClipboardList, Copy, TriangleAlert, ChevronRight, FileCode2 } from "lucide-react";
import { parseDocument } from "@/lib/parser";
import { serializeTree } from "@/lib/serialize";
import { useArch } from "./store";
import { useToast } from "@/hooks/use-toast";
import type { ParsedNode } from "@/lib/types";

const EXAMPLE = `<section>Post Install
  <cmd>sudo systemctl enable fstrim.timer</cmd>
  <subsection>Browsers
    <pkg source="pacman">firefox</pkg>
  </subsection>
</section>`;

export function ParseManagerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tree, loadTree } = useArch();
  const { toast } = useToast();
  const [tab, setTab] = useState<"copy" | "import">("copy");
  const [raw, setRaw] = useState("");
  const [mode, setMode] = useState<"append" | "replace">("append");
  const [importing, setImporting] = useState(false);

  const markup = useMemo(() => (open ? serializeTree(tree) : ""), [tree, open]);
  const nodeCount = useMemo(() => {
    const count = (nodes: typeof tree): number =>
      nodes.reduce((acc, n) => acc + 1 + count(n.children), 0);
    return count(tree);
  }, [tree]);

  const parsed = useMemo(() => (raw.trim() ? parseDocument(raw) : null), [raw]);
  const total = parsed ? countParsed(parsed.roots) : 0;

  const copyMarkup = async () => {
    if (!markup.trim()) {
      toast({ title: "Fluff found nothing to copy", description: "The tree is empty." });
      return;
    }
    try {
      await navigator.clipboard.writeText(markup);
      toast({ title: "Fluff copied it", description: `${nodeCount} nodes as <section> markup` });
    } catch {
      toast({ title: "Fluff couldn't reach the clipboard", description: "Select the text and copy manually.", variant: "destructive" });
    }
  };

  const doImport = async () => {
    if (!parsed || parsed.roots.length === 0) {
      toast({ title: "Fluff found nothing to import", variant: "destructive" });
      return;
    }
    setImporting(true);
    try {
      const data = prepareParsed(raw);
      useArch.getState().importNodes(data.roots, mode, `Import ${data.total} node${data.total === 1 ? "" : "s"} (${mode})`);
      toast({
        title: `${data.total} node${data.total === 1 ? "" : "s"} imported — pending`,
        description: `${mode === "replace" ? "Replaces all data" : "Appended to your tree"} · Apply to save, or Undo`,
      });
      setRaw("");
    } catch (err) {
      toast({
        title: "Fluff ran into a problem",
        description: errText(err, "Fluff couldn't import it"),
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto bg-card sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <ClipboardList className="h-4 w-4 text-primary" />
            Parse manager
          </DialogTitle>
          <DialogDescription className="text-xs">
            Copy your whole set-up as <code className="font-mono text-primary">&lt;section&gt;</code> markup,
            or paste markup to bring sections in. Nest tags like HTML — any depth.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "copy" | "import")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="copy" className="gap-1.5 text-xs">
              <Copy className="h-3 w-3" /> Copy markup
            </TabsTrigger>
            <TabsTrigger value="import" className="gap-1.5 text-xs">
              <FileCode2 className="h-3 w-3" /> Import markup
            </TabsTrigger>
          </TabsList>

          <TabsContent value="copy" className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">
                {nodeCount} node{nodeCount === 1 ? "" : "s"} serialised
              </span>
              <Button size="sm" className="ml-auto h-7 gap-1.5 text-[11px]" onClick={copyMarkup} disabled={nodeCount === 0}>
                <Copy className="h-3 w-3" /> Copy to clipboard
              </Button>
            </div>
            <textarea
              readOnly
              value={markup}
              spellCheck={false}
              placeholder={nodeCount === 0 ? "Your tree is empty — add sections first." : ""}
              onFocus={(e) => e.currentTarget.select()}
              className="h-72 w-full resize-none rounded-md border border-input bg-muted/60 p-3 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <p className="text-[10px] text-muted-foreground">
              The exported markup round-trips: paste it into Import markup (or the Home parse box)
              on another machine to rebuild the same tree.
            </p>
          </TabsContent>

          <TabsContent value="import" className="space-y-2">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pm-raw">Your markup</Label>
                <textarea
                  id="pm-raw"
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                  spellCheck={false}
                  placeholder={EXAMPLE}
                  className="h-60 w-full resize-none rounded-md border border-input bg-muted/60 p-3 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Preview {parsed ? `— ${total} node${total === 1 ? "" : "s"}` : ""}</Label>
                <ScrollArea className="h-60 rounded-md border bg-muted/40 p-3">
                  {parsed && parsed.roots.length > 0 ? (
                    parsed.roots.map((r, i) => <PreviewNode key={i} node={r} depth={0} />)
                  ) : (
                    <p className="text-xs text-muted-foreground">Paste markup to see the tree…</p>
                  )}
                  {parsed?.errors.map((e, i) => (
                    <p key={i} className="mt-2 flex items-start gap-1 text-[11px] text-warn">
                      <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                      {e}
                    </p>
                  ))}
                </ScrollArea>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as "append" | "replace")} className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="append" id="pm-append" />
                  <Label htmlFor="pm-append" className="text-xs font-normal">Append to tree</Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="replace" id="pm-replace" />
                  <Label htmlFor="pm-replace" className="text-xs font-normal">Replace everything</Label>
                </div>
              </RadioGroup>
              <Button onClick={doImport} disabled={importing || !parsed || parsed.roots.length === 0} className="h-7 text-[11px]">
                {importing ? "Importing…" : `Import ${total || ""}`}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function countParsed(nodes: ParsedNode[]): number {
  return nodes.reduce((acc, n) => acc + 1 + countParsed(n.children), 0);
}

function PreviewNode({ node, depth }: { node: ParsedNode; depth: number }) {
  const isContainer = node.children.length > 0;
  return (
    <div className="flex items-center gap-1 py-0.5 text-xs" style={{ paddingLeft: depth * 14 + 4 }}>
      {isContainer ? (
        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
      ) : (
        <span className="w-3 shrink-0" />
      )}
      <span className={isContainer ? "font-medium text-foreground" : "text-muted-foreground"}>{node.name}</span>
      {node.category === "download" && node.source && (
        <span className="text-[10px] text-muted-foreground">[{node.source}]</span>
      )}
    </div>
  );
}
