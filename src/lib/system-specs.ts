// Machine analysis for the Ollama section: probes CPU, GPU, VRAM, RAM, swap
// and storage. Every row is explicitly labelled "Detected" (read from this
// machine) or "Estimated" (inferred / fallback) — the user asked for the
// difference to be unmistakable.

import { execOut, readDir as readdir, readText } from "./host";

export type SpecStatus = "detected" | "estimated" | "unavailable";

export interface SpecRow {
  key: string;
  label: string;
  value: string;
  detail?: string;
  status: SpecStatus;
}

export interface MachineProfile {
  cpuModel: string | null;
  cpuThreads: number | null;
  cpuCores: number | null;
  ramGB: number | null;
  ramAvailableGB: number | null;
  swapGB: number | null;
  gpu: string | null;
  gpuVendor: "nvidia" | "amd" | "intel" | null;
  vramGB: number | null;
  vramShared: boolean; // iGPU — shares system RAM
  storageFreeGB: number | null;
  storageTotalGB: number | null;
  os: string | null;
  kernel: string | null;
  accel: "cuda" | "rocm" | "cpu" | "shared";
  cpuRamBudgetGB: number; // RAM usable for CPU inference
  gpuBudgetGB: number; // usable VRAM (0 when none)
  totalBudgetGB: number; // best single-model memory budget
  budgetKind: "vram" | "shared" | "ram";
  tier: string;
  tierNote: string;
}

interface CacheEntry {
  at: number;
  data: { rows: SpecRow[]; profile: MachineProfile };
}
const g = globalThis as unknown as { __archSpecsCache?: CacheEntry };
const CACHE_MS = 60_000;

const KB = 1 / 1024 ** 0; // meminfo reports kB
function kbToGb(kb: number): number {
  return Math.round((kb * KB * 1024) / 1024 ** 3 * 10) / 10;
}

async function parseCpu(): Promise<{
  model: string | null;
  threads: number | null;
  cores: number | null;
  status: SpecStatus;
}> {
  const raw = await readText("/proc/cpuinfo");
  if (raw) {
    const modelMatch = raw.match(/model name\s*:\s*(.+)/);
    const threads = (raw.match(/^processor\s*:/gm) ?? []).length;
    const pairs = new Set<string>();
    const re = /physical id\s*:\s*(\d+)|core id\s*:\s*(\d+)/g;
    // collect (physical id, core id) pairs
    let phys: string | null = null;
    let line: RegExpExecArray | null = null;
    const blocks = raw.split(/\n\s*\n/);
    for (const block of blocks) {
      const p = block.match(/physical id\s*:\s*(\d+)/)?.[1] ?? "0";
      const c = block.match(/core id\s*:\s*(\d+)/)?.[1];
      if (c) pairs.add(`${p}:${c}`);
    }
    void re;
    void phys;
    void line;
    return {
      model: modelMatch?.[1].trim() ?? null,
      threads: threads || null,
      cores: pairs.size || threads || null,
      status: "detected",
    };
  }
  // fallback
  const nproc = (await execOut("nproc", [])) ?? (await execOut("getconf", ["_NPROCESSORS_ONLN"]));
  const threads = nproc ? parseInt(nproc.trim(), 10) : null;
  return { model: null, threads, cores: threads, status: threads ? "estimated" : "unavailable" };
}

async function parseMeminfo(): Promise<{ totalKB: number | null; availKB: number | null }> {
  const raw = await readText("/proc/meminfo");
  if (!raw) return { totalKB: null, availKB: null };
  const total = parseInt(raw.match(/^MemTotal:\s+(\d+)/m)?.[1] ?? "", 10);
  const avail = parseInt(raw.match(/^MemAvailable:\s+(\d+)/m)?.[1] ?? "", 10);
  return { totalKB: isNaN(total) ? null : total, availKB: isNaN(avail) ? null : avail };
}

async function parseSwap(): Promise<number | null> {
  const raw = await readText("/proc/swaps");
  if (!raw) return null;
  let totalKb = 0;
  for (const line of raw.split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/);
    const size = parseInt(cols[3] ?? "", 10);
    if (!isNaN(size)) totalKb += size;
  }
  return totalKb > 0 ? kbToGb(totalKb) : 0;
}

