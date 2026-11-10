// Git (its own section): every git repository in your home, used or unused, its size and
// origin; clones can be updated or removed (refused when that would lose work); your own
// projects are only listed.
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, GitBranch, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { openExternal } from "@/lib/host";
import { formatBytes } from "@/lib/disk";
import { cannotRemove, gitRepos, pickFolder, removeCommand, updateCommand, usage, webUrl, wouldLose, UNUSED_DAYS, USUAL_FOLDERS, type Repo } from "@/lib/gitrepos";
import { FolderPlus, X } from "lucide-react";
import { useArch } from "./store";
import { TuxTag } from "./tux-tag";
import { tuxRepo } from "@/lib/tux-own";

export function GitPanel() {
  const { machineVersion, runQuick, dryRun, stageSystem, gitDirs, setGitDirs } = useArch();
  const { toast } = useToast();
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setRepos(await gitRepos(gitDirs));
    } catch {
      setRepos([]);
    } finally {
      setBusy(false);
    }
  }, [gitDirs]);
  useEffect(() => {
    void load();
  }, [load, machineVersion, gitDirs]);

  const sorted = [...(repos ?? [])].sort(
    (a, b) => Number(a.yours) - Number(b.yours) || Number(usage(a).used) - Number(usage(b).used) || b.size - a.size,
  );
  const unused = sorted.filter((r) => !r.yours && !usage(r).used);

  const addFolder = async () => {
    const dir = await pickFolder().catch(() => null);
    if (!dir || gitDirs.includes(dir)) return;
    setGitDirs([...gitDirs, dir], `Search ${dir.replace(/^\/home\/[^/]+/, "~")} for git clones`);
  };

  return (
    <div className="space-y-2">
      <div className="space-y-1 rounded-lg border p-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Folders searched</span>
          <span className="text-[11px] text-muted-foreground">your home's own clones, {USUAL_FOLDERS.join(" ")} (when they exist), and:</span>
          <Button size="sm" variant="outline" className="ml-auto h-7 gap-1 px-2 text-[11px]" onClick={() => void addFolder()}>
            <FolderPlus className="h-3 w-3" /> Add a folder…
          </Button>
        </div>
        {gitDirs.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">no folders added. Other folders (like ~/Projects) are not looked at unless you add them.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {gitDirs.map((d) => (
              <span key={d} className="flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px]">
                {d.replace(/^\/home\/[^/]+/, "~")}
                <button
                  className="text-muted-foreground hover:text-red-400"
                  title="stop searching this folder"
                  onClick={() => setGitDirs(gitDirs.filter((x) => x !== d), `Stop searching ${d.replace(/^\/home\/[^/]+/, "~")}`)}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-xs">
        <GitBranch className="h-4 w-4 text-primary" />
        {repos ? (
          <span>
            {repos.filter((r) => !r.yours).length} clones ({formatBytes(repos.filter((r) => !r.yours).reduce((t, r) => t + r.size, 0))}),{" "}
            {unused.length} unused for {UNUSED_DAYS}+ days · {repos.filter((r) => r.yours).length} of your own projects
          </span>
        ) : (
          <span className="text-muted-foreground">looking through your home…</span>
        )}
        <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1 px-2 text-[11px]" onClick={() => void load()}>
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {!repos ? (
        <Skeleton className="h-24" />
      ) : sorted.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">No git repository in your home (hidden folders are not searched).</p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          {sorted.map((r) => {
            const u = usage(r);
            const lose = wouldLose(r);
            const url = webUrl(r.remote);
            return (
              <div key={r.path} className="flex flex-wrap items-center gap-2 border-b px-3 py-2 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{r.name}</span>
                    {tuxRepo(r.remote) && <TuxTag why={tuxRepo(r.remote)!} />}
                    {r.yours ? (
                      <Badge variant="outline" className="px-1 py-0 text-[9px] text-sky-300">your project</Badge>
                    ) : (
                      <Badge variant="outline" className="px-1 py-0 text-[9px] text-violet-400">clone</Badge>
                    )}
                    <Badge variant="outline" className={`px-1 py-0 text-[9px] ${u.used ? "text-emerald-400" : "text-amber-300"}`}>{u.text}</Badge>
                    {url && (
                      <button className="text-muted-foreground hover:text-primary" title={`from ${r.remote}`} onClick={() => void openExternal(url)}>
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground">{r.path.replace(/^\/home\/[^/]+/, "~")}</div>
                </div>
                <span className="font-mono text-xs">{formatBytes(r.size)}</span>
                {!r.yours && r.remote && (
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" title={updateCommand(r)} onClick={async () => {
                    const err = await runQuick(`Update ${r.name}`, updateCommand(r), dryRun);
                    if (err) toast({ title: "Fluff couldn't update it", description: err, variant: "destructive" });
                  }}>
                    Update
                  </Button>
                )}
                {!r.yours && (
                  cannotRemove(r) ? (
                    <span className="text-[10px] text-muted-foreground">{cannotRemove(r)}</span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      {lose && <span className="text-[10px] text-amber-300">loses: {lose}</span>}
                      <Button
                        size="sm"
                        variant={lose ? "destructive" : "outline"}
                        className={`h-6 px-2 text-[11px] ${lose ? "" : "text-destructive"}`}
                        title={removeCommand(r, true)}
                        onClick={() => {
                          stageSystem(`🔥 Remove clone ${r.name}${lose ? ` (loses: ${lose})` : ""}`, removeCommand(r, true), undefined, { id: `clone:${r.path}`, to: "removed" });
                          toast({ title: `Remove ${r.name} — pending`, description: "Apply (top bar) to delete the folder, or Undo." });
                        }}
                      >
                        {lose ? "🔥 Remove anyway" : "🔥 Remove"}
                      </Button>
                    </span>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">
        Used = something runs from it now, or you touched it (files, a git command) in the last {UNUSED_DAYS} days. Hidden folders
        are never searched: tools keep their own clones there.
      </p>
    </div>
  );
}
