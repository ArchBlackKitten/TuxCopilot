// The sidebar's sections, each with a ≡ handle: drag it (or press ↑ / ↓ on it) to put the sections
// in your order. Kept with your look; Apply saves it, like a palette.
// Dragging follows the pointer itself, not the browser's drag-and-drop, which Tauri's own file
// dropping can swallow on Linux. When the window is too short for every section, the list scrolls
// by itself, with its own bar, so every section stays reachable in a small window; dragging near its top or bottom edge scrolls it too.
import { useRef, useState, type ComponentType } from "react";
import { Menu } from "lucide-react";
import { dropIndex, isOwnOrder, moveSection, orderedSections, orderLabel } from "@/lib/sections";
import { useArch, type View } from "./store";

export interface Section {
  id: View;
  label: string;
  icon: ComponentType<{ className?: string }>;
  hint: string;
}

export function useSections(nav: Section[]): Section[] {
  const { look } = useArch();
  return orderedSections(nav, look.order);
}

export function SectionNav({ nav }: { nav: Section[] }) {
  const { view, setView, look, setLook, history } = useArch();
  const shown = orderedSections(nav, look.order);
  const ids = shown.map((s) => s.id as string);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const rows = useRef<Array<HTMLDivElement | null>>([]);
  const navRef = useRef<HTMLElement>(null);
  const waiting = history.pending.filter((c) => c.kind === "look").at(-1)?.label ?? null;
  const save = (order: string[]) => setLook({ ...look, order }, orderLabel(waiting, isOwnOrder(nav, order)));
  // while dragging, the rows show where it would land
  const live = drag ? moveSection(ids, drag.from, drag.to) : ids;
  const list = live.map((id) => shown.find((s) => s.id === id)!);
  const draggedId = drag ? ids[drag.from] : null;

  return (
    <>
      <nav ref={navRef} className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2" aria-label="Main">
        {list.map(({ id, label, icon: Icon, hint }, i) => (
          <div
            key={id}
            ref={(el) => {
              rows.current[i] = el;
            }}
            className={`group flex items-center rounded-md transition-colors ${draggedId === id ? "bg-primary/10 ring-1 ring-primary/40" : ""}`}
          >
            <button
              data-guide={`nav-${id}`}
              onClick={() => setView(id)}
              title={hint}
              className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                view === id ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${view === id ? "text-primary" : ""}`} />
              <span className="truncate">{label}</span>
            </button>
            <span
              role="button"
              tabIndex={0}
              aria-label={`Move ${label}: drag it, or press the up and down arrows`}
              title="Drag to move this section (or ↑ / ↓)"
              className={`flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/40 hover:text-foreground focus:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary group-hover:text-muted-foreground ${drag ? "cursor-grabbing" : ""}`}
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                const from = ids.indexOf(id);
                setDrag({ from, to: from });
              }}
              onPointerMove={(e) => {
                if (!drag) return;
                const box = navRef.current?.getBoundingClientRect();
                if (box && e.clientY < box.top + 24) navRef.current!.scrollBy(0, -12);
                else if (box && e.clientY > box.bottom - 24) navRef.current!.scrollBy(0, 12);
                const middles = rows.current.slice(0, list.length).map((r) => (r ? r.getBoundingClientRect().top + r.getBoundingClientRect().height / 2 : 0));
                const to = dropIndex(middles, e.clientY);
                if (to !== drag.to) setDrag({ ...drag, to });
              }}
              onPointerUp={() => {
                if (drag && drag.from !== drag.to) save(moveSection(ids, drag.from, drag.to));
                setDrag(null);
              }}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={(e) => {
                const at = ids.indexOf(id);
                const to = e.key === "ArrowUp" ? at - 1 : e.key === "ArrowDown" ? at + 1 : null;
                if (to === null) return;
                e.preventDefault();
                if (to >= 0 && to < ids.length) save(moveSection(ids, at, to));
              }}
            >
              <Menu className="h-3.5 w-3.5" />
            </span>
          </div>
        ))}
      </nav>
      {!isOwnOrder(nav, look.order) && (
        <button onClick={() => save([])} className="mx-4 mb-1 text-left text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          Put the sections in their first order
        </button>
      )}
    </>
  );
}
