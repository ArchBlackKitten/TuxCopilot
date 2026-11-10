// Each sub-section's row of level cards (levels.ts, level-cards.tsx), above its own panels.
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { installedApps, runEnd } from "@/lib/api";
import { errText } from "@/lib/host";
import { inputControl } from "@/lib/input-control";
import { storageControl } from "@/lib/storage-control";
import { usbguardState } from "@/lib/usbguard";
import { applyDevices, devicesCards, devicesLevel, type DevicesNow } from "@/lib/level-devices";
import { dnsState } from "@/lib/dns";
import { firewallState } from "@/lib/firewall";
import { servicesList } from "@/lib/services";
import { networkCards, networkCommand, networkLevel, type NetworkNow } from "@/lib/level-network";
import { levelLabel, type Level } from "@/lib/levels";
import { accountsCards, accountsCommand, accountsLevel, type AccountsNow } from "@/lib/level-accounts";
import { screenLock } from "@/lib/screenlock";
import { loginFailures } from "@/lib/logins";
import { myGroups } from "@/lib/groups";
import { applySystem, systemCards, systemLevel, type SystemNow } from "@/lib/level-system";
import { kernelSettings } from "@/lib/hardening";
import { weeklyState } from "@/lib/weekly";
import { getRecorded, untrackedFingerprints } from "@/lib/filecheck";
import { changedHereLabel, chosenChange, chosenFor, getChosen, holding, refreshMarks, slipWords, type Chosen, type SecurityArea } from "@/lib/level-chosen";
import { LevelCards } from "./level-cards";
import { useArch } from "./store";

/** Each sub-section's run, waited for to its end: null only when it ran and ended well (or was a
 *  Dry Run); "no" when you said no at "Are you sure?"; otherwise what went wrong (said in a toast). */
function useRun() {
  const { runToEnd, dryRun } = useArch();
  const { toast } = useToast();
  return useCallback(
    async (label: string, command: string): Promise<string | null> => {
      const r = await runToEnd(label, command, dryRun);
      if (r.end === "ok" || r.end === "dry-run") return null;
      if (r.end === "no") return "no";
      toast({ title: `Fluff couldn't finish: ${label}`, description: errText(r.error), variant: "destructive" });
      return r.error ?? "failed";
    },
    [runToEnd, dryRun, toast],
  );
}

/** The level you chose for a sub-section (waiting in your changes, or saved), the notice when the
 *  level now is another, and remembering a choice that ended well (it waits for Apply). */
function useChosen(area: SecurityArea, now: Level | null | undefined) {
  const { history, machineVersion, stageChange, dryRun, securityTouched, untouch } = useArch();
  const [saved, setSaved] = useState<Chosen | null>(null);
  const waiting = history.pending.length;
  useEffect(() => void getChosen().then(setSaved), [machineVersion, waiting]);
  const chosen = saved && chosenFor(area, saved, history.pending);
  const touched = securityTouched.includes(area);
  // you changed something in a panel here, and the level is no longer the one you chose: that was
  // you, not something behind your back — Fluff stops watching it (it waits for Apply, like every edit)
  // (the panel's run may still be going: the mark stays until the level is seen to move, or a level is chosen)
  useEffect(() => {
    if (!touched || !saved || now === undefined || !chosen || now === chosen.level) return;
    const c = chosenChange(area, "arch", chosen);
    if (c) stageChange({ ...c, label: changedHereLabel(area, chosen.level) });
    untouch(area);
  }, [touched, saved, now, chosen, area, stageChange, untouch]);
  const remember = (l: Level) => {
    if (dryRun) return; // nothing changed for real
    untouch(area);
    const c = chosenChange(area, l, chosen ?? null);
    if (c) stageChange(c);
  };
  const words = touched ? null : slipWords(chosen ?? null, now);
  const slip = words && chosen ? { words, back: chosen.level } : null;
  return { remember, slip };
}

const readDevices = async (): Promise<DevicesNow | null> => {
  try {
    const [input, storage, usbguard] = await Promise.all([inputControl(), storageControl(), usbguardState()]);
    return { input, storage, usbguard };
  } catch {
    return null;
  }
};