async function parseGpu(): Promise<{
  gpu: string | null;
  vendor: MachineProfile["gpuVendor"];
  status: SpecStatus;
}> {
  const lspci = await execOut("lspci", []);
  if (lspci) {
    const lines = lspci
      .split("\n")
      .filter((l) => /vga|3d controller|display controller/i.test(l));
    if (lines.length > 0) {
      const desc = lines[0].split(/:/).slice(2).join(":").trim();
      const all = lines.map((l) => l.split(/:/).slice(2).join(":").trim()).join(" + ");
      const vendor: MachineProfile["gpuVendor"] = /nvidia/i.test(all)
        ? "nvidia"
        : /amd|advanced micro|radeon/i.test(all)
          ? "amd"
          : /intel/i.test(all)
            ? "intel"
            : null;
      return { gpu: all, vendor, status: "detected" };
    }
    // lspci works and shows nothing → genuinely no GPU (container/VM edge)
    return { gpu: null, vendor: null, status: "detected" };
  }
  // Fallback: DRM vendor ids
  try {
    const cards = (await readdir("/sys/class/drm")).filter((c) => /^card\d+$/.test(c));
    for (const card of cards) {
      const vendorRaw = (await readText(`/sys/class/drm/${card}/device/vendor`))?.trim();
      if (vendorRaw === "0x10de")
        return { gpu: "NVIDIA GPU (model unknown)", vendor: "nvidia", status: "estimated" };
      if (vendorRaw === "0x1002")
        return { gpu: "AMD GPU (model unknown)", vendor: "amd", status: "estimated" };
      if (vendorRaw === "0x8086")
        return { gpu: "Intel GPU (model unknown)", vendor: "intel", status: "estimated" };
    }
  } catch {
    // no DRM either
  }
  return { gpu: null, vendor: null, status: "estimated" };
}

async function parseVram(
  vendor: MachineProfile["gpuVendor"],
  gpuStatus: SpecStatus
): Promise<{ vramGB: number | null; shared: boolean; status: SpecStatus; detail?: string }> {
  if (vendor === "nvidia") {
    const out = await execOut("nvidia-smi", [
      "--query-gpu=memory.total",
      "--format=csv,noheader,nounits",
    ]);
    if (out) {
      const mib = parseInt(out.split("\n")[0].trim(), 10);
      if (!isNaN(mib) && mib > 0) return { vramGB: Math.round((mib / 1024) * 10) / 10, shared: false, status: "detected" };
    }
  }
  if (vendor === "amd") {
    try {
      const cards = (await readdir("/sys/class/drm")).filter((c) => /^card\d+$/.test(c));
      for (const card of cards) {
        const raw = await readText(`/sys/class/drm/${card}/device/mem_info_vram_total`);
        if (raw) {
          const bytes = parseInt(raw.trim(), 10);
          if (!isNaN(bytes) && bytes > 0)
            return { vramGB: Math.round((bytes / 1024 ** 3) * 10) / 10, shared: false, status: "detected" };
        }
      }
    } catch {
      // fall through
    }
  }
  if (vendor === "intel") {
    return {
      vramGB: null,
      shared: true,
      status: "estimated",
      detail: "Intel integrated graphics share system RAM — roughly half of RAM is usable for inference",
    };
  }
  if (gpuStatus === "estimated" && vendor === null) {
    return { vramGB: null, shared: false, status: "unavailable", detail: "no GPU detected" };
  }
  return {
    vramGB: null,
    shared: false,
    status: gpuStatus === "detected" ? "estimated" : "unavailable",
    detail: gpuStatus === "detected" ? "GPU present but VRAM could not be probed (nvidia-smi / sysfs unavailable)" : undefined,
  };
}

async function parseStorage(): Promise<{ free: number | null; total: number | null }> {
  const out = await execOut("df", ["-B1", "/"]);
  if (out) {
    const lines = out.trim().split("\n");
    const last = lines[lines.length - 1].trim().split(/\s+/);
    const total = parseInt(last[1], 10);
    const free = parseInt(last[3], 10);
    return {
      total: isNaN(total) ? null : Math.round((total / 1024 ** 3) * 10) / 10,
      free: isNaN(free) ? null : Math.round((free / 1024 ** 3) * 10) / 10,
    };
  }
  return { free: null, total: null };
}

function tierFor(budget: number, vram: number | null): { tier: string; note: string } {
  if (vram !== null && vram >= 6) {
    if (budget >= 60) return { tier: "Workstation", note: "frontier-scale local models fit in VRAM" };
    if (budget >= 20) return { tier: "Large (GPU)", note: "30B MoE and 32B reasoning models fit in VRAM" };
    if (budget >= 10) return { tier: "Mid-range (GPU)", note: "up to 14B dense models run on the GPU" };
    return { tier: "Small (GPU)", note: "8B-class models fit in VRAM" };
  }
  if (budget >= 60) return { tier: "Workstation (CPU/RAM)", note: "frontier-scale locals fit in RAM" };
  if (budget >= 20) return { tier: "Large (CPU/RAM)", note: "30B MoE models fit, GPU-less but usable" };
  if (budget >= 10) return { tier: "Mid-range", note: "up to 14B dense or 20B MoE models fit" };
  if (budget >= 5.5) return { tier: "Modest", note: "up to 8B (Q4) models run comfortably" };
  if (budget >= 2.5) return { tier: "Small", note: "1–4B models only" };
  return { tier: "Tiny", note: "quick chat models only — under 2.5 GB budget" };
}

