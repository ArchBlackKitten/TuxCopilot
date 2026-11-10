// Security → Network, the firewall (once its own section): is one on, what each zone in use lets in (in plain words), and what
// Fluff recommends. Opening it asks for no password (it reads firewalld's own files); each fix
// shows its command in "Are you sure?" and asks for the password in the terminal.
import { useCallback, useEffect, useState } from "react";
import { ConnsPanel } from "./conns-panel";
import { TunnelsPanel } from "./tunnels-panel";
import { BrickWall, CircleAlert, CircleCheck, CircleX, Info, RefreshCw, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { installedApps } from "@/lib/api";
import {
  advice, choosableNetworks, closeCommand, currentPreset, FIREWALL_WORDS, firewallState, FW_PRESETS, networkZoneCommand, presetChanges, presetCommand, serviceWords, targetWords, ZONE_WORDS,
  type Advice, type FirewallState, type FwPreset, type Network,
} from "@/lib/firewall";
import { errText } from "@/lib/host";
import { servicesList, type Service } from "@/lib/services";
import { currentDns, DNS_CHOICES, DNS_FILE, dnsCommand, dnsConf, dnsState, ENCRYPTION, parseResolvectl, programsAskResolved, recommendedDns, resolvConfMode, whoAnswers, type DnsChoice, type DnsState, type Encryption } from "@/lib/dns";
import { installedNotNeeded, isOn, offCommand as notNeededOff, onCommand as notNeededOn } from "@/lib/not-needed";
import { vpnNow } from "@/lib/tunnels";
import { FluffSays } from "./fluff-says";
import { useArch } from "./store";

const ICON = { ok: CircleCheck, info: Info, warn: CircleAlert, bad: CircleX } as const;
const TONE = { ok: "text-ok", info: "text-info", warn: "text-warn", bad: "text-bad" } as const;

export function FirewallView() {
  const { runQuick, dryRun, machineVersion } = useArch();
  const { toast } = useToast();
  const [f, setF] = useState<FirewallState | null>(null);
  const [services, setServices] = useState<Service[] | null>(null);
  const [apps, setApps] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [dns, setDns] = useState<DnsState | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setFailed(null);
    try {
      const [state, s, a, d] = await Promise.all([firewallState(), servicesList().catch(() => null), installedApps().catch(() => []), dnsState().catch(() => null)]);
      setDns(d);
      setF(state);
      setServices(s);
      setApps(new Set(a.map((x) => x.name)));
    } catch (e) {
      setFailed(errText(e));
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => void load(), [load, machineVersion]);

  const run = async (label: string, build: () => string) => {
    let command: string;
    try {
      command = build();
    } catch (e) {
      return toast({ title: "Fluff didn't run it", description: errText(e), variant: "destructive" });
    }
    const err = await runQuick(label, command, dryRun);
    if (err) toast({ title: `Fluff couldn't finish: ${label}`, description: err, variant: "destructive" });
  };

  const list: Advice[] = f ? advice(f, services, apps) : [];
  const sshd = services?.find((s) => s.name === "sshd.service");
  const sshServer = !!sshd && (sshd.state === "running" || sshd.enabled === "enabled");
  const now = f ? currentPreset(f, sshServer, apps) : null;
  const [picked, setPicked] = useState<FwPreset | null>(null);
  const shown = picked ?? now ?? "public";
  const vpns = f ? vpnNow(f.networks) : null;
  const usesVpn = !!vpns?.length;
  const dnsNow = dns?.resolvedOn ? parseResolvectl(dns.status) : null;
  const dnsSet = currentDns(dns?.ours ?? null);
  const rec = recommendedDns(usesVpn);
  const [dnsPick, setDnsPick] = useState<DnsChoice | null>(null);
  const [encPick, setEncPick] = useState<Encryption | null>(null);
  const dnsChoice = dnsPick ?? dnsSet?.choice ?? rec.choice;
  const enc = encPick ?? (dnsSet && dnsSet.choice !== "network" ? dnsSet.encryption : rec.encryption);
  const notNeeded = services ? installedNotNeeded(services) : [];
  const ports = new Map((f?.servicePorts ?? []).map(([s, name, p]) => [s, { name, ports: p }]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <BrickWall className="h-5 w-5 text-primary" />
        <h2 className="text-sm font-semibold">Firewall</h2>
        <span className="text-[11px] text-muted-foreground">what other computers can reach on this one — opening this asks for no password</span>
        <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1 px-2 text-[11px]" onClick={() => void load()} disabled={busy}>
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} /> Check again
        </Button>
      </div>
      {failed && <p className="rounded-md border border-bad/40 bg-bad/5 p-2 text-[11px]">Fluff couldn't read the firewall: {failed}</p>}
      {busy && !f ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        f && (
          <>
            <FluffSays>
              A firewall decides what other computers may reach on this one. Going out (websites, updates) is never blocked by it; coming in is
              allowed only for what you let in. {f.firewalldOn ? "firewalld is on." : f.ufwOn ? "ufw is on." : "None is on right now."}
            </FluffSays>
            <section className="divide-y divide-border/60 overflow-hidden rounded-md border bg-card">
              {list.map((a) => {
                const Icon = ICON[a.level];
                return (
                  <div key={a.id} className="flex items-start gap-2 px-3 py-2">
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${TONE[a.level]}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium">{a.title}</div>
                      {a.detail && <p className="text-[11px] text-muted-foreground">{a.detail}</p>}
                    </div>
                    {a.fix && (
                      <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[10px]" title={a.fix.command} onClick={() => void run(a.fix!.label, () => a.fix!.command)}>
                        <Wrench className="h-3 w-3" /> {a.fix.label}
                      </Button>
                    )}
                  </div>
                );
              })}
            </section>

            {f.firewalldOn && (
              <section className="space-y-2 rounded-md border bg-card p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold">How closed should this computer be?</span>
                  <span className="text-[11px] text-muted-foreground">Fluff's settings: each sets up one of firewalld's zones and uses it for every network</span>
                </div>
                <div className="grid gap-1.5 sm:grid-cols-3">
                  {FW_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPicked(p.id)}
                      className={`rounded-md border px-2.5 py-2 text-left transition-colors ${shown === p.id ? "border-primary/60 bg-primary/10" : "hover:bg-accent/40"}`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-medium">
                        {p.label}
                        {now === p.id && <Badge variant="outline" className="px-1 py-0 text-[9px]">now</Badge>}
                        {p.id === "public" && <Badge variant="outline" className="px-1 py-0 text-[9px] text-primary">Fluff recommends</Badge>}
                      </div>
                      <div className="text-[10px] leading-relaxed text-muted-foreground">{p.what}</div>
                    </button>
                  ))}
                </div>
                {now === null && <p className="text-[11px] text-muted-foreground">Now: your own settings ({f.defaultZone ?? "no default zone"}) — none of Fluff's exactly.</p>}
                {(() => {
                  const p = FW_PRESETS.find((x) => x.id === shown)!;
                  const ch = presetChanges(f, p.id, sshServer, apps);
                  return (
                    <div className="space-y-1 rounded-md border p-2 text-[11px]">
                      <div><span className="font-medium">{p.label} lets in:</span> <span className="text-muted-foreground">{p.lets}{sshServer && p.id !== "drop" ? ", and SSH (an SSH server runs here)" : ""}.</span></div>
                      {ch.opens.length > 0 && <div><span className="font-medium">Opens:</span> {ch.opens.map((s) => <span key={s} className="mr-2"><code className="rounded bg-muted px-1 font-mono text-[10px]">{s}</code> <span className="text-muted-foreground">{serviceWords(s)}</span></span>)}</div>}
                      {ch.closes.length > 0 && <div><span className="font-medium">Closes:</span> {ch.closes.map((s) => <span key={s} className="mr-2"><code className="rounded bg-muted px-1 font-mono text-[10px]">{s}</code> <span className="text-muted-foreground">{serviceWords(s)}</span></span>)}</div>}
                      {ch.closesPorts.length > 0 && <div><span className="font-medium">Closes ports opened by hand:</span> {ch.closesPorts.map((x) => <code key={x} className="mr-2 rounded bg-muted px-1 font-mono text-[10px]">{x}</code>)}</div>}
                      {ch.target && <div><span className="font-medium">And:</span> <span className="text-muted-foreground">what nothing lets in is {ch.target === "DROP" ? "dropped, unanswered" : "refused, as firewalld does by default"} (target {ch.target})</span></div>}
                      {p.caution && <p className="text-warn">{p.caution}</p>}
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          className="h-7 gap-1 px-2 text-[11px]"
                          disabled={now === p.id}
                          title={(() => { try { return presetCommand(f, p.id, sshServer, apps); } catch { return ""; } })()}
                          onClick={() => void run(`Firewall: ${p.label}`, () => presetCommand(f, p.id, sshServer, apps)).then(() => void load())}
                        >
                          <Wrench className="h-3 w-3" /> {now === p.id ? `${p.label} is on` : `Use ${p.label}`}
                        </Button>
                      </div>
                    </div>
                  );
                })()}
                <FluffSays>
                  Out and about is right everywhere. On a laptop, the best of both: keep Out and about for every network, and set only your home network to
                  Home below. Stealth is for when this computer should not be seen at all.
                </FluffSays>
                {choosableNetworks(f).length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium">Your networks</div>
                    {choosableNetworks(f).map((n: Network) => (
                      <div key={n.uuid} className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="min-w-0 flex-1 truncate">
                          {n.name} <span className="text-muted-foreground">({n.device})</span>
                        </span>
                        <span className="text-muted-foreground">uses</span>
                        <select
                          aria-label={`zone for ${n.name}`}
                          value={n.zone}
                          onChange={(e) => void run(`${n.name}: ${e.target.value ? FW_PRESETS.find((p) => p.id === e.target.value)?.label ?? e.target.value : "the setting above"}`, () => networkZoneCommand(n, e.target.value)).then(() => void load())}
                          className="h-6 rounded border bg-background px-1 text-[11px]"
                        >
                          <option value="">the setting above ({FW_PRESETS.find((p) => p.id === f.defaultZone)?.label ?? f.defaultZone ?? "default"})</option>
                          {FW_PRESETS.map((p) => (
                            <option key={p.id} value={p.id}>{p.label}</option>
                          ))}
                          {n.zone && !FW_PRESETS.some((p) => p.id === n.zone) && <option value={n.zone}>{n.zone} (its own)</option>}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {services && notNeeded.length > 0 && (
              <section className="space-y-2 rounded-md border bg-card p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold">Switched on, but maybe not needed</span>
                  <span className="text-[11px] text-muted-foreground">what listens for others or reaches out — off if you don't use it, on again any day</span>
                </div>
                <div className="divide-y divide-border/60 overflow-hidden rounded-md border">
                  {[...notNeeded].sort((a, b) => Number(isOn(b.s)) - Number(isOn(a.s))).map((n) => {
                    const on = isOn(n.s);
                    return (
                      <div key={n.service} className="flex flex-wrap items-start gap-2 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
                            {n.label}
                            <code className="text-[10px] font-normal text-muted-foreground">{n.service}</code>
                            <Badge variant="outline" className={`px-1 py-0 text-[9px] ${on ? "text-warn" : "text-ok"}`}>{on ? "on" : "off"}</Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground">{n.what} Needed {n.needed}.</p>
                          {on && <p className="text-[11px]"><span className="text-primary">Fluff:</span> {n.advice}</p>}
                        </div>
                        <Button
                          size="sm"
                          variant={on ? "outline" : "ghost"}
                          className="h-6 px-2 text-[10px]"
                          title={on ? notNeededOff(n) : notNeededOn(n)}
                          onClick={() => void run(`${n.label}: ${on ? "off" : "on"}`, () => (on ? notNeededOff(n) : notNeededOn(n))).then(() => void load())}
                        >
                          {on ? "Turn off" : "Turn on"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="space-y-2 rounded-md border bg-card p-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold">DNS — who answers "where is this website?"</span>
                <span className="text-[11px] text-muted-foreground">before any website opens, its name is looked up; whoever answers sees every name</span>
              </div>
              {!dns?.resolvedOn ? (
                <p className="text-[11px] text-muted-foreground">
                  Fluff sets DNS through systemd-resolved, which isn't running here, so this part can't change anything yet. Your network (or your VPN) answers.
                </p>
              ) : !programsAskResolved(dns) ? (
                <p className="text-[11px] text-warn">
                  Your programs don't ask systemd-resolved: /etc/resolv.conf is kept by something else (mode “{resolvConfMode(dns.status) ?? "unknown"}” — often your VPN or
                  NetworkManager). A DNS Fluff set here wouldn't be used, so this part changes nothing. While your VPN is on, its own DNS answers; switch the VPN off, and look here again.
                </p>
              ) : (
                <>
                  {dnsNow && (
                    <p className="text-[11px]">
                      <span className="text-muted-foreground">Answering now:</span> {whoAnswers(dnsNow)}. {dnsNow.llmnr ? "LLMNR is on (an old Windows naming system; Fluff turns it off with any choice below)." : ""}
                    </p>
                  )}
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {DNS_CHOICES.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setDnsPick(c.id)}
                        className={`rounded-md border px-2.5 py-2 text-left transition-colors ${dnsChoice === c.id ? "border-primary/60 bg-primary/10" : "hover:bg-accent/40"}`}
                      >
                        <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
                          {c.label}
                          {dnsSet?.choice === c.id && <Badge variant="outline" className="px-1 py-0 text-[9px]">now</Badge>}
                          {c.id === rec.choice && <Badge variant="outline" className="px-1 py-0 text-[9px] text-primary">Fluff recommends</Badge>}
                        </div>
                        <div className="text-[10px] leading-relaxed text-muted-foreground">{c.what}</div>
                        {c.servers.length > 0 && <div className="mt-0.5 font-mono text-[9px] text-muted-foreground/80">{c.servers.slice(0, 2).map((x) => x.replace(/#.*/, "")).join(", ")}</div>}
                      </button>
                    ))}
                  </div>
                  {dnsChoice !== "network" && (
                    <div className="space-y-1">
                      <div className="text-xs font-medium">Encrypted?</div>
                      <div className="grid gap-1.5 sm:grid-cols-3">
                        {ENCRYPTION.map((e) => (
                          <button
                            key={e.id}
                            onClick={() => setEncPick(e.id)}
                            className={`rounded-md border px-2.5 py-1.5 text-left transition-colors ${enc === e.id ? "border-primary/60 bg-primary/10" : "hover:bg-accent/40"}`}
                          >
                            <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
                              {e.label}
                              {e.id === rec.encryption && <Badge variant="outline" className="px-1 py-0 text-[9px] text-primary">Fluff recommends</Badge>}
                            </div>
                            <div className="text-[10px] leading-relaxed text-muted-foreground">{e.what}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {usesVpn && (
                    <p className="text-[11px] text-muted-foreground">
                      You use a VPN. While it is on, its own DNS answers too (inside the tunnel), so Fluff recommends “Encrypted when possible”: the VPN's server isn't
                      encrypted, and “Always” could leave you without DNS while it's on. What you choose here also answers when the VPN is off.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className="text-[10px] text-muted-foreground">Fluff checks a lookup right after; if it fails, your old settings come back by themselves.</span>
                    <Button
                      size="sm"
                      className="h-7 gap-1 px-2 text-[11px]"
                      disabled={!!dnsSet && dnsSet.choice === dnsChoice && (dnsChoice === "network" || dnsSet.encryption === enc)}
                      title={`writes ${DNS_FILE}`}
                      onClick={() => void run(`DNS: ${DNS_CHOICES.find((c) => c.id === dnsChoice)!.label}`, () => dnsCommand(dnsConf(dnsChoice, enc))).then(() => void load())}
                    >
                      <Wrench className="h-3 w-3" /> Use it
                    </Button>
                  </div>
                </>
              )}
            </section>

            <details className="rounded-md border bg-card p-3">
              <summary className="cursor-pointer text-sm font-semibold">What each part means</summary>
              <dl className="mt-2 space-y-1.5">
                {FIREWALL_WORDS.map((w) => (
                  <div key={w.term} className="text-[11px]">
                    <dt className="inline font-medium">{w.term}: </dt>
                    <dd className="inline text-muted-foreground">{w.words}</dd>
                  </div>
                ))}
              </dl>
            </details>

            {f.zones.map((z) => (
              <section key={z.name} className="space-y-2 rounded-md border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{z.short || z.name}</span>
                  {z.default && <Badge variant="outline" className="px-1 py-0 text-[9px]">default</Badge>}
                  {z.changed && <Badge variant="outline" className="px-1 py-0 text-[9px] text-muted-foreground" title="it is in /etc/firewalld: changed from firewalld's own">changed</Badge>}
                  <span className="text-[11px] text-muted-foreground">{ZONE_WORDS[z.name] ?? z.description}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  What nothing lets in: it {targetWords(z.target)}.{z.masquerade ? " It also passes other computers' traffic on (masquerade) — something here, like Docker or a virtual machine, needs it." : ""}
                </p>
                {z.connections.length > 0 && <p className="text-[11px]"><span className="text-muted-foreground">Used by:</span> {z.connections.join(", ")}</p>}
                <div className="space-y-1">
                  <div className="text-[11px] font-medium">{z.target === "ACCEPT" ? "Lets everything in" : z.services.length || z.ports.length ? "Lets in" : "Lets nothing in (only answers to what this computer asked for)"}</div>
                  {z.services.map((s) => (
                    <div key={s} className="flex flex-wrap items-center gap-2 text-[11px]">
                      <code className="rounded bg-muted px-1 font-mono text-[10px]">{s}</code>
                      <span className="text-muted-foreground">{serviceWords(s)}</span>
                      {ports.get(s)?.ports.length ? <span className="text-[10px] text-muted-foreground/70">({ports.get(s)!.ports.join(", ")})</span> : null}
                      {z.target !== "ACCEPT" && (
                        <Button size="sm" variant="ghost" className="ml-auto h-5 px-1.5 text-[10px]" title={closeCommand(z.name, s)} onClick={() => void run(`Close ${s} (${z.name})`, () => closeCommand(z.name, s))}>
                          Close
                        </Button>
                      )}
                    </div>
                  ))}
                  {z.ports.map((p) => (
                    <div key={p} className="text-[11px]">
                      <code className="rounded bg-muted px-1 font-mono text-[10px]">{p}</code> <span className="text-muted-foreground">a port opened by number (the Ports section says what listens there)</span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
            {f.firewalldOn && (
              <p className="text-[10px] text-muted-foreground">
                Fluff reads firewalld's saved settings. A change made with firewall-cmd without --permanent lasts only until the next restart and doesn't show
                here; every fix here is saved (--permanent) and applied at once (--reload).
              </p>
            )}
          </>
        )
      )}
      <ConnsPanel />
      <TunnelsPanel vpns={vpns} />
    </div>
  );
}