export function DevicesLevels() {
  const { dryRun, machineVersion, checkHands } = useArch();
  const run = useRun();
  const [n, setN] = useState<DevicesNow | null>(null);
  const { remember, slip } = useChosen("devices", n ? devicesLevel(n) : undefined);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => void readDevices().then(setN), []);
  useEffect(load, [load, machineVersion]);
  if (!n) return null;
  return (
    <LevelCards
      title="Devices"
      cards={devicesCards(n)}
      now={devicesLevel(n)}
      slip={slip}
      busy={busy}
      onChoose={async (l) => {
        setBusy(true);
        try {
          const r = await applyDevices(l, n, { run, runEnd, state: readDevices, checkHands, dryRun });
          if (r === "done" || r === "nothing") remember(l);
        } finally {
          setBusy(false);
          load();
        }
      }}
    />
  );
}

const readNetwork = async (): Promise<NetworkNow | null> => {
  try {
    const [firewall, dns, services, apps] = await Promise.all([firewallState(), dnsState().catch(() => null), servicesList().catch(() => null), installedApps().catch(() => [])]);
    const sshd = services?.find((s) => s.name === "sshd.service");
    return { firewall, dns, sshServer: !!sshd && (sshd.state === "running" || sshd.enabled === "enabled"), apps: new Set(apps.map((a) => a.name)) };
  } catch {
    return null;
  }
};

/** A level whose whole change is one command (no hands to check): run it, then look again. */
function useSimpleLevel<N>(read: () => Promise<N | null>, area: SecurityArea, name: string, command: (l: Level, n: N) => string, level: (n: N) => Level | null) {
  const { machineVersion } = useArch();
  const { toast } = useToast();
  const run = useRun();
  const [n, setN] = useState<N | null>(null);
  const { remember, slip } = useChosen(area, n ? level(n) : undefined);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => void read().then(setN), [read]);
  useEffect(load, [load, machineVersion]);
  const choose = async (l: Level) => {
    if (!n) return;
    let c: string;
    try {
      c = command(l, n);
    } catch (e) {
      return toast({ title: "Fluff didn't run it", description: errText(e), variant: "destructive" });
    }
    if (!c) {
      remember(l); // already so: chosen all the same
      return load();
    }
    setBusy(true);
    try {
      if (!(await run(`${name}: ${levelLabel(l)}`, c))) remember(l);
    } finally {
      setBusy(false);
      load();
    }
  };
  return { n, busy, choose, slip };
}

export function NetworkLevels() {
  const { n, busy, choose, slip } = useSimpleLevel(readNetwork, "network", "Network", networkCommand, networkLevel);
  if (!n) return null;
  return (
    <LevelCards
      title="Network"
      cards={networkCards(n)}
      now={networkLevel(n)}
      slip={slip}
      busy={busy}
      onChoose={(l) => void choose(l)}
      note="Going out (websites, updates) is never blocked: a level decides what may come in, and who answers DNS. A network you gave a zone of its own keeps it."
    />
  );
}

const readAccounts = async (): Promise<AccountsNow | null> => {
  try {
    const [screen, journal, groups] = await Promise.all([screenLock(), loginFailures(), myGroups()]);
    return { screen, journal, groups };
  } catch {
    return null;
  }
};

export function AccountsLevels() {
  const { n, busy, choose, slip } = useSimpleLevel(readAccounts, "accounts", "Accounts & login", accountsCommand, accountsLevel);
  if (!n) return null;
  return (
    <LevelCards
      title="Accounts & login"
      cards={accountsCards(n)}
      now={accountsLevel(n)}
      slip={slip}
      busy={busy}
      onChoose={(l) => void choose(l)}
      note="The screen lock is KDE's own setting (yours, no password); the journal and your groups ask for it. Your login screen is set in its own settings."
    />
  );
}

const readSystem = async (waiting: boolean): Promise<SystemNow | null> => {
  try {
    const [kernel, weekly, recorded] = await Promise.all([kernelSettings(), weeklyState(), getRecorded()]);
    return { kernel, weekly, recorded, recordWaiting: waiting };
  } catch {
    return null;
  }
};

