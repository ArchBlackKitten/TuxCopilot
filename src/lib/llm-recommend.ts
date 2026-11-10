// Recommendation engine for the Ollama section.
// Models are compared *within* a speciality (a maths champion is not penalised
// for being a mediocre poet) and scored against this machine's measured budget.
// Nothing here installs, removes or switches anything — the UI gates every
// action behind an explicit confirmation.

import { MODELS, SPECIALTIES, SPECIALTY_LABEL, type LlmModel, type Specialty } from "./llm-kb";
import type { MachineProfile } from "./system-specs";

export interface InstalledModel {
  name: string;
  sizeGB: number | null;
  modified: string | null;
  params: string | null;
}

export type Verdict = "fast" | "usable" | "slow" | "unusable";
export type Priority = "speed" | "quality" | "low";

export interface Fit {
  model: LlmModel;
  verdict: Verdict;
  speed: string; // human estimate, always labelled estimated upstream
  perfNote: string;
  fitNote: string;
  storageNote?: string;
  score: number;
  installed: boolean;
  bestFor?: Specialty;
}

export interface CategoryBlock {
  specialty: Specialty;
  label: string;
  blurb: string;
  candidates: Fit[];
  bestFit: Fit | null;
  installedCovers: Array<{ name: string; kb: LlmModel | null; note: string }>;
}

export interface RecommendationResult {
  priority: Priority;
  recommended: Fit[];
  unsuitable: Array<{ model: LlmModel; reason: string; needGB: number; headroomGB: number }>;
  categories: CategoryBlock[];
  machineSummary: string;
  assumedRam: boolean;
}

const SPEED_TABLE: Record<Exclude<Verdict, "unusable">, Record<MachineProfile["budgetKind"], string>> = {
  fast: { vram: "~30–50 tok/s", shared: "~15–25 tok/s", ram: "~10–18 tok/s" },
  usable: { vram: "~12–25 tok/s", shared: "~6–12 tok/s", ram: "~4–8 tok/s" },
  slow: { vram: "~4–8 tok/s", shared: "~2–4 tok/s", ram: "~1–3 tok/s" },
};

function speedRank(v: Verdict): number {
  return v === "fast" ? 3 : v === "usable" ? 2 : v === "slow" ? 1 : 0;
}

