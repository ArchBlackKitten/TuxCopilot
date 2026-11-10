// The Tor section: is Tor connected, its settings (SOCKS port, bridges, nyx) written to
// TuxCopilot's own file, your whole torrc (torrc-editor), the tools around it, Troubleshoot. Saving the settings waits for
// Apply like every other change; it is checked by Tor itself before it takes effect.
import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleAlert, Copy, ExternalLink, Globe, RefreshCw, ShieldCheck, Stethoscope, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { openExternal } from "@/lib/host";
import {
  BRIDGE_DAYS, PRESETS, SHADOW_CHECK, SHADOW_OFF, TOR_SETUP, bridgesAge, checkCommand, diagnoseTor, fetchBuiltins, installCommand, renderConf, saveCommand, shadowOnCommand, torState,
  type BridgeMode, type Builtins, type Preset, type TorSettings, type TorState,
} from "@/lib/tor";
import { FluffSays } from "./fluff-says";
import { TroubleshootDialog } from "./troubleshoot-dialog";
import { TorrcEditor } from "./torrc-editor";
import { PortHint } from "./ports-panel";
import { AppLink } from "./app-link";
import { useArch } from "./store";
import { fingerprint } from "@/lib/changes";

const BASICS = [
  { command: "systemctl status tor", note: "is it running, and its last lines" },
  { command: "journalctl -u tor -f", note: "Tor's log live — watch it connect (Ctrl+C to stop)" },
  { command: "torsocks curl https://check.torproject.org/api/ip", note: "a terminal program through Tor; IsTor:true means it worked" },
  { command: "sudo systemctl restart tor", note: "restart it" },
  { command: "nyx", note: "watch Tor live (needs “Let nyx watch Tor”)" },
];

const BRIDGE_CHOICES: Array<{ id: BridgeMode; label: string; note: string }> = [
  { id: "off", label: "Off", note: "connect to Tor directly — right for most networks" },
  { id: "snowflake", label: "Snowflake", note: "works almost everywhere, even where Tor is blocked; a bit slower" },
  { id: "obfs4", label: "obfs4 (built-in)", note: "Tor's own published obfs4 bridges" },
  { id: "own", label: "My own bridges", note: "paste lines from bridges.torproject.org or the Telegram bot @GetBridgesBot" },
];

