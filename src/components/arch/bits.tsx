import { Badge } from "@/components/ui/badge";
import { Github, Package, Anvil, Bot, Boxes, Box, FolderTree, SquareTerminal } from "lucide-react";
import type { NodeDTO, Source } from "@/lib/types";

export const SOURCE_LABEL: Record<Source, string> = {
  pacman: "pacman",
  yay: "yay",
  github: "github",
  ollama: "ollama",
  flatpak: "flatpak",
  snap: "snap",
};

export const SOURCE_PREFIX: Record<Source, string> = {
  pacman: "sudo pacman -Syu --needed",
  yay: "yay -Syu --needed",
  github: "git clone",
  ollama: "ollama pull",
  flatpak: "flatpak install --user flathub",
  snap: "sudo snap install",
};

export function SourceIcon({ source, className }: { source: Source | null; className?: string }) {
  if (source === "github") return <Github className={className} />;
  if (source === "pacman") return <Package className={className} />;
  if (source === "yay") return <Anvil className={className} />;
  if (source === "ollama") return <Bot className={className} />;
  if (source === "flatpak") return <Boxes className={className} />;
  if (source === "snap") return <Box className={className} />;
  return <SquareTerminal className={className} />;
}

export function CategoryBadge({ node }: { node: NodeDTO }) {
  if (node.children.length > 0) {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] px-1.5 py-0 text-muted-foreground">
        <FolderTree className="h-3 w-3" />
        {node.children.length}
      </Badge>
    );
  }
  if (node.category === "download") {
    const color =
      node.source === "pacman"
        ? "text-sky-400 border-sky-400/30"
        : node.source === "yay"
          ? "text-amber-400 border-amber-400/30"
          : node.source === "github"
            ? "text-violet-400 border-violet-400/30"
            : node.source === "ollama"
              ? "text-emerald-400 border-emerald-400/30"
              : node.source === "flatpak"
                ? "text-indigo-400 border-indigo-400/30"
                : node.source === "snap"
                  ? "text-orange-400 border-orange-400/30"
                  : "text-emerald-400 border-emerald-400/30";
    return (
      <Badge variant="outline" className={`gap-1 text-[10px] px-1.5 py-0 capitalize ${color}`}>
        <SourceIcon source={node.source} className="h-3 w-3" />
        {node.source ?? "download"}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1 text-[10px] px-1.5 py-0 text-cyan-400/90 border-cyan-400/30"
    >
      <SquareTerminal className="h-3 w-3" />
      cmd
    </Badge>
  );
}

// Flatten tree → items with breadcrumb path
export interface FlatNode {
  node: NodeDTO;
  path: NodeDTO[]; // ancestors excluding self
}

export function flattenTree(
  nodes: NodeDTO[],
  path: NodeDTO[] = [],
  filter?: (n: NodeDTO) => boolean
): FlatNode[] {
  const out: FlatNode[] = [];
  for (const n of nodes) {
    const here = [...path, n];
    if (!filter || filter(n)) out.push({ node: n, path });
    out.push(...flattenTree(n.children, here, filter));
  }
  return out;
}

export function findNode(nodes: NodeDTO[], id: string): NodeDTO | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

export function countEnabledItems(node: NodeDTO): number {
  let count = node.enabled && node.content?.trim() ? 1 : 0;
  for (const c of node.children) count += countEnabledItems(c);
  return count;
}

export function hasItems(node: NodeDTO): boolean {
  if (node.content?.trim()) return true;
  return node.children.some(hasItems);
}
