import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FileCode2, Plus, Play, Square } from "lucide-react";
import { useArch } from "./store";
import { TreeLevel, EmptyTreeHint } from "./tree-level";
import { NodeDialog, emptyDraft, draftFromNode, type NodeDraft } from "./node-dialog";
import { ParseDialog } from "./parse-dialog";
import { DiskWidget } from "./disk-widget";
import { PortsWidget } from "./ports-panel";
import { FluffMood } from "./fluff-mood";
import { SecurityWidget } from "./security-check";
import { AppsBySource } from "./apps-by-source";
import { findNode } from "./bits";
import { useToast } from "@/hooks/use-toast";
import type { NodeDTO } from "@/lib/types";

export function HomeView() {
  const { tree, treeLoading, loadTree, startPlay, stopRun, run, nodeUpdate, nodeMove, nodeDelete } = useArch();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<{ open: boolean; draft: NodeDraft | null }>({
    open: false,
    draft: null,
  });
  const [parseOpen, setParseOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<NodeDTO | null>(null);

  const running = run?.status === "running";

  // every edit waits for Apply (top bar); Undo / Redo step through them
  const toggle = (node: NodeDTO, enabled: boolean) =>
    nodeUpdate(node.id, { enabled }, `${enabled ? "Switch on" : "Switch off"} "${node.name}"`);

  const move = (node: NodeDTO, direction: "up" | "down") => nodeMove(node.id, direction, `Move "${node.name}" ${direction}`);

  const remove = (node: NodeDTO) => {
    setConfirmDelete(null);
    nodeDelete(node.id, `Delete "${node.name}"`);
    toast({ title: "Deleted — pending", description: `${node.name} · Apply to save, or Undo` });
  };

  const doPlay = async (scope: string) => {
    const err = await startPlay(scope);
    if (err) toast({ title: "Fluff couldn't play it", description: err, variant: "destructive" });
  };

  return (
    <div className="space-y-3">
      <FluffMood />
      <SecurityWidget />
      <AppsBySource />
      <div className="grid gap-3 lg:grid-cols-2">
        <DiskWidget />
        <PortsWidget />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => setDialog({ open: true, draft: emptyDraft(null) })}
        >
          <Plus className="h-3.5 w-3.5" /> New section
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 border-primary/40 text-primary hover:bg-primary/10 hover:text-primary"
          onClick={() => setParseOpen(true)}
        >
          <FileCode2 className="h-3.5 w-3.5" /> Parse doc
        </Button>
        {running && (
          <Button size="sm" variant="destructive" className="ml-auto gap-1.5" onClick={stopRun}>
            <Square className="h-3.5 w-3.5" /> Stop
          </Button>
        )}
      </div>

      {treeLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : tree.length === 0 ? (
        <EmptyTreeHint />
      ) : (
        <div className="space-y-3">
          <TreeLevel
            nodes={tree}
            depth={0}
            runningScope={running && run?.currentStepIndex >= 0 ? findRunningRoot(tree, run?.steps[run.currentStepIndex]?.nodeIds ?? []) : null}
            onPlay={doPlay}
            onStop={stopRun}
            onToggle={toggle}
            onAddChild={(parent) => setDialog({ open: true, draft: emptyDraft(parent.id) })}
            onEdit={(node) => setDialog({ open: true, draft: draftFromNode(node) })}
            onDelete={(node) => {
              if (window.confirm(`Delete "${node.name}" and everything inside it?`)) remove(node);
            }}
            onMove={move}
            onCopy={(node) => navigator.clipboard.writeText(node.content?.trim() ?? "")}
            isFirst={(node) => tree.indexOf(node) === 0 || isFirstSibling(tree, node)}
            isLast={(node) => tree.indexOf(node) === tree.length - 1 || isLastSibling(tree, node)}
          />
        </div>
      )}

      <NodeDialog
        open={dialog.open}
        draft={dialog.draft}
        onClose={() => setDialog({ open: false, draft: null })}
        onSaved={loadTree}
      />
      <ParseDialog open={parseOpen} onClose={() => setParseOpen(false)} onImported={loadTree} />
    </div>
  );
}

// Find which top-level section contains the currently running step
function findRunningRoot(tree: NodeDTO[], nodeIds: string[]): string | null {
  if (nodeIds.length === 0) return null;
  const contains = (node: NodeDTO, ids: string[]): boolean => {
    if (ids.includes(node.id)) return true;
    return node.children.some((c) => contains(c, ids));
  };
  for (const root of tree) {
    if (contains(root, nodeIds)) return root.id;
  }
  return null;
}

function isFirstSibling(tree: NodeDTO[], node: NodeDTO): boolean {
  const parent = findParentList(tree, node);
  return parent ? parent[0]?.id === node.id : true;
}

function isLastSibling(tree: NodeDTO[], node: NodeDTO): boolean {
  const parent = findParentList(tree, node);
  return parent ? parent[parent.length - 1]?.id === node.id : true;
}

function findParentList(tree: NodeDTO[], target: NodeDTO): NodeDTO[] | null {
  for (const n of tree) {
    if (n.id === target.id) return tree;
    const hit = findParentList(n.children, target);
    if (hit) return hit;
  }
  return null;
}
