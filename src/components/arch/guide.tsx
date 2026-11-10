// The guide's pop-up (guide.ts): a small card in a corner, so the screen stays in view; the next
// thing to press glows. Next · Skip this step · No guide.
import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { errText } from "@/lib/host";
import { choosableNetworks, firewallState, networkZoneCommand, type FirewallState, type Network } from "@/lib/firewall";
import { screenLock } from "@/lib/screenlock";
import { iconUrl } from "@/lib/look-runtime";
import { gamesWords, glowFor, GUIDE, kindOf, laptopWords, next, ZONE_FOR, type NetworkKind } from "@/lib/guide";
import { useArch } from "./store";

const GLOW = "guide-glow";

/** The glow on one element at a time: found as soon as it is on screen, taken off when the step moves on. */
function useGlow(target: string | null) {
  useEffect(() => {
    if (!target) return;
    let el: Element | null = null;
    let tries = 0;
    let timer = 0;
    const find = () => {
      el = [...document.querySelectorAll(`[data-guide="${target}"]`)].find((e) => (e as HTMLElement).offsetParent !== null) ?? null;
      if (el) {
        el.classList.add(GLOW);
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else if (++tries < 50) timer = window.setTimeout(find, 100);
    };
    find();
    return () => {
      window.clearTimeout(timer);
      el?.classList.remove(GLOW);
    };
  }, [target]);
}

export function Guide() {
  const { guide, setGuide, view, securityTab, setView, openSecurity, look } = useArch();
  const step = guide === null ? null : GUIDE[guide];
  useGlow(step ? glowFor(step, view, securityTab) : null);
  if (!step || guide === null) return null;
  const go = () => {
    const n = next(guide, view, securityTab);
    if ("go" in n) {
      if (n.go.tab) openSecurity(n.go.tab);
      else setView(n.go.view);
    } else if ("step" in n) setGuide(n.step);
    else setGuide(null);
  };
  const skip = () => setGuide(guide + 1 < GUIDE.length ? guide + 1 : null);
  return (
    <div
      role="dialog"
      aria-label="Fluff's guide"
      className="fixed bottom-4 right-4 z-50 w-[min(24rem,calc(100vw-2rem))] space-y-2 rounded-lg border border-primary/40 bg-card p-3 text-xs shadow-xl"
      style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="flex items-start gap-2">
        <img src={iconUrl(look.icon)} alt="" className="h-9 w-9 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] text-muted-foreground">
            Fluff's guide · step {guide + 1} of {GUIDE.length}
          </div>
          <div className="text-sm font-semibold">{step.title}</div>
        </div>
        <button onClick={() => setGuide(null)} className="rounded p-1 text-muted-foreground hover:bg-accent" aria-label="No guide" title="No guide">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="leading-relaxed">{step.words}</p>
      {step.ask === "networks" && <AskNetworks />}
      {step.ask === "games" && <AskGames />}
      {step.ask === "laptop" && <SayLaptop />}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <Button size="sm" className="h-7 text-xs" onClick={go}>
          {guide + 1 === GUIDE.length ? "Done" : "Next"}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={skip}>
          Skip this step
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs text-muted-foreground" onClick={() => setGuide(null)}>
          No guide
        </Button>
      </div>
    </div>
  );
}

const KINDS: Array<{ id: NetworkKind; label: string; note: string }> = [
  { id: "home", label: "Home", note: "your own: the other computers here are trusted a little more (sharing files and the screen with them works)" },
  { id: "work", label: "Work", note: "people you know, but not your own" },
  { id: "public", label: "Public", note: "a café, a station, a hotel: the safest — anything you don't call home or work" },
];

/** Each network you are on: home, work or public — its own zone, at once ("Are you sure?" first). */
function AskNetworks() {
  const { runQuick, dryRun, machineVersion } = useArch();
  const { toast } = useToast();
  const [f, setF] = useState<FirewallState | null | undefined>(undefined);
  const load = useCallback(() => void firewallState().then(setF, () => setF(null)), []);
  useEffect(load, [load, machineVersion]);
  if (f === undefined) return <p className="text-muted-foreground">Fluff is looking at your networks…</p>;
  if (!f) return <p className="text-warn">Fluff couldn't read your networks.</p>;
  if (!f.firewalldOn) return <p className="text-warn">The firewall is off, so a network's zone does nothing yet. Choose a level in the cards (Good security switches it on), then answer here.</p>;
  const nets = choosableNetworks(f);
  if (!nets.length) return <p className="text-muted-foreground">You aren't on a Wi-Fi or cable network now (a VPN is left as it is).</p>;
  const choose = async (n: Network, k: NetworkKind) => {
    const err = await runQuick(`${n.name}: ${KINDS.find((x) => x.id === k)!.label}`, networkZoneCommand(n, ZONE_FOR[k]), dryRun);
    if (err) toast({ title: `Fluff couldn't finish: ${n.name}`, description: errText(err), variant: "destructive" });
    load();
  };
  return (
    <div className="space-y-1.5 rounded-md border p-2">
      {nets.map((n) => {
        const now = kindOf(n.zone);
        return (
          <div key={n.uuid} className="space-y-1">
            <div className="font-medium">
              {n.name} <span className="font-normal text-muted-foreground">({n.kind === "802-11-wireless" ? "Wi-Fi" : n.kind === "802-3-ethernet" ? "cable" : n.kind}{now ? `, now ${now}` : `, now its own zone: ${n.zone}`})</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  title={k.note}
                  onClick={() => now !== k.id && void choose(n, k.id)}
                  className={`rounded-md border px-2 py-0.5 ${now === k.id ? "border-primary/60 bg-primary/10" : "hover:bg-accent/40"}`}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <p className="text-[10px] text-muted-foreground">Public follows your Network level. Home and work keep their own zone whatever the level.</p>
    </div>
  );
}

/** Do you play games? It changes what Fluff recommends for System. */
function AskGames() {
  const [plays, setPlays] = useState<boolean | null>(null);
  return (
    <div className="space-y-1.5 rounded-md border p-2">
      <div className="font-medium">Do you play games on this computer?</div>
      <div className="flex gap-1">
        {([true, false] as const).map((v) => (
          <button key={String(v)} onClick={() => setPlays(v)} className={`rounded-md border px-2 py-0.5 ${plays === v ? "border-primary/60 bg-primary/10" : "hover:bg-accent/40"}`}>
            {v ? "Yes" : "No"}
          </button>
        ))}
      </div>
      {plays !== null && <p className="text-muted-foreground">{gamesWords(plays)}</p>}
    </div>
  );
}

/** A laptop is read, never asked. */
function SayLaptop() {
  const [laptop, setLaptop] = useState<boolean | null>(null);
  useEffect(() => void screenLock().then((s) => setLaptop(s.laptop), () => setLaptop(null)), []);
  return laptop === null ? null : <p className="text-muted-foreground">{laptopWords(laptop)}</p>;
}
