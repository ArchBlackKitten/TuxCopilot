// "Are you sure?": asked confirmCount times before a live run; any "no" stops it; a caller's
// own dialog counts as one of them.
import { beforeEach, describe, expect, it } from "vitest";
import { useArch } from "@/components/arch/store";
import { protectedReason, setCoreSystem } from "@/lib/protected";

/** Answers the prompts as they appear, recording what was asked. */
function answerWith(answers: boolean[]) {
  const asked: string[] = [];
  const unsub = useArch.subscribe((s) => {
    const p = s.pendingConfirm;
    if (p && asked.length < p.round) {
      asked.push(`${p.round}/${p.rounds}`);
      queueMicrotask(() => p.answer(answers[p.round - 1] ?? false));
    }
  });
  return { asked, done: unsub };
}

describe("are you sure", () => {
  // the SAVED count decides; a changed count only counts once it is applied
  beforeEach(() => useArch.setState({ savedConfirmCount: 2, confirmCount: 2, pendingConfirm: null }));

  it("asks twice by default and runs only after two yeses", async () => {
    const a = answerWith([true, true]);
    expect(await useArch.getState().askSure("Play All", ["sudo pacman -Syu"])).toBe(true);
    expect(a.asked).toEqual(["1/2", "2/2"]);
    a.done();
  });

  it("a no at any round cancels, and the later rounds are never shown", async () => {
    const a = answerWith([true, false]);
    expect(await useArch.getState().askSure("Play All", ["x"])).toBe(false);
    expect(a.asked).toEqual(["1/2", "2/2"]);
    a.done();
    const b = answerWith([false]);
    expect(await useArch.getState().askSure("Play All", ["x"])).toBe(false);
    expect(b.asked).toEqual(["1/2"]);
    b.done();
  });

  it("a dialog the caller already showed counts as one", async () => {
    const a = answerWith([true]);
    expect(await useArch.getState().askSure("Eliminate vlc", ["sudo pacman -Rns vlc"], 1)).toBe(true);
    expect(a.asked).toEqual(["1/1"]);
    a.done();
  });

  it("follows the Settings count, including zero", async () => {
    useArch.setState({ savedConfirmCount: 0 });
    const a = answerWith([]);
    expect(await useArch.getState().askSure("x", ["y"])).toBe(true);
    expect(a.asked).toEqual([]);
    a.done();
    useArch.setState({ savedConfirmCount: 3 });
    const b = answerWith([true, true, true]);
    expect(await useArch.getState().askSure("x", ["y"])).toBe(true);
    expect(b.asked).toEqual(["1/3", "2/3", "3/3"]);
    b.done();
  });
});

describe("a lowered count only counts once applied", () => {
  it("a pending 0 still asks the saved number of times", async () => {
    useArch.setState({ savedConfirmCount: 2, pendingConfirm: null });
    useArch.getState().setConfirmCount(0); // staged, not applied
    expect(useArch.getState().confirmCount).toBe(0); // what Settings shows
    const a = answerWith([true, true]);
    expect(await useArch.getState().askSure("x", ["y"])).toBe(true);
    expect(a.asked).toEqual(["1/2", "2/2"]);
    a.done();
    useArch.getState().discard();
  });
});

describe("the learned core comes first", () => {
  it("a package the machine says is core is refused with the machine's own reason", () => {
    // a name only the learned core knows (no fallback rule matches it)
    expect(protectedReason("acme-greeter")).toBeNull();
    setCoreSystem([{ package: "acme-greeter", reason: "your login screen" }]);
    expect(protectedReason("acme-greeter")).toBe("your login screen");
    expect(protectedReason("vlc")).toBeNull();
    // and the learned reason wins over the fallback's generic one
    setCoreSystem([{ package: "sddm", reason: "your login screen" }]);
    expect(protectedReason("sddm")).toBe("your login screen");
    setCoreSystem([]);
    expect(protectedReason("acme-greeter")).toBeNull();
  });
});