export function TorView() {
  const { runQuick, dryRun, machineVersion, stageSystem } = useArch();
  const { toast } = useToast();
  const [st, setSt] = useState<TorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [builtins, setBuiltins] = useState<Builtins | null>(null);
  const [form, setForm] = useState<TorSettings | null>(null);
  const [own, setOwn] = useState("");
  const [doctorOpen, setDoctorOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await torState();
      setSt(s);
      setForm(s.settings);
      setOwn(s.settings.ownBridges.join("\n"));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, machineVersion]);
  useEffect(() => {
    void fetchBuiltins().then(setBuiltins);
  }, []);

  const run = async (label: string, command: string) => {
    const err = await runQuick(label, command, dryRun);
    if (err) toast({ title: `Fluff couldn't finish: ${label}`, description: err, variant: "destructive" });
  };
  const copy = (command: string) => {
    void navigator.clipboard.writeText(command);
    toast({ title: "Fluff copied it", description: command.slice(0, 80) });
  };

  // bridges keep their date while they stay the same; new ones start today
  const today = new Date().toISOString().slice(0, 10);
  const sameBridges = !!st && !!form && st.settings.bridges === form.bridges && (form.bridges !== "own" || st.settings.ownBridges.join("\n") === own.split("\n").filter((l) => l.trim()).join("\n"));
  const wanted = form ? { ...form, ownBridges: own.split("\n"), bridgesSince: form.bridges === "off" ? null : sameBridges && st?.settings.bridgesSince ? st.settings.bridgesSince : today } : null;
  const rendered = useMemo(() => (wanted && builtins ? renderConf(wanted, builtins) : null), [wanted?.socksPort, wanted?.bridges, wanted?.control, wanted?.preset, wanted?.bridgesSince, own, builtins]); // eslint-disable-line react-hooks/exhaustive-deps
  const choosePreset = (p: Preset) => form && setForm({ ...form, preset: p, bridges: p === "ghost" && form.bridges === "off" ? "snowflake" : form.bridges });
  const age = st && st.settings.bridges !== "off" ? bridgesAge(st.settings.bridgesSince) : null;
  const stuck = !!st?.active && (st.bootstrap?.percent ?? 0) < 100;
  const changed = !!rendered && rendered.text !== (st?.confText ?? renderConf(st?.settings ?? form!, builtins!).text);
  const portOk = !!form && Number.isInteger(form.socksPort) && form.socksPort >= 1024 && form.socksPort <= 65535;

  const save = () => {
    if (!rendered || rendered.problems.length || !portOk) return;
    const now = st?.confText ?? renderConf(st?.settings ?? form!, builtins!).text;
    stageSystem("Tor settings", saveCommand(rendered.text), undefined, { id: "tor.settings", to: fingerprint(rendered.text), from: fingerprint(now) });
    toast({ title: "Tor settings — pending", description: "Apply (top bar) writes them; Tor checks them first and keeps the old ones if it refuses." });
  };

  const connected = st?.active && st.bootstrap?.percent === 100;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Globe className="h-5 w-5 text-violet-400" />
        <h2 className="text-sm font-semibold">Tor</h2>
        {loading && !st ? (
          <Skeleton className="h-5 w-24" />
        ) : !st?.version ? (
          <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-400">not installed</Badge>
        ) : !st.active ? (
          <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-400">installed · stopped</Badge>
        ) : connected ? (
          <Badge variant="outline" className="border-emerald-500/40 text-[10px] text-emerald-400">connected · Tor {st.version}</Badge>
        ) : (
          <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-400">connecting · {st.bootstrap?.percent ?? 0}%</Badge>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => void load()}>
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setDoctorOpen(true)}>
            <Stethoscope className="h-3 w-3" /> Troubleshoot
          </Button>
        </div>
      </div>

      {st && !st.version && (
        <Callout text="Tor is not installed. This installs the Tor service from the official repos and starts it now and at every boot. (For browsing, Tor Browser below is all you need — it carries its own Tor.)">
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" title={TOR_SETUP} onClick={() => void run("Set up Tor", TOR_SETUP)}>
            <Wrench className="h-3 w-3" /> Set up Tor
          </Button>
        </Callout>
      )}
      {st?.version && !st.active && (
        <Callout text="Tor is installed but its service is stopped.">
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" onClick={() => void run("Start Tor", "sudo systemctl enable --now tor.service")}>
            <Wrench className="h-3 w-3" /> Start Tor
          </Button>
        </Callout>
      )}

      {/* connection */}
      {st?.active && (
        <section className="space-y-2 rounded-md border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Connection</span>
            <span className="text-[11px] text-muted-foreground">
              programs reach Tor at <code>127.0.0.1:{st.settings.socksPort}</code> (SOCKS5)
            </span>
            <Button size="sm" variant="outline" className="ml-auto h-6 gap-1 px-2 text-[11px]" title={checkCommand(st.settings.socksPort)} onClick={() => void run("Am I on Tor?", checkCommand(st.settings.socksPort))}>
              <ShieldCheck className="h-3 w-3" /> Am I on Tor?
            </Button>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full ${connected ? "bg-emerald-500/80" : "bg-amber-400/80"}`} style={{ width: `${Math.max(3, st.bootstrap?.percent ?? 0)}%` }} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {st.bootstrap ? `${st.bootstrap.percent}% — ${st.bootstrap.summary}` : "no progress in Tor's log yet"}
            {" · "}“Am I on Tor?” asks check.torproject.org through Tor; the answer shows in the terminal panel (IsTor: true).
          </p>
        </section>
      )}

      {/* Fluff's advice on bridges */}
      {st?.active && st.settings.bridges !== "off" && (age === null || age >= BRIDGE_DAYS || stuck) && (
        <FluffSays
          action={
            <div className="flex flex-wrap gap-1.5">
              {st.settings.bridges === "own" ? (
                <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]" onClick={() => void openExternal("https://bridges.torproject.org/options")}>
                  Get new bridges <ExternalLink className="h-3 w-3" />
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => form && setForm({ ...form, bridges: form.bridges === "snowflake" ? "obfs4" : "snowflake" })}>
                  Try {st.settings.bridges === "snowflake" ? "obfs4" : "Snowflake"} bridges instead
                </Button>
              )}
            </div>
          }
        >
          {stuck
            ? "Tor isn't getting through with these bridges. They may be blocked, busy or gone: change them. "
            : age === null
              ? "Change your bridges now and then: Fluff doesn't know how long these have been in use. "
              : `Your bridges have been in use for ${age} days. Change them now and then — after about a month, or whenever something seems strange (slow, failing, blocked): bridges get found and blocked over time. `}
          {st.settings.bridges === "own" ? "bridges.torproject.org (or the Telegram bot @GetBridgesBot) gives you fresh ones; paste them below." : "Saving the settings again takes the Tor Project's current list."}
        </FluffSays>
      )}

      {/* presets */}
      {st?.version && form && (
        <section className="space-y-2 rounded-md border bg-card p-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-semibold">How careful should Tor be?</span>
            <span className="text-[11px] text-muted-foreground">a preset sets several of Tor's options at once; Save settings (below) keeps it</span>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => choosePreset(p.id)}
                className={`rounded-md border px-2.5 py-2 text-left transition-colors ${form.preset === p.id ? "border-primary/60 bg-primary/10" : "hover:bg-accent/40"}`}
              >
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  {p.label}
                  {st.settings.preset === p.id && <Badge variant="outline" className="px-1 py-0 text-[9px]">now</Badge>}
                </div>
                <div className="text-[10px] leading-relaxed text-muted-foreground">{p.what}</div>
              </button>
            ))}
          </div>
          {(() => {
            const p = PRESETS.find((x) => x.id === form.preset)!;
            return (
              <div className="rounded-md border p-2 text-[11px]">
                <div className="font-medium">{p.label} sets:</div>
                <ul className="ml-4 list-disc text-muted-foreground">
                  {p.changes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                {p.caution && <p className="mt-1 text-warn">{p.caution}</p>}
                <p className="mt-1 text-[10px] text-muted-foreground">
                  No setting makes you anonymous by itself: what you sign in to, and what programs send about you, still tell. For the web, use Tor Browser.
                </p>
              </div>
            );
          })()}
          {form.preset !== "shadow" && st.settings.preset !== "shadow" && (
            <FluffSays>For most people: Secure for everyday programs, Ghost when it really matters. Shadow is for when nothing at all may leave outside Tor.</FluffSays>
          )}
        </section>
      )}

      {/* Shadow: the firewall side */}
      {st?.version && (st.settings.preset === "shadow" || st.shadowOn) && (
        <section className="space-y-2 rounded-md border border-violet-500/40 bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Shadow</span>
            <Badge variant="outline" className={`text-[10px] ${st.shadowOn ? "text-emerald-400" : "text-muted-foreground"}`}>{st.shadowOn ? "on — everything goes through Tor" : "off"}</Badge>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Tor's side is in the settings; this is the firewall's side: the rules that send every connection into Tor and stop all others. They
            stay on until you turn them off or restart the computer.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {!st.shadowOn ? (
              <Button size="sm" className="h-7 px-2 text-[11px]" disabled={st.settings.preset !== "shadow" || !connected} title={shadowOnCommand()} onClick={() => void run("Shadow on", shadowOnCommand())}>
                Turn Shadow on
              </Button>
            ) : (
              <>
                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" title={SHADOW_CHECK} onClick={() => void run("Is everything on Tor?", SHADOW_CHECK)}>
                  <ShieldCheck className="mr-1 h-3 w-3" /> Is everything on Tor?
                </Button>
                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" title={SHADOW_OFF} onClick={() => void run("Shadow off", SHADOW_OFF)}>
                  Turn Shadow off
                </Button>
              </>
            )}
          </div>
          {!st.shadowOn && st.settings.preset === "shadow" && !connected && <p className="text-[11px] text-warn">Tor must be connected first: with Shadow on, nothing else gets out.</p>}
          {st.shadowOn && st.settings.preset !== "shadow" && (
            <FluffSays>Shadow's rules are on, but Tor's settings are no longer Shadow: nothing gets out. Turn Shadow off, or save the Shadow preset again.</FluffSays>
          )}
        </section>
      )}

      {/* settings */}
      {st?.version && form && (
        <section className="space-y-3 rounded-md border bg-card p-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-semibold">Settings</span>
            <span className="text-[11px] text-muted-foreground">kept in /etc/tor/torrc.d/tuxcopilot.conf, its own file — Your torrc (below) changes only when you edit it there</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="w-28 text-xs">SOCKS port</span>
            <Input
              className="h-7 w-24 font-mono text-xs"
              inputMode="numeric"
              value={String(form.socksPort)}
              onChange={(e) => setForm({ ...form, socksPort: Number(e.target.value.replace(/\D/g, "")) || 0 })}
            />
            {portOk ? <PortHint port={form.socksPort} mine={(p) => p.service === "tor.service"} /> : <span className="text-[11px] text-muted-foreground">a number from 1024 to 65535</span>}
            <span className="text-[10px] text-muted-foreground">(9050 is Tor's usual one)</span>
          </div>

          <div className="space-y-1.5">
            <span className="text-xs">Bridges — for networks that block Tor</span>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {BRIDGE_CHOICES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setForm({ ...form, bridges: c.id })}
                  className={`rounded-md border px-2.5 py-1.5 text-left transition-colors ${form.bridges === c.id ? "border-primary/60 bg-primary/10" : "hover:bg-accent/40"}`}
                >
                  <div className="text-xs font-medium">{c.label}</div>
                  <div className="text-[10px] text-muted-foreground">{c.note}</div>
                </button>
              ))}
            </div>
            {form.bridges === "own" && (
              <Textarea rows={4} className="font-mono text-[10px]" placeholder="obfs4 192.0.2.1:443 FINGERPRINT cert=… iat-mode=0" value={own} onChange={(e) => setOwn(e.target.value)} />
            )}
            {(form.bridges === "snowflake" || form.bridges === "obfs4") && builtins && (
              <p className="text-[10px] text-muted-foreground">
                {builtins.fetchedAt
                  ? `${builtins.bridges[form.bridges]?.length ?? 0} ${form.bridges} bridges, as the Tor Project publishes them today.`
                  : "The Tor Project's bridge list could not be fetched (offline, or blocked)."}{" "}
                <button className="underline" onClick={() => void openExternal("https://bridges.torproject.org/options")}>
                  bridges.torproject.org <ExternalLink className="inline h-2.5 w-2.5" />
                </button>
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs">Let nyx watch Tor</div>
              <div className="text-[10px] text-muted-foreground">opens Tor's control port to programs in the tor group (ControlPort 9051, cookie login)</div>
            </div>
            <Switch checked={form.control} onCheckedChange={(v) => setForm({ ...form, control: v })} />
          </div>

          {rendered && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-muted-foreground">the file that will be written</summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-term p-2 text-[10px] text-term-foreground">{rendered.text}</pre>
            </details>
          )}
          {rendered?.problems.map((p) => (
            <p key={p} className="text-[11px] text-amber-300">{p}</p>
          ))}
          <div className="flex justify-end">
            <Button size="sm" className="h-7 text-[11px]" disabled={!changed || !portOk || !!rendered?.problems.length} onClick={save}>
              Save settings
            </Button>
          </div>
        </section>
      )}

      {st?.version && <TorrcEditor confText={st.confText} />}

      {/* tools */}
      {st && (
        <section className="overflow-hidden rounded-md border bg-card">
          <div className="border-b border-border/60 p-3 text-sm font-semibold">Tor apps</div>
          <div className="divide-y divide-border/60">
            {st.tools.map((t) => (
              <div key={t.pkg} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium">{t.installed ? <AppLink name={t.pkg} source={t.aur ? "aur" : "pacman"} className="font-sans" /> : t.name}</span>
                    {t.aur && <Badge variant="outline" className="px-1 py-0 text-[9px] text-amber-400">AUR</Badge>}
                    {t.installed && <Badge variant="outline" className="px-1 py-0 text-[9px] text-emerald-400">installed</Badge>}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{t.what}. {t.how}.</div>
                </div>
                {!t.installed && (
                  <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]" title={installCommand(t)} onClick={() => void run(`Install ${t.name}`, installCommand(t))}>
                    <Wrench className="h-3 w-3" /> Install
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-md border bg-card p-3">
        <p className="mb-2 text-sm font-semibold">The commands worth remembering</p>
        <div className="space-y-1">
          {BASICS.map((b) => (
            <div key={b.command} className="flex items-center gap-2">
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{b.command}</code>
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{b.note}</span>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => copy(b.command)} aria-label="Copy">
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      </section>

      <TroubleshootDialog open={doctorOpen} onClose={() => { setDoctorOpen(false); void load(); }} title="Tor" diagnose={diagnoseTor} />
    </div>
  );
}

function Callout({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 sm:flex-row sm:items-center">
      <CircleAlert className="h-4 w-4 shrink-0 text-amber-400" />
      <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-foreground/85">{text}</p>
      {children}
    </div>
  );
}
