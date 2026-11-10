// Pressing Troubleshoot must move the terminal panel: its report is written there, shows
// until a newer run starts, and a fix closes the Troubleshoot window before it runs.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { showsNote } from "@/components/arch/terminal-panel";
import { formatReport } from "@/lib/troubleshoot";

describe("the terminal panel", () => {
  const t = Date.parse("2026-10-26T22:35:00Z");
  it("shows the report over an older run, never over a live one, and gives way to a newer run", () => {
    expect(showsNote({ at: t }, null)).toBe(true);
    expect(showsNote({ at: t }, { status: "success", startedAt: "2026-10-26T22:29:45Z" })).toBe(true);
    expect(showsNote({ at: t }, { status: "running", startedAt: "2026-10-26T22:29:45Z" })).toBe(false);
    expect(showsNote({ at: t }, { status: "success", startedAt: "2026-10-26T22:36:00Z" })).toBe(false);
    expect(showsNote(null, null)).toBe(false);
  });

  it("the report: every check, its mark, and the fix command", () => {
    const r = formatReport("Ollama", {
      checks: [
        { id: "installed", label: "Ollama is installed", ok: true, detail: "0.40.11" },
        { id: "service", label: "The Ollama server is running", ok: false, detail: "no server runs", fix: { label: "Start Ollama", command: "sudo systemctl enable --now ollama.service", note: "" } },
      ],
      errors: [],
      resets: [],
    });
    expect(r).toContain("✓ Ollama is installed — 0.40.11");
    expect(r).toContain("✗ The Ollama server is running — no server runs");
    expect(r).toContain("    fix: sudo systemctl enable --now ollama.service");
    expect(r).toContain("1 problem");
  });

  it("a fix closes the Troubleshoot window before anything runs", () => {
    const src = readFileSync(join(__dirname, "components/arch/troubleshoot-dialog.tsx"), "utf8");
    const body = src.slice(src.indexOf("const run = async (f: Fix)"));
    expect(body.indexOf("onClose();")).toBeGreaterThan(-1);
    expect(body.indexOf("onClose();")).toBeLessThan(body.indexOf("runQuick("));
  });
});
