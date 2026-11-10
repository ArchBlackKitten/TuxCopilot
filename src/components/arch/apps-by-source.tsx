// Home: your apps by where they come from — Arch's repositories, the AUR, Flatpak, Snap,
// git clones, Ollama models, Docker apps — each a count you can click to its section.
import { useEffect, useState } from "react";
import { Anvil, Bot, Box, Container, GitBranch, Package, Boxes } from "lucide-react";
import { installedApps } from "@/lib/api";
import { dockerState } from "@/lib/docker";
import { gitRepos } from "@/lib/gitrepos";
import type { View } from "./store";
import { useArch } from "./store";

interface Row {
  id: string;
  label: string;
  note: string;
  icon: typeof Package;
  count: number | null | undefined; // undefined: still counting; null: not on this computer
  view: View;
}

export function AppsBySource() {
  const { machineVersion, gitDirs, ollama, loadOllama, setView } = useArch();
  const [apps, setApps] = useState<Array<{ name: string; kind: string }> | null>(null);
  const [git, setGit] = useState<number | null | undefined>(undefined);
  const [docker, setDocker] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    installedApps().then(setApps, () => setApps([]));
    gitRepos(gitDirs).then((r) => setGit(r.length), () => setGit(null));
    dockerState().then((d) => setDocker(d.installed ? d.apps.length + d.loose.length : null), () => setDocker(null));
    if (!ollama) void loadOllama();
  }, [machineVersion, gitDirs]); // eslint-disable-line react-hooks/exhaustive-deps

  const of = (kind: string) => (apps ? apps.filter((a) => a.kind === kind).length : undefined);
  const rows: Row[] = [
    { id: "pacman", label: "Arch repositories", note: "pacman — checked by Arch's packagers", icon: Package, count: of("pacman"), view: "apps" },
    { id: "aur", label: "AUR", note: "yay — made by people, not checked by Arch", icon: Anvil, count: of("aur"), view: "apps" },
    { id: "flatpak", label: "Flatpak", note: "Flathub, in a sandbox", icon: Box, count: of("flatpak"), view: "apps" },
    { id: "snap", label: "Snap", note: "Snap Store", icon: Boxes, count: of("snap"), view: "apps" },
    { id: "git", label: "Git clones", note: "projects you downloaded with git", icon: GitBranch, count: git, view: "git" },
    { id: "ollama", label: "Ollama models", note: "AI models on this computer", icon: Bot, count: ollama === null ? undefined : ollama.serverUp ? ollama.models.length : null, view: "ollama" },
    { id: "docker", label: "Docker apps", note: "apps in containers", icon: Container, count: docker, view: "docker" },
  ];
  // a source with nothing in it, or not on this computer, isn't shown
  const shown = rows.filter((r) => r.count !== 0 && r.count !== null);

  return (
    <section className="rounded-md border bg-card p-3">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-xs font-semibold">Your apps, by where they come from</span>
        <span className="text-[10px] text-muted-foreground">click one to see them</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {shown.map((r) => (
          <button key={r.id} onClick={() => setView(r.view)} title={r.note} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-left hover:bg-accent/40">
            <r.icon className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-none">{r.count ?? "…"}</div>
              <div className="truncate text-[10px] text-muted-foreground">{r.label}</div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
