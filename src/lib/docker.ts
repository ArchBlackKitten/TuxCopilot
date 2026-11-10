// Docker section — what is installed, which apps run in Docker, and the plain commands for
// each thing you would otherwise have to remember. Reads go through fixed probes; every
// change (start, stop, update, remove, a recipe) is a command run through the run manager,
// shown first and asked about like any other.

import { execOut, inv } from "./host";

// ── reading the machine ──────────────────────────────────────────────────

export interface Container {
  name: string;
  image: string;
  state: string; // running, exited, …
  status: string; // "Up 2 hours", "Exited (0) 3 days ago"
  ports: number[]; // host ports published on this machine
  project: string | null; // the compose app it belongs to
}

export interface ComposeApp {
  name: string; // the project name docker compose uses
  file: string | null; // its compose file — null when docker no longer knows where it is
  dir: string | null;
  running: number;
  total: number;
  ports: number[];
  containers: Container[];
}

export interface DockerState {
  installed: boolean;
  reachable: boolean; // the daemon answered
  apps: ComposeApp[];
  loose: Container[]; // containers started without compose
}

/** The host ports in docker's "Ports" column: "0.0.0.0:8080->8080/tcp, [::]:8080->8080/tcp". */
export function hostPorts(ports: string): number[] {
  const found = [...ports.matchAll(/:(\d+)->/g)].map((m) => Number(m[1]));
  return [...new Set(found)].sort((a, b) => a - b);
}

function label(labels: string, key: string): string | null {
  for (const kv of labels.split(",")) {
    const i = kv.indexOf("=");
    if (i > 0 && kv.slice(0, i) === key) return kv.slice(i + 1);
  }
  return null;
}

export function parseContainers(out: string): Container[] {
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap((l) => {
      try {
        const j = JSON.parse(l) as Record<string, string>;
        return [{
          name: j.Names ?? "",
          image: j.Image ?? "",
          state: j.State ?? "",
          status: j.Status ?? "",
          ports: hostPorts(j.Ports ?? ""),
          project: label(j.Labels ?? "", "com.docker.compose.project"),
        }];
      } catch {
        return [];
      }
    });
}

interface ComposeLs {
  Name: string;
  Status: string;
  ConfigFiles: string;
}

/** Put it together: the folders in ~/docker, what docker compose knows, the containers. */
export function assemble(dirs: Array<{ name: string; dir: string; file: string }>, ls: ComposeLs[], containers: Container[]): Omit<DockerState, "installed" | "reachable"> {
  const apps = new Map<string, ComposeApp>();
  const blank = (name: string): ComposeApp => ({ name, file: null, dir: null, running: 0, total: 0, ports: [], containers: [] });
  // compose names a project after its folder, lower-cased, keeping only a-z 0-9 _ -
  const projectOf = (folder: string) => folder.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  for (const d of dirs) apps.set(projectOf(d.name), { ...blank(projectOf(d.name)), file: d.file, dir: d.dir });
  for (const p of ls) {
    const a = apps.get(p.Name) ?? blank(p.Name);
    if (!a.file) {
      a.file = p.ConfigFiles.split(",")[0] || null;
      a.dir = a.file ? a.file.replace(/\/[^/]+$/, "") : null;
    }
    apps.set(p.Name, a);
  }
  const loose: Container[] = [];
  for (const c of containers) {
    const a = c.project ? apps.get(c.project) : undefined;
    if (!a) {
      loose.push(c);
      continue;
    }
    a.containers.push(c);
    a.total++;
    if (c.state === "running") a.running++;
    a.ports = [...new Set([...a.ports, ...c.ports])].sort((x, y) => x - y);
  }
  return { apps: [...apps.values()].sort((a, b) => a.name.localeCompare(b.name)), loose };
}

export async function dockerState(): Promise<DockerState> {
  const installed = (await execOut("docker", ["--version"])) !== null;
  const dirs = await inv<Array<{ name: string; dir: string; file: string }>>("docker_apps").catch(() => []);
  if (!installed) return { installed, reachable: false, ...assemble(dirs, [], []) };
  const [ps, ls] = await Promise.all([
    execOut("docker", ["ps", "-a", "--format", "{{json .}}"], 10000),
    execOut("docker", ["compose", "ls", "-a", "--format", "json"], 10000),
  ]);
  let projects: ComposeLs[] = [];
  try {
    projects = ls ? (JSON.parse(ls) as ComposeLs[]) : [];
  } catch {
    projects = [];
  }
  return { installed, reachable: ps !== null, ...assemble(dirs, projects, ps ? parseContainers(ps) : []) };
}

/** An app's or a container's last 200 log lines. */
export const dockerLogs = (target: string) => inv<string>("docker_logs", { target });

// ── the commands ─────────────────────────────────────────────────────────