export async function detectSpecs(force = false): Promise<{ rows: SpecRow[]; profile: MachineProfile }> {
  const cached = g.__archSpecsCache;
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.data;

  const [cpu, mem, swap, gpu, storage] = await Promise.all([
    parseCpu(),
    parseMeminfo(),
    parseSwap(),
    parseGpu(),
    parseStorage(),
  ]);
  const vram = await parseVram(gpu.vendor, gpu.status);
  const osRelease = await readText("/etc/os-release");
  const os = osRelease?.match(/^PRETTY_NAME="?([^"\n]+)"?/m)?.[1] ?? null;
  const kernel = (await execOut("uname", ["-r"]))?.trim() ?? null;

  const ramGB = mem.totalKB ? kbToGb(mem.totalKB) : null;
  const ramAvailableGB = mem.availKB ? kbToGb(mem.availKB) : null;

  const accel: MachineProfile["accel"] =
    vram.shared ? "shared" : gpu.vendor === "nvidia" ? "cuda" : gpu.vendor === "amd" ? "rocm" : "cpu";

  const gpuBudgetGB = vram.vramGB ? Math.round(vram.vramGB * 0.92 * 10) / 10 : 0;
  const cpuRamBudgetGB =
    ramGB !== null ? Math.max(0, Math.round((ramGB - 1.5) * 0.9 * 10) / 10) : 0;
  const budgetKind: MachineProfile["budgetKind"] = vram.vramGB
    ? "vram"
    : vram.shared
      ? "shared"
      : "ram";
  const sharedBudgetGB = vram.shared && ramGB ? Math.round(Math.min(ramGB * 0.5, 16) * 10) / 10 : 0;
  const totalBudgetGB = Math.max(gpuBudgetGB, sharedBudgetGB, cpuRamBudgetGB);
  const { tier, note } = tierFor(totalBudgetGB, vram.vramGB);

  const profile: MachineProfile = {
    cpuModel: cpu.model,
    cpuThreads: cpu.threads,
    cpuCores: cpu.cores,
    ramGB,
    ramAvailableGB,
    swapGB: swap,
    gpu: gpu.gpu,
    gpuVendor: gpu.vendor,
    vramGB: vram.vramGB,
    vramShared: vram.shared,
    storageFreeGB: storage.free,
    storageTotalGB: storage.total,
    os,
    kernel,
    accel,
    cpuRamBudgetGB,
    gpuBudgetGB,
    totalBudgetGB,
    budgetKind,
    tier,
    tierNote: note,
  };

  const gb = (v: number | null, unit = "GB") =>
    v === null ? "—" : `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)} ${unit}`;

  const rows: SpecRow[] = [
    {
      key: "cpu",
      label: "CPU",
      value: cpu.model ?? "unknown",
      detail: cpu.cores ? `${cpu.cores} cores / ${cpu.threads} threads` : undefined,
      status: cpu.status,
    },
    {
      key: "gpu",
      label: "GPU",
      value: gpu.gpu ?? "none detected — CPU-only inference",
      status: gpu.status,
      detail: gpu.vendor && !gpu.gpu ? "vendor identified from DRM class, model unknown" : undefined,
    },
    {
      key: "vram",
      label: "VRAM",
      value: vram.shared ? gb(ramGB ? Math.min(ramGB * 0.5, 16) : null) + " shared (est.)" : gb(vram.vramGB),
      detail: vram.detail,
      status: vram.status,
    },
    {
      key: "ram",
      label: "RAM",
      value: gb(ramGB),
      detail: ramAvailableGB !== null ? `${gb(ramAvailableGB)} currently available` : undefined,
      status: ramGB !== null ? "detected" : "unavailable",
    },
    {
      key: "swap",
      label: "Swap",
      value: swap === null ? "—" : swap === 0 ? "none" : gb(swap),
      detail: swap !== null && swap > 0 ? "lets oversized models start — very slowly" : undefined,
      status: swap === null ? "estimated" : "detected",
    },
    {
      key: "storage",
      label: "Storage (/)",
      value:
        storage.free !== null
          ? `${gb(storage.free)} free of ${gb(storage.total)}`
          : "—",
      detail: "model downloads need roughly their sizeGB on disk",
      status: storage.free !== null ? "detected" : "unavailable",
    },
    {
      key: "os",
      label: "Operating system",
      value: [os, kernel ? `kernel ${kernel}` : null].filter(Boolean).join(" · ") || "—",
      status: os ? "detected" : "estimated",
    },
  ];

  const data = { rows, profile };
  g.__archSpecsCache = { at: Date.now(), data };
  return data;
}
