import { useState } from "react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Play,
  Square,
  ChevronRight,
  MoreVertical,
  Plus,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  Copy,
  BookOpenText,
} from "lucide-react";
import { useArch } from "./store";
import { SOURCE_PREFIX } from "./bits";
import { CategoryBadge, hasItems } from "./bits";
import { useToast } from "@/hooks/use-toast";
import type { NodeDTO } from "@/lib/types";

interface TreeProps {
  nodes: NodeDTO[];
  depth: number;
  runningScope: string | null;
  onPlay: (id: string) => void;
  onStop: () => void;
  onToggle: (node: NodeDTO, enabled: boolean) => void;
  onAddChild: (parent: NodeDTO) => void;
  onEdit: (node: NodeDTO) => void;
  onDelete: (node: NodeDTO) => void;
  onMove: (node: NodeDTO, direction: "up" | "down") => void;
  onCopy: (node: NodeDTO) => void;
  isFirst: (node: NodeDTO) => boolean;
  isLast: (node: NodeDTO) => boolean;
}

export function TreeLevel(props: TreeProps) {
  const explain = useArch((st) => st.explain);
  const { depth } = props;
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const isOpen = (id: string) => (depth === 0 ? openMap[id] !== false : openMap[id] === true);

  return (
    <div className={depth === 0 ? "space-y-3" : "space-y-0.5"}>
      {props.nodes.map((node) => {
        const isContainer = node.children.length > 0;
        const open = isOpen(node.id);
        const isRunning = props.runningScope === node.id;
        const runnable = hasItems(node);
        return (
          <div key={node.id}>
            <div
              className={`group rounded-md border transition-colors ${
                depth === 0
                  ? "bg-card p-0"
                  : "border-transparent hover:border-border hover:bg-accent/40"
              } ${isRunning ? "ring-1 ring-primary/60" : ""}`}
            >
              {depth === 0 ? (
                // Top-level section card
                <div>
                  <div className="flex items-center gap-2 border-b border-border/60 p-3">
                    <button
                      onClick={() => setOpenMap((m) => ({ ...m, [node.id]: !open }))}
                      className="rounded p-0.5 hover:bg-accent"
                      aria-label={open ? "Collapse" : "Expand"}
                    >
                      <ChevronRight
                        className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
                      />
                    </button>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{node.name}</span>
                    <CategoryBadge node={node} />
                    <TooltipProvider delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div>
                            <Switch
                              checked={node.enabled}
                              onCheckedChange={(v) => props.onToggle(node, v)}
                              className="scale-90"
                            />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent className="text-xs">
                          {node.enabled ? "Considered in Play All" : "Ignored in Play All"}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    {runnable && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-primary hover:text-primary"
                        onClick={() => props.onPlay(node.id)}
                        title="Play this section"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {isRunning && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={props.onStop}
                        title="Stop"
                      >
                        <Square className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <SectionMenu
                      node={node}
                      onAddChild={props.onAddChild}
                      onEdit={props.onEdit}
                      onDelete={props.onDelete}
                      onMove={props.onMove}
                      isFirst={props.isFirst(node)}
                      isLast={props.isLast(node)}
                    />
                  </div>
                  {open && (
                    <div className="p-2">
                      {isContainer ? (
                        <TreeLevel {...props} nodes={node.children} depth={depth + 1} />
                      ) : (
                        <p className="px-2 py-1.5 text-xs text-muted-foreground">
                          Empty section — add subsections or items with the menu.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                // Nested row
                <div className="flex items-center gap-1.5 px-2 py-1.5" style={{ paddingLeft: 8 + depth * 0 }}>
                  <button
                    onClick={() => isContainer && setOpenMap((m) => ({ ...m, [node.id]: !open }))}
                    className={`rounded p-0.5 ${isContainer ? "hover:bg-accent" : "cursor-default"}`}
                    aria-label={isContainer ? (open ? "Collapse" : "Expand") : node.name}
                  >
                    {isContainer ? (
                      <ChevronRight
                        className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
                      />
                    ) : (
                      <span className="block h-3.5 w-3.5" />
                    )}
                  </button>
                  <span className="min-w-0 flex-1 truncate text-xs">
                    <span className="font-medium">{node.name}</span>
                    {node.content?.trim() && (
                      <span className="ml-2 hidden font-mono text-[11px] text-muted-foreground md:inline">
                        {node.content.trim().split("\n")[0].slice(0, 64)}
                      </span>
                    )}
                  </span>
                  <CategoryBadge node={node} />
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div>
                          <Switch
                            checked={node.enabled}
                            onCheckedChange={(v) => props.onToggle(node, v)}
                            className="scale-[0.8]"
                          />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">
                        {node.enabled ? "Considered in Play" : "Ignored in Play"}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  {runnable && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-primary hover:text-primary"
                      onClick={() => props.onPlay(node.id)}
                      title="Play this subsection"
                    >
                      <Play className="h-3 w-3" />
                    </Button>
                  )}
                  {isRunning && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      onClick={props.onStop}
                      title="Stop"
                    >
                      <Square className="h-3 w-3" />
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100">
                        <MoreVertical className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="text-xs">
                      <DropdownMenuItem onClick={() => props.onAddChild(node)}>
                        <Plus className="h-3.5 w-3.5" /> Add inside
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => props.onEdit(node)}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </DropdownMenuItem>
                      {node.content?.trim() && (
                        <DropdownMenuItem onClick={() => props.onCopy(node)}>
                          <Copy className="h-3.5 w-3.5" /> Copy content
                        </DropdownMenuItem>
                      )}
                      {node.content?.trim() && (
                        <DropdownMenuItem onClick={() => explain(commandOf(node))}>
                          <BookOpenText className="h-3.5 w-3.5" /> Explain
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => props.onMove(node, "up")} disabled={props.isFirst(node)}>
                        <ArrowUp className="h-3.5 w-3.5" /> Move up
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => props.onMove(node, "down")} disabled={props.isLast(node)}>
                        <ArrowDown className="h-3.5 w-3.5" /> Move down
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => props.onDelete(node)} className="text-destructive">
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>

            {/* Nested children of non-root rows */}
            {depth > 0 && isContainer && open && (
              <div className="ml-4 border-l border-border/70 pl-1">
                <TreeLevel {...props} nodes={node.children} depth={depth + 1} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SectionMenu({
  node,
  onAddChild,
  onEdit,
  onDelete,
  onMove,
  isFirst,
  isLast,
}: {
  node: NodeDTO;
  onAddChild: (n: NodeDTO) => void;
  onEdit: (n: NodeDTO) => void;
  onDelete: (n: NodeDTO) => void;
  onMove: (n: NodeDTO, d: "up" | "down") => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-7 w-7">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="text-xs">
        <DropdownMenuItem onClick={() => onAddChild(node)}>
          <Plus className="h-3.5 w-3.5" /> Add subsection / item
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onEdit(node)}>
          <Pencil className="h-3.5 w-3.5" /> Edit
        </DropdownMenuItem>
        {node.content?.trim() && (
          <DropdownMenuItem onClick={() => navigator.clipboard.writeText((node.content ?? "").trim())}>
            <Copy className="h-3.5 w-3.5" /> Copy content
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => onMove(node, "up")} disabled={isFirst}>
          <ArrowUp className="h-3.5 w-3.5" /> Move up
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onMove(node, "down")} disabled={isLast}>
          <ArrowDown className="h-3.5 w-3.5" /> Move down
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onDelete(node)} className="text-destructive">
          <Trash2 className="h-3.5 w-3.5" /> Delete section
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The command a node stands for: its content, or the install line for a package. */
function commandOf(node: NodeDTO): string {
  const c = node.content?.trim() ?? "";
  return node.category === "download" && node.source ? `${SOURCE_PREFIX[node.source]} ${c}` : c;
}

export function EmptyTreeHint() {
  return (
    <div className="rounded-md border border-dashed p-8 text-center">
      <p className="text-sm font-medium">No sections yet</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Create your first section, or hit <Badge className="mx-1 text-[10px]">Parse</Badge> to import a doc
        full of <code className="font-mono">&lt;section&gt;</code> tags.
      </p>
    </div>
  );
}
