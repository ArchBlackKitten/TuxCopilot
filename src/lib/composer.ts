// Composes the list of shell steps that a "Play" press will execute.
// - command items run as-is (bash)
// - pacman / yay download items are batched into ONE command each with --needed
// - github items become git clone commands (one step per repo)
// - flatpak items are batched into ONE install from Flathub; snaps install one per step
// - disabled nodes and their subtrees are skipped

import type { NodeDTO, RunStep } from "./types";

export function gitCloneCommand(content: string): string {
  const raw = content.trim();
  if (/^(https?:\/\/|git@|ssh:\/\/)/.test(raw)) {
    return `git clone ${raw}`;
  }
  const repo = raw.replace(/\.git$/, "");
  return `git clone https://github.com/${repo}.git`;
}

// Play has no terminal to answer "Proceed? [Y/n]": pacman reads end-of-file as "no" and
// installs nothing. --noconfirm takes the default answers; Dry Run shows the command first.
// -Syu: the lists fresh and the system updated first, so an install never fails
// with "target not found" and never lands on a half-updated system.
export function pacmanCommand(pkgs: string[], needed: boolean): string {
  return `sudo pacman -Syu${needed ? " --needed" : ""} --noconfirm ${pkgs.join(" ")}`;
}

export function yayCommand(pkgs: string[], needed: boolean): string {
  return `yay -Syu${needed ? " --needed" : ""} --noconfirm ${pkgs.join(" ")}`;
}

// Flatpaks go in for your user: no password, nothing system-wide. Flathub is added for your
// user first if it is missing, so the first install on a fresh machine does not fail.
export const FLATHUB_ADD = "flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo";
export function flatpakCommand(ids: string[]): string {
  return `${FLATHUB_ADD} && flatpak install --user -y --noninteractive flathub ${ids.join(" ")}`;
}

// `--classic` (written in the item, e.g. "code --classic") lets a snap outside the sandbox;
// snap only takes it for one name at a time, so every snap is its own step.
export function snapCommand(name: string, classic: boolean): string {
  return `sudo snap install${classic ? " --classic" : ""} ${name}`;
}

// Getting the tools themselves (Apps → Flatpaks / Snaps, when they are missing or stopped).
export const FLATPAK_SETUP = `sudo pacman -Syu --needed --noconfirm flatpak && ${FLATHUB_ADD}`;
// snapd from the AUR, then its socket; /snap is the link "classic" snaps expect; with
// AppArmor on, snapd's own profile service too (Arch wiki: Snap).
const SNAPD_START =
  "sudo systemctl enable --now snapd.socket && ([ -e /snap ] || sudo ln -s /var/lib/snapd/snap /snap) && " +
  "(! systemctl is-enabled --quiet apparmor.service || sudo systemctl enable --now snapd.apparmor.service)";
export const SNAP_SETUP = `yay -Syu --needed --noconfirm snapd && ${SNAPD_START}`;
export const SNAP_START = SNAPD_START;

// The review (5.3): a download item's names go into a command, so each must look like what it says
// it is — a `;` or a `--option` pasted from a document is skipped, and said, instead of run.
const SHAPES: Record<string, [RegExp, string]> = {
  pacman: [/^([a-z0-9][a-z0-9._-]*\/)?[a-z0-9@_+][a-z0-9@._+-]*$/, "a package name"],
  yay: [/^([a-z0-9][a-z0-9._-]*\/)?[a-z0-9@_+][a-z0-9@._+-]*$/, "a package name"],
  flatpak: [/^[A-Za-z0-9_][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)+$/, "a Flatpak ID (like org.mozilla.firefox)"],
  snap: [/^[a-z0-9][a-z0-9-]*$/, "a snap name"],
  ollama: [/^[a-z0-9][a-z0-9._/-]*(:[A-Za-z0-9._-]+)?$/, "a model name"],
};
const GIT_ADDRESS = /^(https?:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9_.~/-]+|ssh:\/\/[A-Za-z0-9@.-]+(:\d+)?\/[A-Za-z0-9_.~/-]+|git@[A-Za-z0-9.-]+:[A-Za-z0-9_.~/-]+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/;

/** The names that look right; the odd ones said in `notes`, by item. */
export function checkedNames(source: string, tokens: string[], item: string, notes: string[], allowed: string[] = []): string[] {
  const [shape, what] = SHAPES[source];
  return tokens.filter((t) => {
    if (allowed.includes(t) || shape.test(t)) return true;
    notes.push(`Download item "${item}": "${t}" isn't ${what}, so Fluff skipped it (the rest runs).`);
    return false;
  });
}

/** A GitHub item's address, if it looks like one; otherwise said in `notes`. */
export function checkedAddress(content: string, item: string, notes: string[]): string | null {
  if (GIT_ADDRESS.test(content.trim()) && !content.trim().startsWith("-")) return content.trim();
  notes.push(`Download item "${item}": "${content.trim()}" isn't a git address (like owner/repo or https://…), so Fluff skipped it.`);
  return null;
}

function pkgTokens(content: string): string[] {
  return content
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !t.startsWith("#"));
}

interface Collected {
  steps: Array<RunStep & { seq: number }>;
  pacman: { pkgs: string[]; nodeIds: string[]; seq: number | null };
  yay: { pkgs: string[]; nodeIds: string[]; seq: number | null };
  flatpak: { pkgs: string[]; nodeIds: string[]; seq: number | null };
  notes: string[];
}

