// The Security section (Settings is only for TuxCopilot's own settings; the firewall is network
// security). Five sub-sections:
//   At a glance        every protection on one line, against what Fluff recommends; a click opens its panel
//   Network            the firewall, DNS, who your programs talk to (firewall-view)
//   Devices            keyboard and mouse control, USB sticks and SD cards, USBGuard
//   Accounts & login   your groups, the screen lock, wrong passwords
//   System             packages with security problems, your system files, the kernel's protections
// Each sub-section opens with its row of level cards — As it comes · Good security · Secured ·
// Hardened (levels.ts) — and its own panels below, to choose part by part.
// TuxCopilot's own lock and signing stay in Settings, with its other settings.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronRight, Globe, KeyRound, LayoutList, RefreshCw, Server, Usb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { anchorOf, glance, toLook, type GlanceInput, type GlanceLevel, type GlanceRow } from "@/lib/glance";
import { firewallState } from "@/lib/firewall";
import { firmwareState } from "@/lib/firmware";
import { myGroups } from "@/lib/groups";
import { inputControl } from "@/lib/input-control";
import { loginFailures } from "@/lib/logins";
import { screenLock } from "@/lib/screenlock";
import { byPackage, securityCheck } from "@/lib/security";
import { storageControl } from "@/lib/storage-control";
import { usbguardState } from "@/lib/usbguard";
import { getRecorded } from "@/lib/filecheck";
import { kernelSettings } from "@/lib/hardening";
import { FirewallView } from "./firewall-view";
import { InputControlPanel } from "./input-control-panel";
import { StorageControlPanel } from "./storage-control-panel";
import { UsbGuardPanel } from "./usbguard-panel";
import { GroupsPanel } from "./groups-panel";
import { ScreenLockPanel } from "./screenlock-panel";
import { LoginsPanel } from "./logins-panel";
import { SecurityCheck } from "./security-check";
import { SystemFilesPanel } from "./system-files-panel";
import { KernelPanel } from "./kernel-panel";
import { FirmwarePanel } from "./firmware-panel";
import { FluffSays } from "./fluff-says";
import { AccountsLevels, DevicesLevels, LevelsAtAGlance, NetworkLevels, SystemLevels } from "./level-sections";
import { useArch, type SecurityTab } from "./store";

const TABS: Array<{ id: SecurityTab; label: string; icon: typeof Globe }> = [
  { id: "glance", label: "At a glance", icon: LayoutList },
  { id: "network", label: "Network", icon: Globe },
  { id: "devices", label: "Devices", icon: Usb },
  { id: "accounts", label: "Accounts & login", icon: KeyRound },
  { id: "system", label: "System", icon: Server },
];

const DOT: Record<GlanceLevel, string> = { good: "text-ok", look: "text-warn", yours: "text-info", unknown: "text-muted-foreground" };
const DOT_WORDS: Record<GlanceLevel, string> = { good: "as Fluff recommends", look: "Fluff would change this", yours: "your choice", unknown: "not known yet" };

/** Each reading on its own: one that fails, or is slow, never holds up the others. */
/** At a glance's readings, each on its own (also the helper's report: report-panel.tsx). */
export const GLANCE_READERS: { [K in keyof GlanceInput]-?: () => Promise<GlanceInput[K]> } = {
  firewall: firewallState,
  packages: () => securityCheck().then(byPackage),
  firmware: firmwareState,
  input: inputControl,
  storage: storageControl,
  usbguard: usbguardState,
  groups: myGroups,
  screen: screenLock,
  logins: () => loginFailures(),
  files: () => getRecorded().then((r) => r ?? "none"),
  kernel: kernelSettings,
};

/** Every reading at once, a failed one as null. */
export async function readGlance(): Promise<GlanceInput> {
  const keys = Object.keys(GLANCE_READERS) as Array<keyof GlanceInput>;
  const vals = await Promise.all(keys.map((k) => (GLANCE_READERS[k] as () => Promise<unknown>)().catch(() => null)));
  return Object.fromEntries(keys.map((k, n) => [k, vals[n]])) as GlanceInput;
}

function useGlance() {
  const { machineVersion } = useArch();
  const [g, setG] = useState<GlanceInput>({});
  const load = useCallback(() => {
    setG({});
    for (const k of Object.keys(GLANCE_READERS) as Array<keyof GlanceInput>)
      (GLANCE_READERS[k] as () => Promise<unknown>)().then(
        (v) => setG((o) => ({ ...o, [k]: v })),
        () => setG((o) => ({ ...o, [k]: null })),
      );
  }, []);
  useEffect(load, [load, machineVersion]);
  return { rows: glance(g), load };
}

