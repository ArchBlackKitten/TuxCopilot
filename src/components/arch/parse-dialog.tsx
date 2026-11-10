import { prepareParsed } from "@/lib/api";
import { useArch } from "./store";
import { errText } from "@/lib/host";
import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { parseDocument } from "@/lib/parser";
import { useToast } from "@/hooks/use-toast";
import { FileCode2, TriangleAlert, ChevronRight } from "lucide-react";
import type { ParsedNode } from "@/lib/types";

const EXAMPLE = `<section>Post Install
  <cmd>sudo systemctl enable fstrim.timer</cmd>
  <subsection>Browsers
    <pkg>firefox</pkg>
  </subsection>
  <pacman>
    <pkg>alacritty</pkg>
    <pkg>neovim</pkg>
  </pacman>
  <github>
    <pkg>zsh-users/zsh-autosuggestions</pkg>
  </github>
</section>

<section>Fonts
  <pkg>ttf-jetbrainsmono-nerd</pkg>
</section>`;

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export function ParseDialog({ open, onClose, onImported }: Props) {
  const { toast } = useToast();
  const [raw, setRaw] = useState("");
  const [mode, setMode] = useState<"append" | "replace">("append");
  const [importing, setImporting] = useState(false);

  const parsed = useMemo(() => (raw.trim() ? parseDocument(raw) : null), [raw]);
  const total = parsed ? countParsed(parsed.roots) : 0;

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
        description: data.errors?.length ? data.errors[0] : `${mode === "replace" ? "Replaces all data" : "Appended to your tree"} · Apply to save, or Undo`,
      });
      setRaw("");
      onImported();
      onClose();
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
      <DialogContent className="sm:max-w-2xl bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCode2 className="h-4 w-4 text-primary" />
            Parse a doc into sections
          </DialogTitle>
          <DialogDescription>
            Paste text with tags like <code className="font-mono text-primary">&lt;section&gt;xyz&lt;/section&gt;</code>{" "}
            and <code className="font-mono text-primary">&lt;subsection&gt;wah&lt;/subsection&gt;</code> — nest tags like
            HTML for subsections, any depth. Tags <code className="font-mono">&lt;cmd&gt;</code> /{" "}
            <code className="font-mono">&lt;pkg&gt;</code> make items; container tags{" "}
            <code className="font-mono">&lt;pacman&gt;</code> / <code className="font-mono">&lt;yay&gt;</code> /{" "}
            <code className="font-mono">&lt;github&gt;</code> / <code className="font-mono">&lt;ollama&gt;</code> set the
            source for everything inside. Bare lines inside a section become items of that section.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="parse-raw">Your doc</Label>
            <textarea
              id="parse-raw"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              spellCheck={false}
              placeholder={EXAMPLE}
              className="h-72 w-full resize-none rounded-md border border-input bg-muted/60 p-3 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-2">
            <Label>Preview {parsed ? `— ${total} node${total === 1 ? "" : "s"}` : ""}</Label>
            <ScrollArea className="h-72 rounded-md border bg-muted/40 p-3">
              {parsed && parsed.roots.length > 0 ? (
                <div className="space-y-0.5">
                  {parsed.roots.map((r) => (
                    <PreviewNode key={r.name + r.content} node={r} depth={0} />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Start typing or paste your doc…</p>
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
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as "append" | "replace")}
            className="flex items-center gap-4"
          >
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="append" id="mode-append" />
              <Label htmlFor="mode-append" className="text-xs font-normal">
                Append to tree
              </Label>
            </div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="replace" id="mode-replace" />
              <Label htmlFor="mode-replace" className="text-xs font-normal">
                Replace everything
              </Label>
            </div>
          </RadioGroup>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRaw(EXAMPLE)}>
              Load example
            </Button>
            <Button onClick={doImport} disabled={importing || !parsed || parsed.roots.length === 0}>
              {importing ? "Importing…" : `Import ${total || ""}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function countParsed(nodes: ParsedNode[]): number {
  return nodes.reduce((acc, n) => acc + 1 + countParsed(n.children), 0);
}

function PreviewNode({ node, depth }: { node: ParsedNode; depth: number }) {
  const [open, setOpen] = useState(true);
  const isContainer = node.children.length > 0;
  return (
    <div>
      <div
        className={`flex items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-accent/50 ${isContainer ? "cursor-pointer" : ""}`}
        style={{ paddingLeft: depth * 14 + 4 }}
        onClick={() => isContainer && setOpen(!open)}
      >
        {isContainer ? (
          <ChevronRight className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className={isContainer ? "font-medium text-foreground" : "text-muted-foreground"}>
          {node.name}
        </span>
        {node.category === "download" && node.source && (
          <span className="text-[10px] text-muted-foreground">[{node.source}]</span>
        )}
      </div>
      {isContainer && open && (
        <div>
          {node.children.map((c, i) => (
            <PreviewNode key={i} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
