// Gates on the frontend/host boundary. Read the sources as text, so they hold the tree to
// its rules rather than any one code path.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}
const files = walk(SRC).map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, "utf8") }));

describe("the single choke point", () => {
  it("only host.ts imports the raw Tauri invoke", () => {
    const offenders = files
      .filter((f) => /from\s+["']@tauri-apps\/api\/core["']/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual(["src/lib/host.ts"]);
  });

  it("nothing reaches for Node or the old Next.js server", () => {
    const offenders = files
      .filter((f) => /from\s+["'](child_process|fs|fs\/promises|next|next\/[^"']+|@prisma\/client)["']|fetch\(\s*[`"']\/api\//.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe("every edit waits for Apply", () => {
  // Writes to the app's data go through the store's staged changes (store.ts → apply), never
  // straight from a view. The only other writers: the modules that define the writes, and
  // arch-sync.ts, whose knowledge cache is the app learning the machine, not a user edit —
  // and penguin.ts: importing a penguin replaces everything, so it asks twice (passphrase,
  // then "Replace this TuxCopilot") and is refused while changes are pending — and lock.ts:
  // the lock's own settings are saved at once (a password code must never sit in pending
  // changes), each asking for the password code first.
  const WRITERS = /\b(createNode|updateNode|deleteNode|moveNode|importParsed|saveTracking|setOsChoice|saveLook|setMenuIcon|saveSignWith)\(|api\.setConfirmCount|"(nodes_import|node_create|node_update|node_delete|node_move|setting_set|os_choice_set|penguin_restore|penguin_forget_belongings|lock_set_pause|lock_change_password|lock_new_phone_finish|window_pref_set|security_marks_save)"/;
  const ALLOWED = ["src/lib/api.ts", "src/lib/tracking.ts", "src/lib/system-profile.ts", "src/components/arch/store.ts", "src/lib/arch-sync.ts", "src/lib/gitrepos.ts", "src/lib/look.ts", "src/lib/look-runtime.ts", "src/lib/integrity.ts", "src/lib/penguin.ts", "src/lib/lock.ts", "src/lib/window.ts", "src/lib/level-chosen.ts"];
  // level-chosen.ts: the weekly checkup's fingerprints taken again for a level that still
  // holds — like arch-sync's cache, the app learning the machine; the chosen levels change only by Apply.

  it("no view writes directly", () => {
    const offenders = files.filter((f) => WRITERS.test(f.text) && !ALLOWED.includes(f.path)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe("probe allowlist parity", () => {
  // Every literal execOut/execRaw call in the TS libs must be a line probe.rs allows,
  // or Rust refuses it and the feature silently reads as "unavailable".
  const rust = readFileSync(join(ROOT, "src-tauri/src/probe.rs"), "utf8");
  const block = rust.slice(rust.indexOf("ALLOWED_EXEC"), rust.indexOf("];", rust.indexOf("ALLOWED_EXEC")));
  const allowed = new Set(
    [...block.matchAll(/&\[([^\]]+)\]/g)].map((m) => JSON.stringify([...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1])))
  );

  const calls: string[] = [];
  for (const f of files) {
    for (const m of f.text.matchAll(/\bexec(?:Out|Raw|FileP)\(\s*"([^"]+)",\s*\[([^\]]*)\]/g)) {
      calls.push(JSON.stringify([m[1], ...[...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1])]));
    }
  }
  // jobs tables (arch-sync) pass cmd/args through variables: collect those too
  for (const f of files) {
    for (const m of f.text.matchAll(/cmd:\s*"([^"]+)",\s*args:\s*\[([^\]]*)\]/g)) {
      calls.push(JSON.stringify([m[1], ...[...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1])]));
    }
  }

  it("found the calls it is meant to check", () => {
    expect(calls.length).toBeGreaterThan(15);
    expect(allowed.size).toBeGreaterThan(15);
  });

  it("every probe the TS libs make is one Rust allows", () => {
    expect(calls.filter((c) => !allowed.has(c))).toEqual([]);
  });
});
