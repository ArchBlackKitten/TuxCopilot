// The sections in your order: drag each by its ≡ handle. The order is kept with your look (look.ts `order`),
// by id; Apply saves it like a palette. A section TuxCopilot adds later appears where it belongs,
// not lost at the bottom; one that is gone is simply left out.

export function orderedSections<T extends { id: string }>(nav: T[], order: string[]): T[] {
  const byId = new Map(nav.map((n) => [n.id, n]));
  const out: T[] = [...new Set(order)].flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])); // each once
  nav.forEach((n, i) => {
    if (out.includes(n)) return;
    // a section you never placed: after the lowest, in your order, of those that come before it in
    // TuxCopilot's own order — so it never lands between sections you put together
    const at = Math.max(-1, ...nav.slice(0, i).map((p) => out.indexOf(p)));
    out.splice(at + 1, 0, n);
  });
  return out;
}

/** The ids after moving the one at `from` to `to`. */
export function moveSection(ids: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || from >= ids.length || to < 0 || to >= ids.length) return ids;
  const out = [...ids];
  const [it] = out.splice(from, 1);
  out.splice(to, 0, it);
  return out;
}

/** While dragging: which place the pointer is over, from the rows' middles (top to bottom). */
export function dropIndex(middles: number[], y: number): number {
  const i = middles.findIndex((m) => y < m);
  return i === -1 ? middles.length - 1 : i;
}

/** Your order is TuxCopilot's own: nothing to keep. */
export const isOwnOrder = (nav: Array<{ id: string }>, order: string[]): boolean => order.length === 0 || orderedSections(nav, order).every((n, i) => n.id === nav[i].id);

/** The change's label. A look change carries the whole look, and replaces one waiting before it, so
 *  what that one said (a palette, an icon) stays in the label instead of vanishing from your list. */
export function orderLabel(waiting: string | null, own: boolean): string {
  const now = own ? "Sections in TuxCopilot's own order" : "Sections in your order";
  if (!waiting) return now;
  const before = waiting.split(" · ").filter((part) => !/^sections in /i.test(part));
  return before.length ? `${before.join(" · ")} · ${now.charAt(0).toLowerCase()}${now.slice(1)}` : now;
}
