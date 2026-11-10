// Your apps keeps removed apps listed until you forget them; Fluff asks once for each.
import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = new Map<string, string>();
vi.mock("@/lib/host", async (orig) => ({
  ...(await orig<typeof import("@/lib/host")>()),
  inv: vi.fn(async (cmd: string, a: { key: string; value?: string }) => {
    if (cmd === "setting_get") return settings.get(a.key) ?? null;
    if (cmd === "setting_set") return void settings.set(a.key, a.value!);
    throw new Error(`not in this test: ${cmd}`);
  }),
}));

const { answerRemoved, removedFromMachine } = await import("@/lib/api");
const log = (entries: object[]) => settings.set("apps.removedLog", JSON.stringify(entries));

describe("removed apps stay in Your apps", () => {
  beforeEach(() => settings.clear());

  it("listed until forgotten; reinstalled ones leave the list; the newest entry of an app counts", async () => {
    log([
      { app: "krita", source: "pacman", noticedAt: "2026-10-01T00:00:00Z" },
      { app: "gimp", source: "pacman", noticedAt: "2026-10-02T00:00:00Z", back: true },
      { app: "vlc", source: "pacman", noticedAt: "2026-09-01T00:00:00Z", back: true },
      { app: "vlc", source: "pacman", noticedAt: "2026-10-03T00:00:00Z" },
    ]);
    expect((await removedFromMachine()).map((r) => [r.app, r.kept])).toEqual([["krita", false], ["vlc", false]]);
    await answerRemoved(["krita"], "keep");
    await answerRemoved(["vlc"], "forget");
    expect((await removedFromMachine()).map((r) => [r.app, r.kept])).toEqual([["krita", true]]);
  });

  it("App Manager's history keeps every entry: forgetting only hides it from Your apps", async () => {
    log([{ app: "krita", source: "pacman", noticedAt: "2026-10-01T00:00:00Z" }]);
    await answerRemoved(["krita"], "forget");
    expect(JSON.parse(settings.get("apps.removedLog")!)).toHaveLength(1);
  });
});
