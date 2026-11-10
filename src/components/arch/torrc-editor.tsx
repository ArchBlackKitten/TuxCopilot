// Tor section → "Your torrc": the whole /etc/tor/torrc, every option a row (switch it on or
// off, edit its value, read what it does), or the file as plain text. Saving waits for Apply;
// Tor checks the new file first and nothing changes if it refuses.
import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronRight, CircleAlert, FileText, ListTree, Plus, RotateCcw, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  TORRC, addOption, changedLines, parseLine, parseTorrc, removeLine, restoreCommand, rowProblem, saveTorrcCommand, setOn, setValue, torrcInfo,
  type ManEntry, type OptionRow, type TorrcInfo,
} from "@/lib/torrc";
import { useArch } from "./store";
import { fingerprint } from "@/lib/changes";
import { TuxTag } from "./tux-tag";
import { tuxTorrcLine } from "@/lib/tux-own";

export function TorrcEditor({ confText }: { confText: string | null }) {
  const { machineVersion, stageSystem } = useArch();
  const { toast } = useToast();
  const [info, setInfo] = useState<TorrcInfo | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [mode, setMode] = useState<"guided" | "file">("guided");
  const [query, setQuery] = useState("");
  const [onlyOn, setOnlyOn] = useState(false);

  const load = useCallback(async () => {
    const i = await torrcInfo();
    setInfo(i);
    setText(i.text);
  }, []);
  useEffect(() => {
    void load();
  }, [load, machineVersion]);

  const rc = useMemo(() => (text === null ? null : parseTorrc(text)), [text]);
  const changes = useMemo(() => (info?.text != null && text !== null ? changedLines(info.text, text) : []), [info?.text, text]);
  // what TuxCopilot's own settings file also sets (it is read after torrc, where it is included)
  const alsoSet = useMemo(
    () => new Set((confText ?? "").split("\n").map((l) => parseLine(l)).filter((r) => r?.on).map((r) => r!.name.toLowerCase())),
    [confText],
  );

  if (!info || text === null || !rc) return info && info.text === null ? null : <Skeleton className="h-40" />;

  const man = (name: string) => info.man.get(name.toLowerCase());
  const q = query.trim().toLowerCase();
  const matches = (r: OptionRow) =>
    (!onlyOn || r.on) &&
    (!q || [r.name, r.value, r.note ?? "", ...r.help, ...(man(r.name)?.text ?? [])].some((s) => s.toLowerCase().includes(q)));
  const problems = rc.sections.flatMap((s) => s.groups.flatMap((g) => g.rows)).flatMap((r) => {
    const p = rowProblem(r, info.known);
    return p ? [`line ${r.index + 1}: ${p}`] : [];
  });
  const inUse = rc.sections.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.rows.filter((r) => r.on).length, 0), 0);
  const total = rc.sections.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.rows.length, 0), 0);

  // from the text as it is when the edit lands (a value saved on blur, then a switch clicked)
  const edit = (change: (t: string) => string) => setText((t) => (t === null ? t : change(t)));
  const save = () => {
    stageSystem(`Tor: save torrc (${changes.length} line${changes.length === 1 ? "" : "s"} changed)`, saveTorrcCommand(text), undefined, {
      id: "torrc",
      to: fingerprint(text ?? ""),
      ...(info?.text != null ? { from: fingerprint(info.text) } : {}),
    });
    toast({ title: "Your torrc — pending", description: "Apply (top bar) saves it. Tor checks it first; if Tor refuses it, nothing changes." });
  };

  return (
    <section className="space-y-3 rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Your torrc</span>
        <code className="text-[11px] text-muted-foreground">{TORRC}</code>
        <Badge variant="outline" className="px-1 py-0 text-[9px]">
          {inUse} of {total} options in use
        </Badge>
        <div className="ml-auto flex rounded-md border p-0.5">
          {(
            [
              ["guided", "Option by option", ListTree],
              ["file", "Whole file", FileText],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] ${mode === id ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Icon className="h-3 w-3" /> {label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Every setting Tor reads at start. Lines starting with <code>#</code> are switched off: turn one on to use it. The explanations
        come from the file itself, and from your Tor's own manual (<BookOpen className="inline h-3 w-3" />) for the rest.
        {alsoSet.size > 0 && " TuxCopilot's settings above are read after this file, so where both set an option, look at both."}
      </p>

      {info.pacnew && (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px]">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
          <span>
            A Tor update left its newer default beside yours as <code>/etc/tor/torrc.pacnew</code>. Your torrc is kept as it is. To see what
            the new default changes: <code>diff /etc/tor/torrc /etc/tor/torrc.pacnew</code>
          </span>
        </p>
      )}

      {rc.about.length > 0 && mode === "guided" && (
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">About this file</summary>
          <Prose lines={rc.about} />
        </details>
      )}

      {mode === "guided" ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1">
              <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input className="h-7 pl-7 text-xs" placeholder="Find an option, a word in its explanation…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <label className="flex items-center gap-1.5 text-[11px]">
              <Switch checked={onlyOn} onCheckedChange={setOnlyOn} /> only those in use
            </label>
          </div>
          {rc.sections.map((s, si) => {
            const groups = s.groups.map((g) => ({ ...g, rows: g.rows.filter(matches) })).filter((g) => g.rows.length);
            if (!groups.length) return null;
            const rows = groups.reduce((n, g) => n + g.rows.length, 0);
            return (
              <details key={s.title} open={si === 0 || !!q || onlyOn} className="group rounded-md border">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-medium">
                  <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
                  {s.title}
                  <span className="text-[10px] font-normal text-muted-foreground">
                    {rows} option{rows === 1 ? "" : "s"}
                  </span>
                </summary>
                <div className="divide-y divide-border/60 border-t">
                  {groups.map((g) => (
                    <div key={g.rows[0].index} className="space-y-1.5 px-3 py-2">
                      {g.intro.length > 0 && <Prose lines={g.intro} className="text-[11px] text-muted-foreground" />}
                      {g.rows.map((r) => (
                        <Row
                          key={`${r.index}:${r.on}:${r.value}`}
                          row={r}
                          man={man(r.name)}
                          problem={rowProblem(r, info.known)}
                          alsoSet={r.on && alsoSet.has(r.name.toLowerCase())}
                          onToggle={(on) => edit((t) => setOn(t, r.index, on))}
                          onValue={(v) => edit((t) => setValue(t, r.index, v))}
                          onRemove={() => edit((t) => removeLine(t, r.index))}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </details>
            );
          })}
          <AddOption names={info.names} man={man} onAdd={(name, value) => edit((t) => addOption(t, name, value).text)} />
        </>
      ) : (
        <Textarea
          spellCheck={false}
          className="h-[28rem] font-mono text-[11px] leading-snug"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      )}

      {changes.length > 0 && (
        <div className="space-y-1.5 rounded-md border border-primary/30 bg-primary/5 p-2">
          <div className="text-[11px] font-medium">
            What will change ({changes.length} line{changes.length === 1 ? "" : "s"})
          </div>
          <div className="max-h-40 space-y-0.5 overflow-auto font-mono text-[10px]">
            {changes.map((c, i) => (
              <div key={i}>
                <span className="text-muted-foreground">{String(c.line).padStart(3)} </span>
                {c.was !== null && <div className="inline text-red-300/90">− {c.was || " "}</div>}
                {c.was !== null && c.now !== null && <br />}
                {c.now !== null && (
                  <div className={`inline text-emerald-300/90 ${c.was !== null ? "pl-[4ch]" : ""}`}>+ {c.now || " "}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {problems.map((p) => (
        <p key={p} className="text-[11px] text-amber-300">
          {p}
        </p>
      ))}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {changes.length > 0 && (
          <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setText(info.text)}>
            Discard my edits
          </Button>
        )}
        <Button size="sm" className="h-7 text-[11px]" disabled={!changes.length} onClick={save}>
          Save torrc
        </Button>
      </div>

      {info.backups.length > 0 && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-muted-foreground">Earlier copies ({info.backups.length}) — kept each time you save</summary>
          <div className="mt-1 space-y-1">
            {[...info.backups].reverse().map((b) => (
              <div key={b} className="flex items-center gap-2">
                <code className="text-[10px]">/etc/tor/{b}</code>
                <span className="text-[10px] text-muted-foreground">{when(b)}</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto h-6 gap-1 px-2 text-[11px]"
                  title={restoreCommand(b)}
                  onClick={() => {
                    stageSystem(`Tor: put back the torrc from ${when(b)}`, restoreCommand(b), undefined, { id: "torrc", to: `backup:${b}` });
                    toast({ title: "Put back — pending", description: "Apply (top bar). Today's torrc is kept as a copy too." });
                  }}
                >
                  <RotateCcw className="h-3 w-3" /> Put back
                </Button>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

/** torrc.bak-20261026-190512 → 2026-10-26 19:05 */
function when(b: string): string {
  const m = b.match(/(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)/);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : b;
}

function Prose({ lines, className = "" }: { lines: string[]; className?: string }) {
  const paras = lines.join("\n").split(/\n\n+/);
  return (
    <div className={`space-y-1 leading-relaxed ${className}`}>
      {paras.map((p, i) => (
        <p key={i}>{p.replace(/\n/g, " ")}</p>
      ))}
    </div>
  );
}

function Row({
  row, man, problem, alsoSet, onToggle, onValue, onRemove,
}: {
  row: OptionRow;
  man: ManEntry | undefined;
  problem: string | null;
  alsoSet: boolean;
  onToggle: (on: boolean) => void;
  onValue: (v: string) => void;
  onRemove: () => void;
}) {
  const [value, setVal] = useState(row.value);
  const [open, setOpen] = useState(false);
  const commit = () => value !== row.value && onValue(value);
  const own = row.help.length ? row.help : null;
  return (
    <div className={`rounded-md px-2 py-1.5 ${row.on ? "bg-emerald-500/5" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Switch checked={row.on} onCheckedChange={onToggle} aria-label={`use ${row.name}`} />
        <code className={`text-xs ${row.on ? "font-semibold" : "text-muted-foreground"}`}>{row.name}</code>
        {tuxTorrcLine(`${row.name} ${row.value}`) && <TuxTag why={tuxTorrcLine(`${row.name} ${row.value}`)!} />}
        <Input
          className="h-7 min-w-40 flex-1 font-mono text-[11px]"
          value={value}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
        {man && (
          <button className={`text-muted-foreground hover:text-primary ${open ? "text-primary" : ""}`} title="what Tor's manual says" onClick={() => setOpen(!open)}>
            <BookOpen className="h-3.5 w-3.5" />
          </button>
        )}
        <button className="text-muted-foreground hover:text-red-400" title={`delete line ${row.index + 1}`} onClick={onRemove}>
          <X className="h-3.5 w-3.5" />
        </button>
        <span className="font-mono text-[9px] text-muted-foreground">line {row.index + 1}</span>
      </div>
      <div className="mt-0.5 space-y-0.5 pl-11 text-[10px] text-muted-foreground">
        {row.note && <p>{row.note}</p>}
        {own ? <Prose lines={own} /> : man && !open && <p className="line-clamp-2">{man.text[0]}</p>}
        {alsoSet && <p className="text-sky-300">TuxCopilot's settings above set {row.name} too.</p>}
        {problem && <p className="text-amber-300">{problem}</p>}
        {open && man && <ManText man={man} />}
      </div>
    </div>
  );
}

function ManText({ man }: { man: ManEntry }) {
  return (
    <div className="mt-1 space-y-1 rounded-md border bg-muted/30 p-2 text-[10px] leading-relaxed text-foreground/85">
      <code className="block text-[10px] text-primary">{man.usage}</code>
      <Prose lines={man.text} />
      <p className="text-muted-foreground">from man tor, {man.section.toLowerCase()}</p>
    </div>
  );
}

function AddOption({ names, man, onAdd }: { names: string[]; man: (n: string) => ManEntry | undefined; onAdd: (name: string, value: string) => void }) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const entry = name.trim() ? man(name.trim()) : undefined;
  const okName = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name.trim());
  const known = !names.length || names.some((n) => n.toLowerCase() === name.trim().toLowerCase());
  return (
    <div className="space-y-1.5 rounded-md border border-dashed p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium">Add an option</span>
        <Input list="tor-option-names" className="h-7 w-48 font-mono text-[11px]" placeholder="ExitNodes" value={name} onChange={(e) => setName(e.target.value)} />
        <datalist id="tor-option-names">
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <Input className="h-7 min-w-40 flex-1 font-mono text-[11px]" placeholder="its value" value={value} onChange={(e) => setValue(e.target.value)} />
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-[11px]"
          disabled={!okName}
          onClick={() => {
            onAdd(name.trim(), value);
            setName("");
            setValue("");
          }}
        >
          <Plus className="h-3 w-3" /> Add
        </Button>
      </div>
      {name.trim() && okName && !known && <p className="text-[10px] text-amber-300">Your Tor doesn't know an option called {name.trim()}.</p>}
      {entry && <ManText man={entry} />}
    </div>
  );
}
