// The tracking rules: tracked = keep; links make removal a domino, one choice per app.
import { describe, expect, it } from "vitest";
import { EMPTY, domino, goingWith, link, removalGate, track, unlink, untrack } from "@/lib/tracking";

// obs uses v4l2loopback (tracked); v4l2loopback uses dkms; steam also uses dkms
const T = [
  (t: typeof EMPTY) => track(t, "v4l2loopback"),
  (t: typeof EMPTY) => link(t, "obs", "v4l2loopback"),
  (t: typeof EMPTY) => link(t, "v4l2loopback", "dkms"),
  (t: typeof EMPTY) => link(t, "steam", "dkms"),
].reduce((t, f) => f(t), EMPTY);

describe("tracked = keep", () => {
  it("a tracked app used by another can only go through that app", () => {
    expect(removalGate(T, "v4l2loopback")).toEqual({ allowed: false, reason: "tracked-used", via: ["obs"] });
  });

  it("a tracked app nothing uses must be untracked first", () => {
    const t = track(EMPTY, "gimp");
    expect(removalGate(t, "gimp")).toEqual({ allowed: false, reason: "tracked-alone" });
    expect(removalGate(untrack(t, "gimp"), "gimp")).toEqual({ allowed: true });
  });

  it("untracked apps are removable on their own", () => {
    expect(removalGate(T, "obs")).toEqual({ allowed: true });
  });
});

describe("links", () => {
  it("refuses self-links and loops, and ignores duplicates", () => {
    expect(() => link(T, "obs", "obs")).toThrow();
    expect(() => link(T, "dkms", "obs")).toThrow(/loop/);
    expect(link(T, "obs", "v4l2loopback")).toBe(T);
    expect(unlink(T, "steam", "dkms").links).toHaveLength(2);
  });
});

describe("domino", () => {
  it("asks only about what the removed app uses — keeping one keeps everything below it", () => {
    const keep = domino(T, "obs", new Set());
    expect(keep.map((d) => d.app)).toEqual(["v4l2loopback"]);
    expect(keep[0].tracked).toBe(true);
    expect(goingWith(T, "obs", new Set())).toEqual([]);
  });

  it("choosing to remove one opens the next level, and warns who would break", () => {
    const d = domino(T, "obs", new Set(["v4l2loopback"]));
    expect(d.map((x) => x.app)).toEqual(["v4l2loopback", "dkms"]);
    expect(d[1]).toMatchObject({ app: "dkms", usedBy: ["v4l2loopback"], stillUsedBy: ["steam"] });
    expect(goingWith(T, "obs", new Set(["v4l2loopback", "dkms"]))).toEqual(["v4l2loopback", "dkms"]);
  });

  it("a choice under a kept app does not count", () => {
    // dkms chosen, but v4l2loopback (above it) is kept → dkms is not reached
    expect(goingWith(T, "obs", new Set(["dkms"]))).toEqual([]);
  });
});
