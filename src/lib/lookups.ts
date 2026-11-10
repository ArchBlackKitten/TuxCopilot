// Network lookups behind the source symbols and the GitHub "instruction look up".
// Ported from the /api/source/check and /api/github/readme routes; requests go through
// host.httpGet (Rust, GET only, host-allowlisted) because a webview fetch would be
// stopped by CORS. Only package/repo names leave the machine, never stored data.

import { httpGet } from "./host";

const UA = "tuxcopilot/0.1 (local system manager app)";

// ── source check ─────────────────────────────────────────────────────────

export interface CheckResult {
  found: boolean;
  url: string | null;
  checkedAt: string;
  cached?: boolean;
}

const checkCache = new Map<string, CheckResult>();
const CHECK_TTL = 10 * 60 * 1000;
const now = () => new Date().toISOString();

async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown | null> {
  const res = await httpGet(url, { "User-Agent": UA, Accept: "application/json" }, timeoutMs);
  if (!res || !res.ok) return null;
  try {
    return JSON.parse(res.text);
  } catch {
    return null;
  }
}

function sourceRepoSlug(q: string): string | null {
  const raw = q.trim().replace(/\.git$/, "");
  if (/^(https?:\/\/)?(www\.)?github\.com\//i.test(raw)) {
    const rest = raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/^github\.com\//i, "");
    const parts = rest.split("/").filter(Boolean);
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  if (/^(git@|ssh:\/\/git@)github\.com[:/]/i.test(raw)) {
    const rest = raw.replace(/^(git@|ssh:\/\/git@)github\.com[:/]/i, "");
    const parts = rest.split("/").filter(Boolean);
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  const parts = raw.split("/").filter(Boolean);
  return parts.length === 2 ? parts.join("/") : null;
}

async function checkPacman(q: string): Promise<CheckResult> {
  const pkg = q.trim().split(/\s+/)[0];
  const data = (await fetchJson(`https://archlinux.org/packages/search/json/?name=${encodeURIComponent(pkg)}`)) as {
    results?: Array<{ repo: string; arch: string; pkgname: string }>;
  } | null;
  if (!data) {
    // network trouble — don't grey out, offer the search page
    return { found: true, url: `https://archlinux.org/packages/?q=${encodeURIComponent(pkg)}`, checkedAt: now() };
  }
  const hit = data.results?.[0];
  if (hit) return { found: true, url: `https://archlinux.org/packages/${hit.repo}/${hit.arch}/${hit.pkgname}/`, checkedAt: now() };
  return { found: false, url: null, checkedAt: now() };
}

async function checkYay(q: string): Promise<CheckResult> {
  const pkg = q.trim().split(/\s+/)[0];
  const data = (await fetchJson(`https://aur.archlinux.org/rpc/v5/info?arg[]=${encodeURIComponent(pkg)}`)) as {
    resultcount?: number;
    results?: Array<{ Name: string }>;
  } | null;
  if (!data) return { found: true, url: `https://aur.archlinux.org/packages?K=${encodeURIComponent(pkg)}`, checkedAt: now() };
  if ((data.resultcount ?? 0) > 0 && data.results?.[0]) {
    return { found: true, url: `https://aur.archlinux.org/packages/${data.results[0].Name}`, checkedAt: now() };
  }
  return { found: false, url: null, checkedAt: now() };
}

async function checkGithub(q: string): Promise<CheckResult> {
  const slug = sourceRepoSlug(q);
  if (!slug) return { found: false, url: null, checkedAt: now() };
  const res = await httpGet(`https://api.github.com/repos/${slug}`, { "User-Agent": UA, Accept: "application/vnd.github+json" });
  if (res?.status === 200) {
    let html: string | undefined;
    try {
      html = (JSON.parse(res.text) as { html_url?: string }).html_url;
    } catch {
      html = undefined;
    }
    return { found: true, url: html ?? `https://github.com/${slug}`, checkedAt: now() };
  }
  if (res?.status === 404) return { found: false, url: null, checkedAt: now() };
  // rate limited / server error / offline → keep clickable, open best-guess page
  return { found: true, url: `https://github.com/${slug}`, checkedAt: now() };
}

async function checkOllama(q: string): Promise<CheckResult> {
  // Accept "llama3.2", "llama3.2:3b-instruct-q4_K_M", or a full library URL.
  const raw = q.trim().replace(/^https?:\/\/(www\.)?ollama\.com\/library\//i, "").replace(/^https?:\/\//i, "");
  const model = raw.split(/[\s,]+/)[0];
  if (!model || !/^[\w.:-]+$/.test(model)) return { found: false, url: null, checkedAt: now() };
  const url = `https://ollama.com/library/${model}`;
  const res = await httpGet(url, { "User-Agent": UA });
  if (res?.status === 200) return { found: true, url: res.url || url, checkedAt: now() };
  if (res?.status === 404) return { found: false, url: null, checkedAt: now() };
  return { found: true, url, checkedAt: now() };
}

async function checkFlatpak(q: string): Promise<CheckResult> {
  const id = q.trim().split(/\s+/)[0];
  if (!/^[\w.-]+$/.test(id)) return { found: false, url: null, checkedAt: now() };
  const page = `https://flathub.org/apps/${id}`;
  const res = await httpGet(`https://flathub.org/api/v2/appstream/${id}`, { "User-Agent": UA, Accept: "application/json" });
  if (res?.status === 200) return { found: true, url: page, checkedAt: now() };
  if (res?.status === 404) return { found: false, url: null, checkedAt: now() };
  return { found: true, url: page, checkedAt: now() };
}

async function checkSnap(q: string): Promise<CheckResult> {
  const name = pkgFirst(q);
  if (!/^[a-z0-9-]+$/.test(name)) return { found: false, url: null, checkedAt: now() };
  const url = `https://snapcraft.io/${name}`;
  const res = await httpGet(url, { "User-Agent": UA });
  if (res?.status === 200) return { found: true, url, checkedAt: now() };
  if (res?.status === 404) return { found: false, url: null, checkedAt: now() };
  return { found: true, url, checkedAt: now() };
}

/** The first name in an item, skipping flags like --classic. */
const pkgFirst = (q: string) => q.trim().split(/\s+/).find((t) => !t.startsWith("-")) ?? "";

/** Forget every looked-up page, so the next view asks the sites again. */
export function clearLookupCaches(): void {
  checkCache.clear();
  readmeCache.clear();
}

export async function sourceCheck(source: string, q: string): Promise<CheckResult> {
  if (!q.trim()) throw "Missing q";
  const key = `${source}:${q}`;
  const hit = checkCache.get(key);
  if (hit && Date.now() - new Date(hit.checkedAt).getTime() < CHECK_TTL) return { ...hit, cached: true };
  checkCache.delete(key);

  let result: CheckResult;
  if (source === "pacman") result = await checkPacman(q);
  else if (source === "yay") result = await checkYay(q);
  else if (source === "github") result = await checkGithub(q);
  else if (source === "ollama") result = await checkOllama(q);
  else if (source === "flatpak") result = await checkFlatpak(q);
  else if (source === "snap") result = await checkSnap(q);
  else throw "Unknown source";
  checkCache.set(key, result);
  return result;
}

// ── GitHub README ────────────────────────────────────────────────────────

export interface ReadmeResponse {
  found: boolean;
  markdown: string;
  meta: {
    fullName: string;
    description: string | null;
    htmlUrl: string;
    stars: number | null;
    defaultBranch: string;
    homepage: string | null;
    source: "github-api" | "raw";
  } | null;
  error?: string;
}

const readmeCache = new Map<string, { at: number; data: ReadmeResponse }>();
const README_TTL = 15 * 60 * 1000;
const README_NAMES = ["README.md", "readme.md", "Readme.md", "README.rst", "README.txt", "README", "readme.markdown"];

function readmeRepoSlug(q: string): string | null {
  const raw = q.trim().replace(/\.git$/, "");
  const m = /github\.com[/:]([\w.-]+)\/([\w.-]+)/i.exec(raw);
  if (m) return `${m[1]}/${m[2]}`;
  const parts = raw.split("/").filter(Boolean);
  if (parts.length === 2 && !raw.includes(".")) return parts.join("/");
  return null;
}

export async function githubReadme(query: string): Promise<ReadmeResponse> {
  const repo = readmeRepoSlug(query);
  if (!repo) {
    return {
      found: false,
      markdown: "",
      meta: null,
      error: "Could not read an owner/repo out of that — expected something like 'user/repo' or a GitHub URL.",
    };
  }
  const hit = readmeCache.get(repo);
  if (hit && Date.now() - hit.at < README_TTL) return hit.data;

  // 1) raw README (no quota) — try a few conventional filenames
  let markdown: string | null = null;
  for (const name of README_NAMES) {
    const res = await httpGet(`https://raw.githubusercontent.com/${repo}/HEAD/${name}`, { "User-Agent": UA }, 12000);
    if (res?.ok && res.text.trim().length > 0) {
      markdown = res.text;
      break;
    }
  }

  // 2) optional repo metadata (stars etc.) — ignore quota failures
  let meta: ReadmeResponse["meta"];
  const metaRes = await httpGet(`https://api.github.com/repos/${repo}`, { "User-Agent": UA, Accept: "application/vnd.github+json" }, 12000);
  let j: {
    full_name: string;
    description: string | null;
    html_url: string;
    stargazers_count: number;
    default_branch: string;
    homepage: string | null;
  } | null = null;
  if (metaRes?.ok) {
    try {
      j = JSON.parse(metaRes.text);
    } catch {
      j = null;
    }
  }
  if (j) {
    meta = {
      fullName: j.full_name,
      description: j.description,
      htmlUrl: j.html_url,
      stars: j.stargazers_count,
      defaultBranch: j.default_branch,
      homepage: j.homepage,
      source: markdown ? "raw" : "github-api",
    };
    // 3) if raw failed, the API readme endpoint is still an option
    if (markdown === null) {
      const r2 = await httpGet(`https://api.github.com/repos/${repo}/readme`, { "User-Agent": UA, Accept: "application/vnd.github.raw+json" }, 12000);
      if (r2?.ok) markdown = r2.text;
    }
  } else {
    meta = { fullName: repo, description: null, htmlUrl: `https://github.com/${repo}`, stars: null, defaultBranch: "HEAD", homepage: null, source: "raw" };
  }

  // distinguish "repo missing" (github.com 404) from "quota trouble"
  if (markdown === null) {
    const page = await httpGet(`https://github.com/${repo}`, { "User-Agent": UA }, 8000);
    const repoMissing = page ? page.status === 404 : false;
    const data: ReadmeResponse = {
      found: false,
      markdown: "",
      meta: repoMissing ? null : meta,
      error: repoMissing
        ? `Repository '${repo}' not found (or private).`
        : page?.ok
          ? "Repository exists but has no README file."
          : "GitHub quota reached and no raw README found. Try again later.",
    };
    if (repoMissing) readmeCache.set(repo, { at: Date.now(), data });
    return data;
  }

  const data: ReadmeResponse = { found: true, markdown, meta };
  readmeCache.set(repo, { at: Date.now(), data });
  return data;
}
