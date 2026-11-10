// Serialises the node tree back into the <section>/<subsection> markup the
// parser accepts — used by the Parse Manager's "copy to clipboard" export.

import type { NodeDTO } from "./types";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function attrsFor(node: NodeDTO, isItem: boolean): string {
  const parts: string[] = [];
  if (isItem) {
    if (node.name && node.name.trim() && node.name.trim() !== node.content?.trim().split(/\r?\n/)[0]?.trim()) {
      parts.push(`name="${esc(node.name.trim())}"`);
    }
    if (node.category === "download" && node.source) parts.push(`source="${node.source}"`);
  } else if (node.name && node.name.trim()) {
    // Containers carry their name as text content; only use the attribute when
    // the name can't be expressed inline (starts with markup-ish characters).
    if (/[<>]/.test(node.name)) parts.push(`name="${esc(node.name.trim())}"`);
  }
  if (!node.enabled) parts.push('enabled="false"');
  return parts.length ? " " + parts.join(" ") : "";
}

function serializeNode(node: NodeDTO, depth: number, out: string[]) {
  const pad = "  ".repeat(depth);
  const content = node.content?.trim() ?? "";
  const isItem = content.length > 0 && node.children.length === 0;

  if (isItem) {
    const tag = node.category === "download" ? "pkg" : "cmd";
    out.push(`${pad}<${tag}${attrsFor(node, true)}>${esc(content)}</${tag}>`);
    return;
  }

  const tag = depth === 0 ? "section" : "subsection";
  const open = `${pad}<${tag}${attrsFor(node, false)}>`;
  const nameLine = node.name.trim() ? esc(node.name.trim()) : "Untitled";
  if (node.children.length === 0) {
    if (content) {
      out.push(`${pad}<${tag}${attrsFor(node, false)} name="${esc(node.name.trim() || "Untitled")}">${esc(content)}</${tag}>`);
    } else {
      out.push(`${pad}<${tag}>${nameLine}</${tag}>`);
    }
    return;
  }
  out.push(`${open}${nameLine}`);
  for (const child of node.children) serializeNode(child, depth + 1, out);
  out.push(`${pad}</${tag}>`);
}

export function serializeTree(nodes: NodeDTO[]): string {
  const out: string[] = [];
  for (const node of nodes) serializeNode(node, 0, out);
  return out.join("\n");
}