function Glance() {
  const { rows, load } = useGlance();
  const { openSecurity } = useArch();
  const n = toLook(rows);
  const looking = rows.some((r) => r.level === "unknown" && r.now.startsWith("Fluff is looking"));
  const open = (r: GlanceRow) => openSecurity(r.place, anchorOf(r.id));
  return (
    <div className="space-y-3">
      <LevelsAtAGlance />
      <FluffSays title="Security at a glance">
        {looking
          ? "Fluff is reading each protection…"
          : n
            ? `${n} thing${n === 1 ? "" : "s"} Fluff would change. Click one to open its panel: each change is said before it runs.`
            : "Everything is as Fluff recommends."}
      </FluffSays>
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[10px]" onClick={load}>
          <RefreshCw className="h-3 w-3" /> Look again
        </Button>
      </div>
      <ul className="divide-y divide-border/60 overflow-hidden rounded-md border bg-card text-[11px]">
        {rows.map((r) => (
          <li key={r.id}>
            <button onClick={() => open(r)} className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-accent/30" title={`Open: ${r.name}`}>
              <span className={`mt-px ${DOT[r.level]}`} aria-label={DOT_WORDS[r.level]} title={DOT_WORDS[r.level]}>
                {r.level === "good" ? "●" : r.level === "look" ? "▲" : "○"}
              </span>
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="block font-medium">{r.name}</span>
                <span className="block text-muted-foreground">{r.now}</span>
                {r.level === "look" && r.fluff && <span className="block text-warn">Fluff recommends: {r.fluff}</span>}
              </span>
              <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-muted-foreground">
        ● as Fluff recommends · ▲ Fluff would change it · ○ your choice, or not known yet. TuxCopilot's own lock and signing are in Settings.
      </p>
    </div>
  );
}

/** The panel may still be loading: look for it a moment, then bring it into view. */
function scrollToWhenThere(id: string) {
  let tries = 0;
  const go = () => {
    const el = document.getElementById(id);
    if (el && el.offsetHeight > 0) el.scrollIntoView({ behavior: "smooth", block: "start" });
    else if (++tries < 40) setTimeout(go, 100);
  };
  setTimeout(go, 50);
}

const Spot = ({ id, children }: { id: string; children: ReactNode }) => (
  <div id={anchorOf(id)} className="scroll-mt-2">
    {children}
  </div>
);

export function SecurityView() {
  const { securityTab, setSecurityTab, securityAnchor } = useArch();
  useEffect(() => {
    if (securityAnchor) scrollToWhenThere(securityAnchor.id);
  }, [securityAnchor]);
  return (
    <Tabs value={securityTab} onValueChange={(v) => setSecurityTab(v as SecurityTab)} className="max-w-4xl gap-3">
      <TabsList className="h-auto flex-wrap">
        {TABS.map(({ id, label, icon: Icon }) => (
          <TabsTrigger key={id} value={id} data-guide={`tab-${id}`} className="gap-1.5 text-xs">
            <Icon className="h-3.5 w-3.5" /> {label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="glance" className="mt-0">
        <Glance />
      </TabsContent>
      <TabsContent value="network" className="mt-0 space-y-3">
        <NetworkLevels />
        <Spot id="firewall">
          <FirewallView />
        </Spot>
      </TabsContent>
      <TabsContent value="devices" className="mt-0 space-y-3">
        <DevicesLevels />
        <Spot id="input">
          <InputControlPanel />
        </Spot>
        <Spot id="storage">
          <StorageControlPanel />
        </Spot>
        <Spot id="usbguard">
          <UsbGuardPanel />
        </Spot>
      </TabsContent>
      <TabsContent value="accounts" className="mt-0 space-y-3">
        <AccountsLevels />
        <Spot id="groups">
          <GroupsPanel />
        </Spot>
        <Spot id="screenlock">
          <ScreenLockPanel />
        </Spot>
        <Spot id="logins">
          <LoginsPanel />
        </Spot>
      </TabsContent>
      <TabsContent value="system" className="mt-0 space-y-3">
        <SystemLevels />
        <Spot id="packages">
          <SecurityCheck />
        </Spot>
        <Spot id="files">
          <SystemFilesPanel />
        </Spot>
        <Spot id="kernel">
          <KernelPanel />
        </Spot>
        {/* also in Updates; its own id is sec-firmware */}
        <FirmwarePanel />
      </TabsContent>
    </Tabs>
  );
}