/** Single-quoted for the shell; a path with a quote in it is refused rather than escaped. */
export function q(path: string): string {
  if (/['\n]/.test(path)) throw new Error(`unusual path: ${path}`);
  return `'${path}'`;
}

export interface DockerCommand {
  id: string;
  label: string;
  command: string;
  note: string;
  danger?: boolean;
}

export function appCommands(app: ComposeApp): DockerCommand[] {
  if (!app.file) return [];
  const dc = `docker compose -f ${q(app.file)}`;
  return [
    { id: "start", label: "Start", command: `${dc} up -d`, note: "starts the app in the background (creates its containers the first time)" },
    { id: "stop", label: "Stop", command: `${dc} stop`, note: "stops it; everything stays as it is, Start brings it back" },
    { id: "restart", label: "Restart", command: `${dc} restart`, note: "stop and start again — the first thing to try when it misbehaves" },
    { id: "update", label: "Update", command: `${dc} pull && ${dc} up -d`, note: "downloads the newest images, then recreates only what changed; your data stays" },
    { id: "status", label: "Status", command: `${dc} ps`, note: "which of its containers run, and on which ports" },
    { id: "shell", label: "Shell inside", command: `${dc} exec ${firstService(app)} sh`, note: "a terminal inside the app's main container — paste it into a terminal, it needs one" },
    { id: "down", label: "Remove (keep data)", command: `${dc} down`, note: "removes its containers and network; volumes (your data) and the folder stay, Start rebuilds it", danger: true },
    { id: "purge", label: "🔥 Remove everything", command: `${dc} down -v --rmi all${app.dir ? ` && rm -rf ${q(app.dir)}` : ""}`, note: "removes the containers, its images, ITS DATA (volumes) and its folder. There is no undo — export what you need from the app first.", danger: true },
  ];
}

function firstService(app: ComposeApp): string {
  // compose names containers <project>-<service>-<n>; a container_name hides that, so fall back
  const c = app.containers.find((x) => x.name.startsWith(`${app.name}-`));
  return c ? c.name.slice(app.name.length + 1).replace(/-\d+$/, "") : "app";
}

export function containerCommands(c: Container): DockerCommand[] {
  const n = c.name;
  return [
    { id: "start", label: "Start", command: `docker start ${n}`, note: "starts the container again" },
    { id: "stop", label: "Stop", command: `docker stop ${n}`, note: "stops it; Start brings it back" },
    { id: "restart", label: "Restart", command: `docker restart ${n}`, note: "stop and start again" },
    { id: "shell", label: "Shell inside", command: `docker exec -it ${n} sh`, note: "a terminal inside it — paste it into a terminal" },
    { id: "rm", label: "🔥 Remove", command: `docker rm -f ${n}`, note: "removes the container (its image and named volumes stay)", danger: true },
  ];
}

// ── recipes: apps that need Docker, set up from their makers' own files ──
// The files are downloaded from the project itself when the recipe runs, so the app never
// carries a copy that goes out of date. If a file no longer looks the way the recipe
// expects, the recipe stops and says so, instead of guessing.

export interface Recipe {
  id: string;
  name: string;
  blurb: string;
  folder: string; // under ~/docker
  port: number;
  docs: string; // the project's own install page
  files: Array<{ url: string; saveAs: string }>;
  script: string; // runs inside the folder after the downloads
}

const FIREFLY_PORT = 8080;

export const RECIPES: Recipe[] = [
  {
    id: "firefly-iii",
    name: "Firefly III",
    blurb: "personal finance manager — budgets, accounts, transactions",
    folder: "firefly-iii",
    port: FIREFLY_PORT,
    docs: "https://docs.firefly-iii.org/how-to/firefly-iii/installation/docker/",
    files: [
      { url: "https://raw.githubusercontent.com/firefly-iii/docker/main/docker-compose.yml", saveAs: "compose.yml" },
      { url: "https://raw.githubusercontent.com/firefly-iii/docker/main/database.env", saveAs: ".db.env" },
      { url: "https://raw.githubusercontent.com/firefly-iii/firefly-iii/main/.env.example", saveAs: ".env" },
    ],
    // the three secrets Firefly's own guide asks you to invent, the port moved off 80, your
    // time zone; the database password written in both files, as the two must match
    script: [
      `grep -q '^APP_KEY=' .env && grep -q '^DB_PASSWORD=' .env && grep -q '^STATIC_CRON_TOKEN=' .env && grep -q '^APP_URL=' .env && grep -q '^MYSQL_PASSWORD=' .db.env && grep -q -- '- 80:8080' compose.yml || { echo "Firefly III's files changed since this recipe was written — nothing was started. Follow their guide instead: https://docs.firefly-iii.org/how-to/firefly-iii/installation/docker/"; exit 1; }`,
      `DBPW=$(openssl rand -hex 16)`,
      `sed -i "s|^APP_KEY=.*|APP_KEY=$(openssl rand -hex 16)|; s|^DB_PASSWORD=.*|DB_PASSWORD=$DBPW|; s|^STATIC_CRON_TOKEN=.*|STATIC_CRON_TOKEN=$(openssl rand -hex 16)|; s|^APP_URL=.*|APP_URL=http://localhost:${FIREFLY_PORT}|; s|^TZ=.*|TZ=$(timedatectl show -p Timezone --value)|" .env`,
      `sed -i "s|^MYSQL_PASSWORD=.*|MYSQL_PASSWORD=$DBPW|" .db.env`,
      `sed -i 's|- 80:8080|- ${FIREFLY_PORT}:8080|' compose.yml`,
      `chmod 600 .env .db.env`,
    ].join(" && "),
  },
];

/** The whole recipe as one command: make the folder, fetch the files, fill them in, start. */
export function recipeCommand(r: Recipe): string {
  const dir = `$HOME/docker/${r.folder}`;
  return [
    `mkdir -p "${dir}" && cd "${dir}"`,
    `{ [ ! -e compose.yml ] || { echo "${r.name} is already set up in ${dir} — use Start or Update."; exit 1; }; }`,
    ...r.files.map((f) => `curl -fsSL -o ${f.saveAs} ${f.url}`),
    r.script,
    `docker compose up -d --pull always`,
    `echo "${r.name} is starting at http://localhost:${r.port} — the first start can take a minute."`,
  ].join(" && ");
}

export const DOCKER_SETUP = "sudo pacman -Syu --needed --noconfirm docker docker-compose && sudo systemctl enable --now docker.service && sudo usermod -aG docker $USER";