export function SystemLevels() {
  const { machineVersion, history, stageChange } = useArch();
  const { toast } = useToast();
  const run = useRun();
  const waiting = history.pending.some((c) => c.kind === "files.recorded");
  const [n, setN] = useState<SystemNow | null>(null);
  const { remember, slip } = useChosen("system", n ? systemLevel(n) : undefined);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => void readSystem(waiting).then(setN), [waiting]);
  useEffect(load, [load, machineVersion]);
  if (!n) return null;
  return (
    <LevelCards
      title="System"
      cards={systemCards(n)}
      now={systemLevel(n)}
      slip={slip}
      busy={busy}
      onChoose={async (l) => {
        setBusy(true);
        try {
          if ((await applySystem(l, n, { run, fingerprints: untrackedFingerprints, stage: stageChange })) === "done") remember(l);
        } catch (e) {
          toast({ title: "Fluff didn't run it", description: errText(e), variant: "destructive" });
        } finally {
          setBusy(false);
          load();
        }
      }}
      note={waiting ? "Your fingerprints' record waits in your changes: Apply (top bar) saves it, and then the level counts it." : "The fingerprints are kept in your locked database; secret files and private keys are never read."}
    />
  );
}

/** Each sub-section's level now (the helper's report: report-panel.tsx); null where it is a mix or unreadable. */
export async function readLevels(): Promise<Record<SecurityArea, Level | null>> {
  const [network, devices, accounts, system] = await Promise.all([
    readNetwork().then((n) => (n ? networkLevel(n) : null)),
    readDevices().then((n) => (n ? devicesLevel(n) : null)),
    readAccounts().then((n) => (n ? accountsLevel(n) : null)),
    readSystem(false).then((n) => (n ? systemLevel(n) : null)),
  ]);
  return { network, devices, accounts, system };
}

/** At a glance: each sub-section's level, a click opens it. */
export function LevelsAtAGlance() {
  const { machineVersion, history, openSecurity } = useArch();
  const waiting = history.pending.some((c) => c.kind === "files.recorded");
  const [levels, setLevels] = useState<Partial<Record<SecurityArea, Level | null>>>({});
  const [saved, setSaved] = useState<Chosen | null>(null);
  useEffect(() => void getChosen().then(setSaved), [machineVersion, history.pending.length]);
  // every level read: the ones that still hold get the weekly checkup's fingerprints taken again
  const read = Object.keys(levels).length === 4;
  useEffect(() => {
    if (read && saved) void refreshMarks(holding(saved, levels));
  }, [read, saved, levels]);
  useEffect(() => {
    setLevels({});
    const put = (k: SecurityArea, p: Promise<Level | null>) => void p.then((l) => setLevels((o) => ({ ...o, [k]: l })), () => setLevels((o) => ({ ...o, [k]: null })));
    put("network", readNetwork().then((n) => (n ? networkLevel(n) : null)));
    put("devices", readDevices().then((n) => (n ? devicesLevel(n) : null)));
    put("accounts", readAccounts().then((n) => (n ? accountsLevel(n) : null)));
    put("system", readSystem(waiting).then((n) => (n ? systemLevel(n) : null)));
  }, [machineVersion, waiting]);
  const rows = [
    { id: "network", label: "Network" },
    { id: "devices", label: "Devices" },
    { id: "accounts", label: "Accounts & login" },
    { id: "system", label: "System" },
  ] as const;
  return (
    <div data-guide="levels" className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
      {rows.map(({ id, label }) => {
        const l = levels[id];
        const chosen = saved ? chosenFor(id, saved, history.pending) : null;
        const moved = !!chosen && l !== undefined && l !== chosen.level;
        return (
          <button key={id} onClick={() => openSecurity(id)} className="rounded-md border bg-card px-2.5 py-2 text-left hover:bg-accent/30" title={`Open ${label}`}>
            <div className="text-xs font-medium">{label}</div>
            <div className={`text-[11px] ${l === "good" || l === "secured" || l === "hardened" ? "text-ok" : l === "arch" ? "text-warn" : "text-muted-foreground"}`}>
              {l === undefined ? "Fluff is looking…" : l === null ? "your own choice" : levelLabel(l)}
            </div>
            {moved && <div className="text-[10px] text-warn">You chose {levelLabel(chosen.level)}: something changed it</div>}
          </button>
        );
      })}
    </div>
  );
}
