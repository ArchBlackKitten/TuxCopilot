// Settings → Look: your look (all of it in one file: import one, export yours), the
// palettes — built in, from your desktop's KDE / Krita colour schemes, or imported — with a
// colour-blind-safe version of each, and the app's icon. Choosing shows at once; Apply keeps it.
import { useEffect, useMemo, useState } from "react";
import { Check, Download, FolderOpen, ImageUp, Palette as PaletteIcon, RotateCcw, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { errText } from "@/lib/host";
import { exportSigner, importVerdict, saveFile, savedNote } from "@/lib/integrity";
import { VISIONS, forVision, fromKde, readability, toKde, type Palette } from "@/lib/palette";
import { allPalettes, fromLookFile, paletteOf, toLookFile, withLookFile, withPalette, withoutPalette } from "@/lib/look";
import { colorSchemes, decodeText, iconFromFile, iconUrl, openFile } from "@/lib/look-runtime";
import { useArch } from "./store";

export function LookPanel() {
  const { look, setLook } = useArch();
  const { toast } = useToast();
  const [schemes, setSchemes] = useState<Array<{ path: string; palette: Palette }> | null>(null);
  useEffect(() => {
    colorSchemes()
      .then((list) => setSchemes(list.flatMap((s) => {
        const p = fromKde(s.text);
        return p ? [{ path: s.path, palette: p }] : [];
      })))
      .catch(() => setSchemes([]));
  }, []);

  const current = paletteOf(look);
  const shown = forVision(current, look.vision);
  const warnings = readability(shown);
  const icon = useMemo(() => iconUrl(look.icon), [look.icon]);
  const fail = (title: string, e: unknown) => toast({ title, description: errText(e), variant: "destructive" });
  const pending = (what: string, note = "") =>
    toast({ title: `${what} — pending`, description: `You see it now; Apply (top bar) keeps it, Undo takes it back. ${note}`.trim() });

  const choose = (p: Palette) => setLook(withPalette(look, p), `Palette: ${p.name}`);

  const importLook = async () => {
    try {
      const f = await openFile("look");
      if (!f) return;
      const v = importVerdict(f.integrity);
      if (!v.ok) return toast({ title: "Fluff didn't import it", description: v.note, variant: "destructive" });
      const p = fromLookFile(decodeText(f.base64));
      if (typeof p === "string") return toast({ title: "Fluff didn't import it", description: p, variant: "destructive" });
      setLook(withLookFile(look, p), `Look: ${p.name}`);
      pending(`The look “${p.name}”`, v.note);
    } catch (e) {
      fail("Fluff didn't import it", e);
    }
  };

  const exportLook = async () => {
    try {
      const name = current.name === "Arch" && !look.icon ? "TuxCopilot" : current.name;
      const saved = await saveFile(`${name.replace(/[^\w-]+/g, "-")}.tuxlook`, toLookFile(look, name));
      if (saved) toast({ title: "Fluff saved your look", description: `${savedNote(saved, exportSigner())} Give it to anyone with TuxCopilot: Import a look.` });
    } catch (e) {
      fail("Fluff didn't save it", e);
    }
  };

  const changeIcon = async () => {
    try {
      const f = await openFile("picture");
      if (!f) return;
      const v = importVerdict(f.integrity);
      if (!v.ok) return toast({ title: "Fluff didn't use it", description: v.note, variant: "destructive" });
      const next = { ...look, icon: await iconFromFile(f.name, f.base64) };
      setLook(next, `Icon: ${f.name}`);
      pending("The new icon");
    } catch (e) {
      fail("That picture could not be used", e);
    }
  };

  const importScheme = async () => {
    try {
      const f = await openFile("colors");
      if (!f) return;
      const v = importVerdict(f.integrity);
      if (!v.ok) return toast({ title: "Fluff didn't import it", description: v.note, variant: "destructive" });
      const p = fromKde(decodeText(f.base64));
      if (!p) return toast({ title: "Fluff didn't import it", description: "That file holds no KDE / Krita colours.", variant: "destructive" });
      choose(p);
      pending(`The palette “${p.name}”`);
    } catch (e) {
      fail("Fluff didn't import it", e);
    }
  };

  const exportScheme = async () => {
    try {
      const saved = await saveFile(`${current.name.replace(/[^\w-]+/g, "")}.colors`, toKde(current, look.vision));
      if (saved) toast({ title: "Fluff saved your colour scheme", description: `${savedNote(saved, exportSigner())} In ~/.local/share/color-schemes, KDE Plasma and Krita offer it among their own.` });
    } catch (e) {
      fail("Fluff didn't save it", e);
    }
  };

  const palettes = allPalettes(look);
  const installed = (schemes ?? []).filter((s) => !palettes.some((p) => p.id === s.palette.id));

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2">
        <PaletteIcon className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Look</h2>
        <span className="text-[11px] text-muted-foreground">shows as soon as you choose; Apply keeps it</span>
      </div>

      {/* your look */}
      <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
        <img src={icon} alt="" className="h-14 w-14" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Your look</div>
          <div className="text-[11px] text-muted-foreground">
            {current.name} · {VISIONS.find((v) => v.id === look.vision)!.name.toLowerCase()} · {look.icon ? look.icon.name : "Fluff, TuxCopilot's penguin"}
          </div>
          <div className="text-[10px] text-muted-foreground">The whole look in one file, to share: colours, colour vision and icon — nothing private.</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" onClick={() => void importLook()}>
            <Upload className="h-3 w-3" /> Import a look…
          </Button>
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" onClick={() => void exportLook()}>
            <Download className="h-3 w-3" /> Export this look…
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => void changeIcon()}>
            <ImageUp className="h-3 w-3" /> Change the icon…
          </Button>
          {look.icon && (
            <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setLook({ ...look, icon: null }, "Icon: Fluff")}>
              <RotateCcw className="h-3 w-3" /> Back to Fluff
            </Button>
          )}
        </div>
      </div>

      {/* palettes */}
      <div className="space-y-2">
        <div className="text-xs font-medium">Palette</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {palettes.map((p) => (
            <Swatch
              key={p.id}
              palette={p}
              vision={look.vision}
              chosen={p.id === current.id}
              onChoose={() => choose(p)}
              onRemove={look.imported.some((x) => x.id === p.id) ? () => setLook(withoutPalette(look, p.id), `Remove the palette ${p.name}`) : undefined}
            />
          ))}
        </div>
        {warnings.length > 0 && <p className="text-[11px] text-amber-300">Hard to read: {warnings.join("; ")}.</p>}
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" onClick={() => void importScheme()}>
            <FolderOpen className="h-3 w-3" /> Import a KDE / Krita colour scheme…
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => void exportScheme()}>
            <Download className="h-3 w-3" /> Export this palette for KDE / Krita…
          </Button>
        </div>
      </div>

      {/* colour vision */}
      <div className="space-y-1.5">
        <div className="text-xs font-medium">Colour vision</div>
        <div className="grid gap-1.5 sm:grid-cols-3">
          {VISIONS.map((v) => (
            <button
              key={v.id}
              onClick={() => setLook({ ...look, vision: v.id }, `Colour vision: ${v.name.toLowerCase()}`)}
              className={`rounded-md border px-2.5 py-1.5 text-left transition-colors ${look.vision === v.id ? "border-primary/60 bg-primary/10" : "hover:bg-accent/40"}`}
            >
              <div className="text-xs font-medium">{v.name}</div>
              <div className="text-[10px] text-muted-foreground">{v.note}</div>
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Every palette has these versions. Monochrome, True black and Manga Monotone use greys only, so they read the same for
          everyone, including people who see no colour at all.
        </p>
      </div>

      {/* from this machine */}
      <details className="text-xs">
        <summary className="cursor-pointer font-medium">
          Colour schemes on this computer{" "}
          <span className="font-normal text-muted-foreground">
            ({schemes === null ? "looking…" : installed.length}) — KDE Plasma's and Krita's, one click each
          </span>
        </summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {installed.map((s) => (
            <Swatch key={s.path} palette={s.palette} vision={look.vision} chosen={false} note={s.path.replace(/^\/home\/[^/]+/, "~")} onChoose={() => choose(s.palette)} />
          ))}
          {schemes !== null && installed.length === 0 && <p className="text-[11px] text-muted-foreground">none found, or all of them are above already</p>}
        </div>
      </details>
    </section>
  );
}

/** A palette as a little window: its background, text, accent and five meanings. */
function Swatch({
  palette, vision, chosen, note, onChoose, onRemove,
}: {
  palette: Palette;
  vision: Parameters<typeof forVision>[1];
  chosen: boolean;
  note?: string;
  onChoose: () => void;
  onRemove?: () => void;
}) {
  const c = forVision(palette, vision);
  return (
    <div className={`group relative rounded-md border p-1.5 transition-colors ${chosen ? "border-primary ring-1 ring-primary/50" : "hover:border-primary/40"}`}>
      <button onClick={onChoose} className="block w-full text-left">
        <div className="flex h-12 items-center gap-2 rounded px-2" style={{ background: c.background, color: c.foreground, border: `1px solid ${c.border}` }}>
          <span className="text-sm font-semibold">Aa</span>
          <span className="rounded px-1.5 py-0.5 text-[9px]" style={{ background: c.primary, color: c.primaryForeground }}>
            Apply
          </span>
          <span className="ml-auto flex gap-1">
            {[c.good, c.caution, c.bad, c.info, c.special].map((x, i) => (
              <span key={i} className="h-2.5 w-2.5 rounded-full" style={{ background: x }} />
            ))}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1 px-0.5">
          {chosen && <Check className="h-3 w-3 text-primary" />}
          <span className="truncate text-[11px] font-medium">{palette.name}</span>
          {palette.light && <Badge variant="outline" className="px-1 py-0 text-[8px]">light</Badge>}
          {palette.monochrome && <Badge variant="outline" className="px-1 py-0 text-[8px]">greys</Badge>}
        </div>
        <div className="truncate px-0.5 text-[9px] text-muted-foreground">{note ?? palette.from}</div>
      </button>
      {onRemove && (
        <button className="absolute right-1 top-1 hidden rounded bg-background/80 p-0.5 text-muted-foreground hover:text-red-400 group-hover:block" title="remove this palette" onClick={onRemove}>
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
