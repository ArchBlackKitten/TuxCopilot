// App Manager → "Tracked & links": the keep-list and the "A uses B" links that turn removal
// into a domino. The rules themselves live in lib/tracking.ts.
import { useState } from "react";
import { Link2, Pin, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { isPlannableName, sanitizeAppName } from "@/lib/eliminate";
import { errText } from "@/lib/host";
import { isTracked, link, track, unlink, untrack, usedBy, uses } from "@/lib/tracking";
import { AppLink, AppLinks } from "./app-link";
import { useArch } from "./store";
import type { EliminateTarget } from "./eliminate-dialog";

export function TrackingPanel({
  knownApps,
  sourceOf,
  onOpen,
}: {
  knownApps: string[];
  sourceOf: (app: string) => string;
  onOpen: (t: EliminateTarget) => void;
}) {
  const { tracking, setTracking, stageSystem, dropTarget } = useArch();
  // untracking what was only tracked on screen takes back the pacman mark that came with it
  const dropMarkIfOnlyWaiting = (app: string) => {
    if (!isTracked(useArch.getState().savedTracking, app)) dropTarget(`pacman.reason:${app}`);
  };
  const { toast } = useToast();
  const [toTrack, setToTrack] = useState("");
  const [user, setUser] = useState("");
  const [used, setUsed] = useState("");

  const name = (raw: string) => {
    const n = sanitizeAppName(raw.trim());
    if (!n || !isPlannableName(n)) throw `"${raw}" is not a package name`;
    return n;
  };

  const addTrack = async () => {
    try {
      const app = name(toTrack);
      setTracking(track(tracking, app), `Track ${app}`);
      setToTrack("");
      // pacman's own record too (on Apply): installed on purpose, never swept up as an orphan
      if (["pacman", "aur"].includes(sourceOf(app))) {
        stageSystem(`Mark ${app} as installed on purpose`, `sudo pacman -D --asexplicit ${app}`, undefined, { id: `pacman.reason:${app}`, to: "explicit" });
      }
    } catch (e) {
      toast({ title: "Fluff couldn't track it", description: errText(e), variant: "destructive" });
    }
  };

  const addLink = async () => {
    try {
      setTracking(link(tracking, name(user), name(used)), `Link: ${name(user)} uses ${name(used)}`);
      setUser("");
      setUsed("");
    } catch (e) {
      toast({ title: "Fluff couldn't link them", description: errText(e), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <datalist id="am-known-apps">
        {knownApps.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>

      <p className="rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">Tracked</span> apps are kept: they never show as unused and can't
        be removed on their own. Pacman and AUR apps are also marked in pacman as installed on purpose (
        <code className="font-mono">pacman -D --asexplicit</code>), so no orphan sweep removes them.{" "}
        <span className="font-medium text-foreground">Links</span> say one app uses another. Removing an app asks about
        everything it uses: keep it, or remove it together. A tracked app that another app uses can only go that way.
      </p>

      {/* tracked */}
      <section className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Pin className="h-3.5 w-3.5 text-primary" /> Tracked apps
          <Badge variant="outline" className="ml-1 px-1 py-0 text-[9px]">{tracking.tracked.length}</Badge>
        </h3>
        <div className="flex gap-2">
          <Input
            list="am-known-apps"
            value={toTrack}
            onChange={(e) => setToTrack(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void addTrack()}
            placeholder="app to keep, e.g. obs-studio"
            className="h-8 max-w-xs font-mono text-xs"
          />
          <Button size="sm" className="h-8 text-xs" onClick={() => void addTrack()} disabled={!toTrack.trim()}>
            Track
          </Button>
        </div>
        {tracking.tracked.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing tracked yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {tracking.tracked.map((a) => (
              <span key={a} className="flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs">
                <AppLink name={a} source={sourceOf(a)} />
                {usedBy(tracking, a).length > 0 && (
                  <span className="text-[10px] text-muted-foreground">used by <AppLinks names={usedBy(tracking, a)} /></span>
                )}
                <button
                  className="text-muted-foreground hover:text-red-400"
                  title={`untrack ${a} (pacman's own record is left as it is)`}
                  onClick={() => (setTracking(untrack(tracking, a), `Untrack ${a}`), dropMarkIfOnlyWaiting(a))}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* links */}
      <section className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Link2 className="h-3.5 w-3.5 text-primary" /> Links
          <Badge variant="outline" className="ml-1 px-1 py-0 text-[9px]">{tracking.links.length}</Badge>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <Input list="am-known-apps" value={user} onChange={(e) => setUser(e.target.value)} placeholder="this app…" className="h-8 w-48 font-mono text-xs" />
          <span className="text-xs text-muted-foreground">uses</span>
          <Input
            list="am-known-apps"
            value={used}
            onChange={(e) => setUsed(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void addLink()}
            placeholder="…this one"
            className="h-8 w-48 font-mono text-xs"
          />
          <Button size="sm" className="h-8 text-xs" onClick={() => void addLink()} disabled={!user.trim() || !used.trim()}>
            Link
          </Button>
        </div>
        {tracking.links.length === 0 ? (
          <p className="text-xs text-muted-foreground">No links yet. Example: obs-studio uses v4l2loopback-dkms.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            {[...new Set(tracking.links.map((l) => l.user))].sort().map((u) => (
              <div key={u} className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2 text-xs last:border-b-0">
                <AppLink name={u} source={sourceOf(u)} className="font-medium" />
                <span className="text-muted-foreground">uses</span>
                {uses(tracking, u).map((d) => (
                  <span key={d} className="flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 font-mono">
                    <AppLink name={d} source={sourceOf(d)} />
                    {tracking.tracked.includes(d) && <Pin className="h-2.5 w-2.5 text-primary" />}
                    <button className="text-muted-foreground hover:text-red-400" title="remove this link" onClick={() => setTracking(unlink(tracking, u, d), `Unlink: ${u} uses ${d}`)}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