export function judgeModel(model: LlmModel, profile: MachineProfile): Fit {
  const assumedRam = profile.ramGB === null;
  const ramGB = profile.ramGB ?? 8; // assumption, flagged as estimated
  const swapGB = profile.swapGB ?? 0;
  const cpuBudget = profile.cpuRamBudgetGB > 0 ? profile.cpuRamBudgetGB : Math.max(0, (ramGB - 1.5) * 0.9);
  const maxStartGB = ramGB + swapGB * 0.8 - 0.5; // absolute ceiling to even load
  const swapPhrase =
    swapGB > 0
      ? "only starts by leaning on swap"
      : "starts only by overcommitting RAM — heavy swapping, risky";

  const needGB = model.ramGB;
  const sizeGB = model.sizeGB;

  let verdict: Verdict;
  let where: string;

  if (profile.budgetKind === "vram" && profile.gpuBudgetGB > 0) {
    if (sizeGB <= profile.gpuBudgetGB) {
      verdict = sizeGB <= profile.gpuBudgetGB * 0.55 ? "fast" : "usable";
      where = "fits entirely in VRAM";
    } else if (needGB <= cpuBudget) {
      verdict = sizeGB <= cpuBudget * 0.6 ? "usable" : "slow";
      where = "overflows VRAM — runs from system RAM instead";
    } else if (needGB <= maxStartGB) {
      verdict = "slow";
      where = swapPhrase;
    } else {
      verdict = "unusable";
      where = "cannot be loaded on this machine";
    }
  } else if (profile.budgetKind === "shared") {
    const shared = Math.min(ramGB * 0.5, 16);
    if (sizeGB <= shared * 0.5) {
      verdict = "fast";
      where = "runs in the iGPU's shared memory";
    } else if (needGB <= cpuBudget) {
      verdict = sizeGB <= shared ? "usable" : "slow";
      where = "runs from shared memory / RAM";
    } else if (needGB <= maxStartGB) {
      verdict = "slow";
      where = swapPhrase;
    } else {
      verdict = "unusable";
      where = "cannot be loaded on this machine";
    }
  } else {
    // CPU / RAM budget
    if (sizeGB <= cpuBudget * 0.45) {
      verdict = "fast";
      where = "fits comfortably in system RAM";
    } else if (needGB <= cpuBudget) {
      verdict = "usable";
      where = "fits in system RAM";
    } else if (needGB <= maxStartGB) {
      verdict = "slow";
      where = "only starts by leaning on swap";
    } else {
      verdict = "unusable";
      where = "cannot be loaded on this machine";
    }
  }

  // Dense, GPU-loving models crawl on CPU-only boxes — cap the verdict there.
  if (model.gpuPreferred && profile.gpuBudgetGB === 0 && !profile.vramShared && (verdict === "fast" || verdict === "usable")) {
    verdict = "slow";
    where = `${where} — but this model really wants a discrete GPU, and none was detected`;
  }

  let speed = "will not start";
  let perfNote = "";
  switch (verdict) {
    case "fast":
      speed = SPEED_TABLE.fast[profile.budgetKind];
      perfNote = `Responsive for interactive chat. ${where}.`;
      break;
    case "usable":
      speed = SPEED_TABLE.usable[profile.budgetKind];
      perfNote = `Comfortable for batch work, a little patient for chat. ${where}.`;
      break;
    case "slow":
      speed = SPEED_TABLE.slow[profile.budgetKind];
      perfNote = `It will start, but slowly — expect to wait between turns. ${where}.`;
      break;
    case "unusable":
      speed = "will not start";
      perfNote = `Needs about ${needGB} GB just to load; this machine tops out around ${Math.round(maxStartGB + 0.5)} GB. Forcing it would thrash the machine to a standstill.`;
      break;
  }
  if (assumedRam && verdict !== "unusable") {
    perfNote += " RAM could not be read — 8 GB assumed.";
  }

  const fitNote =
    verdict === "unusable"
      ? "Do not attempt — see the Unsuitable LLamas list."
      : profile.budgetKind === "vram"
        ? `VRAM budget ${profile.gpuBudgetGB} GB · model needs ~${sizeGB} GB on disk, ~${needGB} GB at runtime.`
        : `RAM budget ~${cpuBudget} GB · model needs ~${sizeGB} GB on disk, ~${needGB} GB at runtime.`;

  const storageNote =
    profile.storageFreeGB !== null && profile.storageFreeGB < sizeGB
      ? `needs ${sizeGB} GB free on disk — only ${profile.storageFreeGB} GB free on /`
      : undefined;

  return { model, verdict, speed, perfNote, fitNote, storageNote, score: 0, installed: false };
}

function priorityScore(fit: Fit, specialty: Specialty, priority: Priority): number {
  const q = fit.model.quality[specialty] ?? 0;
  const sr = speedRank(fit.verdict);
  if (priority === "speed") return sr * 10 + q - fit.model.sizeGB * 0.25;
  if (priority === "quality") return q * 10 + sr * 2;
  return q * 4 - fit.model.ramGB * 1.2 + sr * 3; // "low" resource use
}

