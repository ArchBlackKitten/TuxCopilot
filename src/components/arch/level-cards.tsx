// The template for all security (levels.ts), drawn as Tor's presets are (tor-view): one row of cards,
// "now" on the one in use and "Fluff recommends" on Good security; the one you pick says what it sets
// and what it costs, and a button sets it. Every command still goes through "Are you sure?".
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LEVELS, levelLabel, RECOMMENDED, type Level, type LevelCard } from "@/lib/levels";

export function LevelCards({
  title,
  cards,
  now,
  busy,
  onChoose,
  note,
  slip,
}: {
  title: string;
  cards: LevelCard[];
  now: Level | null;
  busy: boolean;
  onChoose: (l: Level) => void;
  note?: string;
  slip?: { words: string; back: Level } | null; // the level you chose isn't the one now (level-chosen.ts)
}) {
  const [pick, setPick] = useState<Level>(now ?? RECOMMENDED);
  useEffect(() => setPick(now ?? RECOMMENDED), [now]);
  const card = cards.find((c) => c.id === pick)!;
  return (
    <section data-guide="levels" className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-[11px] text-muted-foreground">{now ? `now: ${levelLabel(now)}` : "now: your own choice, in the panels below"}</span>
      </div>
      {slip && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warn/50 bg-warn/10 p-2 text-[11px]" role="status">
          <span className="flex-1 text-warn">{slip.words}</span>
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy || !!cards.find((c) => c.id === slip.back)?.unavailable} onClick={() => onChoose(slip.back)}>
            Put back {levelLabel(slip.back)}
          </Button>
        </div>
      )}
      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
        {LEVELS.map(({ id, label }) => {
          const c = cards.find((x) => x.id === id)!;
          return (
            <button
              key={id}
              onClick={() => setPick(id)}
              aria-pressed={pick === id}
              className={`rounded-md border px-2.5 py-2 text-left transition-colors ${pick === id ? "border-primary/60 bg-primary/10" : "hover:bg-accent/40"}`}
            >
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
                {label}
                {now === id && <Badge variant="outline" className="px-1 py-0 text-[9px]">now</Badge>}
                {id === RECOMMENDED && <Badge variant="outline" className="px-1 py-0 text-[9px] text-primary">Fluff recommends</Badge>}
                {id === "arch" && <Badge variant="outline" className="px-1 py-0 text-[9px]">the way back</Badge>}
              </div>
              <div className="text-[10px] leading-relaxed text-muted-foreground">{c.what}</div>
            </button>
          );
        })}
      </div>
      <div className="space-y-1 rounded-md border p-2 text-[11px]">
        <div className="font-medium">{levelLabel(pick)} sets:</div>
        <ul className="ml-4 list-disc text-muted-foreground">
          {card.sets.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        {card.caution && <p className="text-warn">{card.caution}</p>}
        {card.unavailable && <p className="text-warn">{card.unavailable}</p>}
        {note && <p className="text-[10px] text-muted-foreground">{note}</p>}
        <div className="pt-1">
          <Button size="sm" className="h-7 text-xs" disabled={busy || pick === now || !!card.unavailable} onClick={() => onChoose(pick)}>
            {pick === now ? `${levelLabel(pick)} is on` : busy ? "Fluff is working…" : `Use ${levelLabel(pick)}`}
          </Button>
        </div>
      </div>
    </section>
  );
}
