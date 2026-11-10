// Shared types for TuxCopilot

export type Category = "command" | "download";
export type Source = "pacman" | "yay" | "github" | "ollama" | "flatpak" | "snap";

export interface NodeDTO {
  id: string;
  name: string;
  category: Category;
  source: Source | null;
  content: string | null;
  enabled: boolean;
  order: number;
  parentId: string | null;
  children: NodeDTO[];
}

export interface RunStep {
  id: string;
  label: string;
  command: string;
  kind: "shell" | "pacman" | "yay" | "github" | "ollama" | "flatpak" | "snap";
  nodeIds: string[];
}

export type RunStatus = "idle" | "running" | "success" | "failed" | "stopped" | "dry-run";

export interface RunState {
  status: RunStatus;
  label: string;
  dryRun: boolean;
  steps: RunStep[];
  currentStepIndex: number;
  output: string;          // full accumulated output so far
  startedAt: string | null;
  finishedAt: string | null;
  exitSummary: string | null;
  failedSteps?: number[]; // steps that ended with an error
  okSteps?: number[]; // steps that ended well (a stopped run's later steps are in neither)
  activity?: string[]; // what the run is doing right now (program names)
  waitingPassword?: boolean; // the password window is open
}

export interface ParsedNode {
  name: string;
  category: Category;
  source: Source | null;
  content: string | null;
  enabled: boolean;
  children: ParsedNode[];
}

export interface ParseResult {
  roots: ParsedNode[];
  errors: string[];
}

// ── App Manager ──────────────────────────────────────────────────────────

export type AppSource = "pacman" | "aur" | "flatpak" | "snap" | "appimage" | "git" | "other" | "simulated" | "sample";

export interface AppUsageRow {
  app: string;
  source: AppSource;
  system: string | null; // why it is part of the system (flagged "System"; never removable)
  seconds: number;
  sessions: number;
  days: number;       // distinct days with usage in the month
  lastDay: string | null;
}

export interface UnusedAppRow {
  app: string;
  source: AppSource;
  system: string | null; // why it is part of the system (flagged "System"; never removable)
  lastUsedMonth: string | null; // null = never seen by the tracker
}

export interface TrackerStatus {
  running: boolean;
  intervalSec: number;
  startedAt: string | null;
  lastSampleAt: string | null;
  samples: number;
  lastError: string | null;
  nowRunning: string[]; // apps observed in the latest tick
  liveApps: string[];
}

export interface UsageSnapshot {
  month: string;
  months: string[];
  detected: {
    mode: "detected" | "sample";
    pacmanAvailable: boolean;
    flatpakAvailable: boolean;
    snapAvailable: boolean;
    note: string;
    checkedAt: string;
    appCount: number;
  };
  ranking: AppUsageRow[];   // sorted by time desc
  unused: UnusedAppRow[];
  removed: string[]; // in the usage history, but no longer installed — not listed
  totals: { seconds: number; sessions: number; apps: number };
  tracker: TrackerStatus;
  simulatedRows: boolean;   // month contains simulated data
}

export interface EliminationCommand {
  command: string;
  note: string;
  /** The whole Full plan as one command that removes this one app entirely. */
  allInOne?: boolean;
}

export interface EliminationPlan {
  level: "full" | "mid" | "partial";
  title: string;
  tagline: string;
  removes: string[];
  keeps: string[];
  commands: EliminationCommand[];
  warning?: string;
}