export function recommend(
  profile: MachineProfile,
  installed: InstalledModel[],
  priority: Priority
): RecommendationResult {
  const fits = new Map<string, Fit>();
  for (const m of MODELS) fits.set(m.tag, judgeModel(m, profile));
  const installedNames = new Set(installed.map((i) => i.name.toLowerCase()));

  const bestFits = new Map<Specialty, Fit>();

  const categories: CategoryBlock[] = SPECIALTIES.map((sp) => {
    const candidates = MODELS.filter((m) => m.specialties.includes(sp.id))
      .map((m) => fits.get(m.tag)!)
      .filter((f) => f.verdict !== "unusable");
    for (const f of candidates) {
      f.score = priorityScore(f, sp.id, priority);
      f.installed = installedNames.has(f.model.tag.toLowerCase());
    }
    candidates.sort((a, b) => b.score - a.score);
    const shown = candidates.slice(0, 4);
    const bestFit = candidates.find((f) => !f.model.auxiliary) ?? null;
    if (bestFit) {
      bestFit.bestFor = sp.id;
      bestFits.set(sp.id, bestFit);
    }

    // How do the models already on disk cover this task?
    const installedCovers = installed
      .map((inst) => {
        const kb = MODELS.find((m) => inst.name.toLowerCase() === m.tag.toLowerCase() || inst.name.toLowerCase().startsWith(m.tag.toLowerCase()));
        if (!kb) {
          return { name: inst.name, kb: null, note: "not in the catalogue — judge by its family's reputation" };
        }
        const q = kb.quality[sp.id];
        if (q === undefined) {
          return { name: inst.name, kb, note: `${kb.family} is installed but was never tuned for this task` };
        }
        const best = bestFit;
        if (best && best.model.tag === kb.tag) {
          return { name: inst.name, kb, note: `installed — and already this machine's best fit for ${SPECIALTY_LABEL[sp.id].toLowerCase()} (${q}/10)` };
        }
        return {
          name: inst.name,
          kb,
          note: `installed — covers this task at ${q}/10${best ? `; the best fit would score ${best.model.quality[sp.id] ?? "?"}/10` : ""}`,
        };
      })
      .slice(0, 4);

    return {
      specialty: sp.id,
      label: sp.label,
      blurb: sp.blurb,
      candidates: shown,
      bestFit,
      installedCovers,
    };
  });

  // Recommended LLamas — each task's best fit, deduplicated, ranked again.
  const recommended: Fit[] = [];
  const seen = new Set<string>();
  for (const sp of SPECIALTIES) {
    const best = bestFits.get(sp.id);
    if (best && !seen.has(best.model.tag)) {
      seen.add(best.model.tag);
      recommended.push(best);
    }
  }
  recommended.sort((a, b) => b.score - a.score);

  // Unsuitable LLamas — nearest misses first.
  const ramGB = profile.ramGB ?? 8;
  const maxStartGB = ramGB + (profile.swapGB ?? 0) * 0.8 - 0.5;
  const unsuitable = MODELS.map((m) => ({ model: m, fit: fits.get(m.tag)! }))
    .filter(({ fit }) => fit.verdict === "unusable")
    .map(({ model, fit }) => ({
      model,
      needGB: model.ramGB,
      headroomGB: Math.round((model.ramGB - maxStartGB) * 10) / 10,
      reason: fit.perfNote,
    }))
    .sort((a, b) => a.headroomGB - b.headroomGB)
    .map(({ model, needGB, headroomGB, reason }) => ({ model, needGB, headroomGB, reason }));

  const budget = profile.budgetKind === "vram" ? `${profile.gpuBudgetGB} GB of VRAM` : `~${Math.round(profile.totalBudgetGB)} GB of RAM`;
  const machineSummary = `This machine offers ${budget} for one model (${profile.tier.toLowerCase()} tier). ${
    profile.gpuVendor === "nvidia" ? "CUDA acceleration detected." : profile.gpuVendor === "amd" ? "AMD GPU detected — ROCm builds vary." : profile.vramShared ? "Integrated graphics share system RAM." : "No discrete GPU — CPU inference."
  } Speed figures are estimates; the spec sheet above says what was truly measured.`;

  return {
    priority,
    recommended,
    unsuitable,
    categories,
    machineSummary,
    assumedRam: profile.ramGB === null,
  };
}
