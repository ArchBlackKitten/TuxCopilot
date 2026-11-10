// Settings → Your penguin, after an import: the old computer's apps, git clones, Ollama models,
// Docker images, Tor settings and firewall settings that this one does not have yet, each ticked, with one button per source. Every button goes through
// "Are you sure?" with the command shown, then runs in the terminal you can watch.
import { useCallback, useEffect, useState } from "react";
import { Check, GitBranch, Package, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { errText } from "@/lib/host";
import { YAY_COMMAND, aurCommand, dockerCommand, firewallCommand, flatpakCommand, forgetBelongings, gitCommand, missingHere, ollamaCommand, pacmanCommand, torrcBackCommand, type Missing } from "@/lib/penguin";
import { AurSafety } from "./aur-safety";
import { useArch } from "./store";
import { TuxTag } from "./tux-tag";
import { tuxPackage } from "@/lib/tux-own";

function Group<T>(props: {
  title: string;
  note: string;
  items: T[];
  keyOf: (x: T) => string;
  label: (x: T) => string;
  button: (n: number) => string;
  disabled?: string;
  onRun: (chosen: T[]) => void;
}) {
  const { items, keyOf } = props;
  const [off, setOff] = useState<Set<string>>(new Set());
  if (!items.length) return null;
  const chosen = items.filter((x) => !off.has(keyOf(x)));
  const flip = (k: string) => setOff((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });
  return (
    <div className="space-y-1.5 rounded-md border p-2.5">
      <div className="flex flex-wrap items-baseline gap-2">
        <div className="text-xs font-medium">{props.title}</div>
        <div className="text-[10px] text-muted-foreground">{props.note}</div>
        <div className="ml-auto flex gap-2 text-[10px]">
          <button className="underline-offset-2 hover:underline" onClick={() => setOff(new Set())}>all</button>
          <button className="underline-offset-2 hover:underline" onClick={() => setOff(new Set(items.map(keyOf)))}>none</button>
        </div>
      </div>
      <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
        {items.map((x) => {
          const k = keyOf(x);
          const on = !off.has(k);
          return (
            <button
              key={k}
              onClick={() => flip(k)}
              className={`flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${on ? "border-primary/50 bg-primary/10" : "opacity-50"}`}
            >
              {on && <Check className="h-2.5 w-2.5" />}
              {props.label(x)}
              {typeof x === "string" && tuxPackage(x) && <TuxTag why={tuxPackage(x)!} />}
            </button>
          );
        })}
      </div>
      {props.disabled ? (
        <p className="text-[11px] text-warn">{props.disabled}</p>
      ) : (
        <Button size="sm" className="h-7 px-2 text-[11px]" disabled={!chosen.length} onClick={() => props.onRun(chosen)}>
          {props.button(chosen.length)}
        </Button>
      )}
    </div>
  );
}

export function PenguinApps() {
  const { runQuick, dryRun, machineVersion } = useArch();
  const { toast } = useToast();
  const [m, setM] = useState<Missing | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setM(await missingHere());
    } catch (e) {
      toast({ title: "Fluff couldn't list your apps", description: errText(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => void load(), [load, machineVersion]);

  if (!m) return null;
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
  const forget = async () => {
    try {
      await forgetBelongings();
      setM(null);
    } catch (e) {
      toast({ title: "Fluff couldn't forget them", description: errText(e), variant: "destructive" });
    }
  };
  const left = m.pacman.length + m.aur.length + m.flatpak.length + m.git.length + m.ollama.length + m.docker.length + (m.torrc ? 1 : 0) + (m.firewall.length ? 1 : 0);

  return (
    <div className="space-y-2 rounded-md border border-primary/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Package className="h-3.5 w-3.5 text-primary" />
        <div className="text-xs font-medium">Get your apps back</div>
        <div className="text-[11px] text-muted-foreground">
          {left ? `${left} from your old computer are not here yet` : "everything from your old computer is here"}
          {m.alreadyHere ? ` · ${m.alreadyHere} already are` : ""}
        </div>
        <Button size="sm" variant="ghost" className="ml-auto h-6 gap-1 px-2 text-[10px]" disabled={loading} onClick={() => void load()}>
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Check again
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Untick what you no longer want. Each button shows its command first ("Are you sure?"), then runs it in the terminal so you
        can watch; pacman and Flatpak ask for your password there.
      </p>

      <Group
        title="From the Arch repositories (pacman)"
        note="checked by Arch's own packagers"
        items={m.pacman}
        keyOf={(x) => x}
        label={(x) => x}
        button={(n) => `Install ${n} with pacman`}
        onRun={(c) => void run(`Install ${c.length} apps (pacman)`, () => pacmanCommand(c))}
      />
      <Group
        title="From the AUR (yay)"
        note='made by people, not checked by Arch: when yay asks "Diffs to show?", type A to read each build recipe (PKGBUILD)'
        items={m.aur}
        keyOf={(x) => x}
        label={(x) => x}
        button={(n) => `Install ${n} with yay`}
        disabled={m.yay ? undefined : "yay is not installed yet: AUR apps need it. Install it first (the button below), then Check again."}
        onRun={(c) => void run(`Install ${c.length} apps (AUR)`, () => aurCommand(c))}
      />
      <AurSafety names={m.aur} />
      {!m.yay && m.aur.length > 0 && (
        <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => void run("Install yay", () => YAY_COMMAND)}>
          Install yay first
        </Button>
      )}
      <Group
        title="Flatpak apps"
        note="from Flathub; Flatpak itself is installed first if it is missing"
        items={m.flatpak}
        keyOf={(x) => x}
        label={(x) => x}
        button={(n) => `Install ${n} from Flathub`}
        onRun={(c) => void run(`Install ${c.length} Flatpak apps`, () => flatpakCommand(c))}
      />
      <Group
        title="Git clones"
        note="downloaded again into the same folders of your home"
        items={m.git}
        keyOf={(g) => g.path}
        label={(g) => `~/${g.path}`}
        button={(n) => `Download ${n} again`}
        onRun={(c) => void run(`Clone ${c.length} git repositories`, () => gitCommand(c))}
      />

      <Group
        title="Ollama models"
        note="downloaded again (they can be large); Ollama itself is installed and started first if it is missing"
        items={m.ollama}
        keyOf={(x) => x}
        label={(x) => x}
        button={(n) => `Download ${n} model${n === 1 ? "" : "s"}`}
        onRun={(c) => void run(`Download ${c.length} Ollama models`, () => ollamaCommand(c))}
      />
      <Group
        title="Docker images"
        note="pulled again; Docker itself is installed and started first if it is missing"
        items={m.docker}
        keyOf={(x) => x}
        label={(x) => x}
        button={(n) => `Pull ${n} image${n === 1 ? "" : "s"}`}
        onRun={(c) => void run(`Pull ${c.length} Docker images`, () => dockerCommand(c))}
      />
      {m.torrc !== null && (
        <div className="space-y-1.5 rounded-md border p-2.5">
          <div className="text-xs font-medium">Tor's settings (torrc)</div>
          <p className="text-[10px] text-muted-foreground">
            Your old computer's torrc differs from this one's. Putting it back: Tor is installed if missing, checks the file first, and this
            computer's torrc is kept beside it as a backup (Tor section → Earlier copies).
          </p>
          <Button size="sm" className="h-7 px-2 text-[11px]" onClick={() => void run("Put back your torrc", () => torrcBackCommand(m.torrc!))}>
            Put back your torrc
          </Button>
        </div>
      )}
      {m.firewall.length > 0 && (
        <div className="space-y-1.5 rounded-md border p-2.5">
          <div className="text-xs font-medium">Your firewall's settings (firewalld)</div>
          <p className="text-[10px] text-muted-foreground">
            {m.firewall.length} file{m.firewall.length === 1 ? "" : "s"} from your old computer ({m.firewall.map((f) => f.path).join(", ")}). Putting
            them back: firewalld is installed if missing, this computer's settings are kept as /etc/firewalld.before-fluff-…, and if firewalld
            refuses the old ones, nothing changes.
          </p>
          <Button size="sm" className="h-7 px-2 text-[11px]" onClick={() => void run("Put back your firewall settings", () => firewallCommand(m.firewall))}>
            Put back your firewall settings
          </Button>
        </div>
      )}

      {m.notInRepos.length > 0 && (
        <div className="text-[11px] text-muted-foreground">
          <GitBranch className="mr-1 inline h-3 w-3" />
          Not in this computer's repositories, so not offered: <span className="font-mono">{m.notInRepos.join(" ")}</span>. They may
          have come from your old system's own repositories (CachyOS, Manjaro…) or been renamed — look for them in Apps.
        </div>
      )}
      {m.refused.length > 0 && (
        <div className="text-[11px] text-warn">
          Refused, because they are not plain names or addresses (a belongings file can come from anyone): {m.refused.join(", ")}.
        </div>
      )}
      <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => void forget()}>
        Done — forget this list
      </Button>
    </div>
  );
}
