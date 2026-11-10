// Home → "Disk used by apps": pacman's record of every package's size, what removing each app
// would free (itself + what leaves with it), flatpaks and their runtimes, Docker, Ollama
// models, the package caches, and how full the disk is.

import { execOut, inv } from "./host";
import { detectInstalledApps } from "./apps-detect";
import { getOllamaState } from "./ollama";
import { getGitDirs, gitRepos } from "./gitrepos";

export interface DiskOverview {
  disk: { total: number; used: number; free: number } | null;
  packages: { total: number; count: number };
  topApps: Array<{ name: string; kind: string; frees: number }>;
  flatpak: { apps: number; runtimes: number; count: number } | null;
  docker: number | null; // images + containers + volumes + build cache
  ollama: number | null;
  caches: { pacman: number; aur: number };
  git: { clones: number; yours: number; count: number } | null;
}

const UNITS: Record<string, number> = {
  b: 1, bytes: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4,
};

/** "500.9 MB", "32.84kB", "0B", "1.2 GiB" → bytes (null when it isn't a size). */
export function parseSize(s: string): number | null {
  const m = s.trim().match(/^([\d.]+)\s*([a-zA-Z]+)?/);
  if (!m) return null;
  const mult = UNITS[(m[2] ?? "b").toLowerCase()];
  return mult === undefined ? null : Math.round(Number(m[1]) * mult);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`;
}

/** `df -B1 /`: Filesystem 1B-blocks Used Available Use% Mounted. */
export function parseDf(out: string): DiskOverview["disk"] {
  const cols = out.trim().split("\n").pop()?.trim().split(/\s+/) ?? [];
  const [total, used, free] = [Number(cols[1]), Number(cols[2]), Number(cols[3])];
  return [total, used, free].every(Number.isFinite) && total > 0 ? { total, used, free } : null;
}

const sumSizes = (lines: string[]) => lines.reduce((t, l) => t + (parseSize(l) ?? 0), 0);

export async function diskOverview(): Promise<DiskOverview> {
  const detect = await detectInstalledApps();
  const pkgApps = detect.apps.filter((a) => a.kind === "pacman" || a.kind === "aur");
  const kindOf = new Map(detect.apps.map((a) => [a.name, a.kind]));
  const [report, df, fpApps, fpRuntimes, dockerDf, ollama] = await Promise.all([
    inv<{ packagesTotal: number; packagesCount: number; apps: Array<{ name: string; own: number; frees: number }>; pacmanCache: number; aurCache: number }>(
      "disk_report",
      { apps: pkgApps.map((a) => a.name) },
    ).catch(() => null),
    execOut("df", ["-B1", "/"]),
    execOut("flatpak", ["list", "--app", "--columns=application,size"]),
    execOut("flatpak", ["list", "--runtime", "--columns=size"]),
    execOut("docker", ["system", "df", "--format", "{{json .}}"], 10000),
    getOllamaState().catch(() => null),
  ]);
  const repos = await gitRepos(await getGitDirs()).catch(() => null);

  const fpLines = (fpApps ?? "").split("\n").filter((l) => l.trim());
  const flatpakApps = fpLines.map((l) => {
    const [id, ...size] = l.split("\t");
    return { name: id.trim(), kind: "flatpak", frees: parseSize(size.join(" ")) ?? 0 };
  });

  let docker: number | null = null;
  if (dockerDf) {
    docker = 0;
    for (const l of dockerDf.split("\n").filter(Boolean)) {
      try {
        docker += parseSize((JSON.parse(l) as { Size: string }).Size) ?? 0;
      } catch {
        // skip
      }
    }
  }

  const topApps = [
    ...(report?.apps ?? []).map((a) => ({ name: a.name, kind: kindOf.get(a.name) ?? "pacman", frees: a.frees })),
    ...flatpakApps,
  ]
    .sort((a, b) => b.frees - a.frees)
    .slice(0, 8);

  return {
    disk: df ? parseDf(df) : null,
    packages: { total: report?.packagesTotal ?? 0, count: report?.packagesCount ?? 0 },
    topApps,
    flatpak: fpApps === null ? null : { apps: flatpakApps.reduce((t, a) => t + a.frees, 0), runtimes: sumSizes((fpRuntimes ?? "").split("\n")), count: flatpakApps.length },
    docker,
    ollama: ollama?.available ? ollama.models.reduce((t, m) => t + (m.sizeGB ?? 0) * 1e9, 0) : null,
    caches: { pacman: report?.pacmanCache ?? 0, aur: report?.aurCache ?? 0 },
    git: repos
      ? {
          clones: repos.filter((r) => !r.yours).reduce((t, r) => t + r.size, 0),
          yours: repos.filter((r) => r.yours).reduce((t, r) => t + r.size, 0),
          count: repos.length,
        }
      : null,
  };
}

// The cache buttons. Never while pacman runs (its lock file exists): the download-* folders
// are its downloads in progress then. When it is idle they are leftovers of interrupted runs —
// and what made `pacman -Sc` / `yay -Sc` stop with "could not open file … download-…".
const PACMAN_IDLE = `{ [ ! -e /var/lib/pacman/db.lck ] || { echo "pacman is busy right now — try again when it has finished."; exit 1; }; }`;
const LEFTOVERS = "sudo rm -rf /var/cache/pacman/pkg/download-*";

/** Keep only the versions that are installed now (you can still reinstall them offline). */
export const FREE_PACMAN_CACHE = `${PACMAN_IDLE} && ${LEFTOVERS} && sudo pacman -Sc --noconfirm`;
/** Every cached package goes: downgrading then needs the internet (or the Arch archive). */
export const EMPTY_PACMAN_CACHE = `${PACMAN_IDLE} && ${LEFTOVERS} && sudo rm -f /var/cache/pacman/pkg/*.pkg.tar.*`;
/** yay's build folders; vcs.json (how yay tracks -git packages) and its search cache stay. */
export const FREE_AUR_CACHE = `${PACMAN_IDLE} && find ~/.cache/yay -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} +`;
