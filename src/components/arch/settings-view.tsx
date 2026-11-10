// Settings: TuxCopilot's own settings only — what the app has learned about this machine (and the OS override when detection
// is wrong), where commands run, run safety, its lock and signing, and the Look (look-panel). ("Is it safe to remove…?" is in Apps.)
import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Cpu, MessageCircleQuestion, Footprints } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CONFIRM_MAX, terminals } from "@/lib/api";
import { errText } from "@/lib/host";
import { pendingOsChoice } from "@/lib/changes";
import { useArch } from "./store";
import { LookPanel } from "./look-panel";
import { WindowPanel } from "./window-panel";
import { BrainPanel } from "./brain-panel";
import { PenguinPanel } from "./penguin-panel";
import { LockAndSigningPanel } from "./security-panel";
import { OriginalPanel } from "./original-panel";

const AUTO = "__auto__";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5 text-sm">
      <span className="w-36 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

const list = (xs: string[]) => (xs.length ? xs.join(", ") : <span className="text-muted-foreground">none found</span>);

export function SettingsView() {
  const { profile, refreshing, refreshKnowledge, confirmCount, setConfirmCount, setOs, history, runTerminal, setRunTerminal } = useArch();
  const [terms, setTerms] = useState<{ installed: Array<[string, string]>; preferred: string | null } | null>(null);
  useEffect(() => {
    terminals().then(setTerms, () => setTerms({ installed: [], preferred: null }));
  }, []);
  const osPending = pendingOsChoice(history.pending);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  // the first-level reasons (not "needed by …"), counted — what the core is made of
  const groups = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of profile?.core ?? []) {
      const key = c.reason.startsWith("needed by") ? "needed by the above" : c.reason.replace(/ \(.*\)$/, "");
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => (a[0] === "needed by the above" ? 1 : b[0] === "needed by the above" ? -1 : b[1] - a[1]));
  }, [profile]);

  // waits for Apply like every other change; the core system is re-learned then
  const pick = (v: string) => {
    setOs(v === AUTO ? null : v);
    toast({ title: "OS change pending", description: "Apply (top bar) to re-learn the system for it." });
  };


  return (
    <div className="max-w-3xl space-y-4">
      <GuideAgain />
      <PenguinPanel />
      <LookPanel />
      <WindowPanel />
      <BrainPanel />
      <LockAndSigningPanel />
      <OriginalPanel />

      {/* ── your system ── */}
      <section className="rounded-lg border bg-card p-4">
        <div className="mb-2 flex items-center gap-2">
          <Cpu className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Your system</h2>
          <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1.5 text-xs" disabled={refreshing} onClick={() => void refreshKnowledge()}>
            <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} /> {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
        {!profile ? (
          <p className="text-sm text-muted-foreground">
            Could not read this machine yet (pacman's database was not readable). Press Refresh to try again.
          </p>
        ) : (
          <>
            <Row label="Operating system">
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={osPending !== undefined ? osPending ?? AUTO : profile.osChosen ? profile.osId : AUTO}
                  onValueChange={pick}
                >
                  <SelectTrigger className="h-8 w-64 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUTO} className="text-xs">
                      Detect automatically ({profile.detectedOsName})
                    </SelectItem>
                    {profile.osOptions.map((o) => (
                      <SelectItem key={o.id} value={o.id} className="text-xs">
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Badge variant="outline" className="text-[10px]">
                  {osPending !== undefined ? "pending — Apply to use it" : profile.osChosen ? "chosen by you" : "detected"}
                </Badge>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Pick your OS by hand if it was detected wrongly. It decides which of the distribution's own packages are
                treated as part of the system.
              </p>
            </Row>
            <Row label="Desktop right now">{profile.desktop ?? <span className="text-muted-foreground">unknown</span>}</Row>
            <Row label="Desktops installed">{list(profile.sessions)}</Row>
            <Row label="Kernels">{list(profile.kernels)}</Row>
            <Row label="Bootloader">{list(profile.bootloaders)}</Row>
            <Row label="Login screen">{profile.loginScreen ?? <span className="text-muted-foreground">none found</span>}</Row>
            <Row label="Your shell">{profile.shell ?? <span className="text-muted-foreground">unknown</span>}</Row>
            <Row label="Learned">{new Date(profile.detectedAt).toLocaleString()}</Row>

            <div className="mt-3 rounded-md border bg-background p-3">
              <p className="mb-2 text-xs">
                <span className="font-medium">{profile.core.length} packages</span> are this machine's core system. App
                Manager never offers to remove any of them:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {groups.map(([why, n]) => (
                  <Badge key={why} variant="secondary" className="text-[10px] font-normal">
                    {why} · {n}
                  </Badge>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      {/* ── run safety ── */}
      <section className="rounded-lg border bg-card p-4">
        <div className="mb-2 flex items-center gap-2">
          <MessageCircleQuestion className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Run safety</h2>
        </div>
        <Row label={'How many "Are you sure?"'}>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={String(confirmCount)} onValueChange={(v) => setConfirmCount(parseInt(v, 10))}>
              <SelectTrigger className="h-8 w-20 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: CONFIRM_MAX + 1 }, (_, n) => (
                  <SelectItem key={n} value={String(n)} className="text-xs">
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[11px] text-muted-foreground">
              {confirmCount === 0
                ? "No questions: live runs start as soon as you press Run or Play."
                : `Asked ${confirmCount === 1 ? "once" : `${confirmCount} times`} before anything runs for real. Dry runs never ask.`}
            </span>
          </div>
        </Row>
        <Row label="Where commands run">
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => runTerminal !== "" && setRunTerminal("", "")}
                className={`rounded-md border px-2.5 py-1 text-xs ${runTerminal === "" ? "border-primary/60 bg-primary/10 text-primary" : "hover:bg-accent/40"}`}
              >
                Inside TuxCopilot
              </button>
              {(terms?.installed ?? []).map(([id, name]) => (
                <button
                  key={id}
                  onClick={() => runTerminal !== id && setRunTerminal(id, name)}
                  className={`rounded-md border px-2.5 py-1 text-xs ${runTerminal === id ? "border-primary/60 bg-primary/10 text-primary" : "hover:bg-accent/40"}`}
                >
                  {name}
                  {terms?.preferred === id && <span className="ml-1 text-[10px] text-muted-foreground">(your desktop's choice)</span>}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {runTerminal === ""
                ? "Commands run in the panel at the bottom; sudo asks for your password in a small window."
                : "Each run opens a window of your terminal: you see everything live, type your password there, and can answer anything a command asks. The panel at the bottom shows the same and each step's result."}
              {terms && terms.installed.length === 0 && " No terminal TuxCopilot knows (kitty, WezTerm, Konsole, Alacritty, foot, Ghostty, GNOME Terminal, xterm) was found."}
            </p>
          </div>
        </Row>
      </section>
    </div>
  );
}

/** The guide (guide.ts), any time: from its first step. */
function GuideAgain() {
  const { guide, setGuide, setView } = useArch();
  return (
    <section data-guide="guide-again" className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 text-xs">
      <Footprints className="h-4 w-4 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">Fluff's guide</div>
        <div className="text-[11px] text-muted-foreground">A walk through every section, one step at a time: what to press next glows. Skip any step, stop whenever you like.</div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        disabled={guide !== null}
        onClick={() => {
          setView("home");
          setGuide(0);
        }}
      >
        {guide !== null ? "The guide is on" : "Show me around"}
      </Button>
    </section>
  );
}