export function composeSteps(
  roots: NodeDTO[],
  opts: { scope: "all" | string; needed: boolean }
): { steps: RunStep[]; notes: string[] } {
  // Scope: "all" → whole tree; otherwise the subtree of the given node id
  let scoped: NodeDTO[] = roots;
  if (opts.scope !== "all") {
    const find = (nodes: NodeDTO[]): NodeDTO | null => {
      for (const n of nodes) {
        if (n.id === opts.scope) return n;
        const hit = find(n.children);
        if (hit) return hit;
      }
      return null;
    };
    const node = find(roots);
    if (!node) return { steps: [], notes: ["Section not found"] };
    scoped = [node];
  }

  const collected: Collected = {
    steps: [],
    pacman: { pkgs: [], nodeIds: [], seq: null },
    yay: { pkgs: [], nodeIds: [], seq: null },
    flatpak: { pkgs: [], nodeIds: [], seq: null },
    notes: [],
  };
  let seq = 0;
  let stepN = 0;

  const walk = (nodes: NodeDTO[]) => {
    for (const node of nodes) {
      if (!node.enabled) continue; // switch OFF → skipped, subtree included
      const content = node.content?.trim() ?? "";

      if (content) {
        const current = seq++;
        if (node.category === "command") {
          collected.steps.push({
            id: `step-${++stepN}`,
            label: node.name,
            command: content,
            kind: "shell",
            nodeIds: [node.id],
            seq: current,
          } as RunStep & { seq: number });
        } else if (node.source === "pacman") {
          for (const p of checkedNames("pacman", pkgTokens(content), node.name, collected.notes)) {
            if (!collected.pacman.pkgs.includes(p)) collected.pacman.pkgs.push(p);
          }
          collected.pacman.nodeIds.push(node.id);
          if (collected.pacman.seq === null) collected.pacman.seq = current;
        } else if (node.source === "yay") {
          for (const p of checkedNames("yay", pkgTokens(content), node.name, collected.notes)) {
            if (!collected.yay.pkgs.includes(p)) collected.yay.pkgs.push(p);
          }
          collected.yay.nodeIds.push(node.id);
          if (collected.yay.seq === null) collected.yay.seq = current;
        } else if (node.source === "flatpak") {
          for (const p of checkedNames("flatpak", pkgTokens(content), node.name, collected.notes)) {
            if (!collected.flatpak.pkgs.includes(p)) collected.flatpak.pkgs.push(p);
          }
          collected.flatpak.nodeIds.push(node.id);
          if (collected.flatpak.seq === null) collected.flatpak.seq = current;
        } else if (node.source === "snap") {
          const tokens = checkedNames("snap", pkgTokens(content), node.name, collected.notes, ["--classic"]);
          const classic = tokens.includes("--classic");
          for (const p of tokens.filter((t) => !t.startsWith("-"))) {
            collected.steps.push({
              id: `step-${++stepN}`,
              label: `Install snap ${p}`,
              command: snapCommand(p, classic),
              kind: "snap",
              nodeIds: [node.id],
              seq: current,
            } as RunStep & { seq: number });
          }
        } else if (node.source === "ollama") {
          for (const p of checkedNames("ollama", pkgTokens(content), node.name, collected.notes)) {
            collected.steps.push({
              id: `step-${++stepN}`,
              label: `Pull ${p}`,
              command: `ollama pull ${p}`,
              kind: "ollama",
              nodeIds: [node.id],
              seq: current,
            } as RunStep & { seq: number });
          }
        } else if (node.source === "github") {
          const address = checkedAddress(content, node.name, collected.notes);
          if (address)
            collected.steps.push({
              id: `step-${++stepN}`,
              label: node.name,
              command: gitCloneCommand(address),
              kind: "github",
              nodeIds: [node.id],
              seq: current,
            } as RunStep & { seq: number });
        } else {
          collected.notes.push(
            `Download item "${node.name}" has no source (pacman/yay/github/ollama/flatpak/snap) — skipped`
          );
        }
      }

      if (node.children.length > 0) walk(node.children);
    }
  };
  walk(scoped);

  // Emit package batches at the position of their first member
  const all: Array<RunStep & { seq: number }> = [...collected.steps];
  if (collected.pacman.pkgs.length > 0 && collected.pacman.seq !== null) {
    all.push({
      id: "step-pacman",
      label: `Install ${collected.pacman.pkgs.length} pacman package${collected.pacman.pkgs.length > 1 ? "s" : ""}`,
      command: pacmanCommand(collected.pacman.pkgs, opts.needed),
      kind: "pacman",
      nodeIds: collected.pacman.nodeIds,
      seq: collected.pacman.seq,
    });
  }
  if (collected.yay.pkgs.length > 0 && collected.yay.seq !== null) {
    all.push({
      id: "step-yay",
      label: `Install ${collected.yay.pkgs.length} AUR package${collected.yay.pkgs.length > 1 ? "s" : ""}`,
      command: yayCommand(collected.yay.pkgs, opts.needed),
      kind: "yay",
      nodeIds: collected.yay.nodeIds,
      seq: collected.yay.seq,
    });
  }
  if (collected.flatpak.pkgs.length > 0 && collected.flatpak.seq !== null) {
    all.push({
      id: "step-flatpak",
      label: `Install ${collected.flatpak.pkgs.length} flatpak${collected.flatpak.pkgs.length > 1 ? "s" : ""}`,
      command: flatpakCommand(collected.flatpak.pkgs),
      kind: "flatpak",
      nodeIds: collected.flatpak.nodeIds,
      seq: collected.flatpak.seq,
    });
  }
  all.sort((a, b) => a.seq - b.seq);

  return { steps: all.map(({ seq: _s, ...s }) => s), notes: collected.notes };
}

export function composeScript(steps: RunStep[]): string {
  return [
    "#!/usr/bin/env bash",
    "# Generated by TuxCopilot",
    "set -o pipefail",
    "",
    ...steps.map((s) => `# ${s.label}\n${s.command}`),
    "",
  ].join("\n");
}
