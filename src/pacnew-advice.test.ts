// What Fluff recommends for each waiting settings file (eleven samples). The words, and the button marked "Fluff recommends".
import { describe, expect, it } from "vitest";
import { waitingAdvice, waitingPick, type Waiting } from "@/lib/checkup";

const w = (file: string, kind: "pacnew" | "pacsave" = "pacnew"): Waiting => ({ path: `${file}.${kind}`, file, kind, owner: "pkg", fileExists: true });

describe("a recommendation for each waiting file", () => {
  it("eleven samples", () => {
    const picks = Object.fromEntries(
      [
        "/etc/bluetooth/main.conf",
        "/etc/pacman.d/cachyos-mirrorlist",
        "/etc/pacman.d/cachyos-v3-mirrorlist",
        "/etc/pacman.d/cachyos-v4-mirrorlist",
        "/etc/resolv.conf",
        "/etc/locale.gen",
        "/etc/limine-snapper-sync.conf",
        "/etc/pacman.conf",
        "/etc/pacman.d/mirrorlist",
        "/etc/tpm2-tss/fapi-profiles/P_ECCP384SHA384.json",
        "/etc/tpm2-tss/fapi-profiles/P_RSA3072SHA384.json",
      ].map((f) => [f, waitingPick(w(f))]),
    );
    expect(picks).toEqual({
      "/etc/bluetooth/main.conf": "keep",
      "/etc/pacman.d/cachyos-mirrorlist": "keep",
      "/etc/pacman.d/cachyos-v3-mirrorlist": "keep",
      "/etc/pacman.d/cachyos-v4-mirrorlist": "keep",
      "/etc/resolv.conf": "keep",
      "/etc/locale.gen": "keep",
      "/etc/limine-snapper-sync.conf": "new",
      "/etc/pacman.conf": "keep",
      "/etc/pacman.d/mirrorlist": "keep",
      "/etc/tpm2-tss/fapi-profiles/P_ECCP384SHA384.json": "new",
      "/etc/tpm2-tss/fapi-profiles/P_RSA3072SHA384.json": "new",
    });
  });

  it("the words say why", () => {
    expect(waitingAdvice(w("/etc/bluetooth/main.conf"))).toMatch(/AutoEnable=false keeps Bluetooth off/);
    expect(waitingAdvice(w("/etc/pacman.conf"))).toMatch(/add the new options by hand/);
    expect(waitingAdvice(w("/etc/pacman.d/mirrorlist"))).toMatch(/rate-mirrors/);
    expect(waitingAdvice(w("/etc/tpm2-tss/fapi-profiles/P_RSA3072SHA384.json"))).toMatch(/Nobody edits these by hand: use the new one/);
    expect(waitingAdvice(w("/etc/limine-snapper-sync.conf"))).toMatch(/use the new one/);
  });

  it("no mark when Fluff can't know (compare first), for unknown files, and for an old copy", () => {
    expect(waitingPick(w("/etc/mkinitcpio.conf"))).toBeNull();
    expect(waitingPick(w("/etc/some-tool/settings.conf"))).toBeNull();
    expect(waitingPick(w("/etc/pacman.conf", "pacsave"))).toBeNull();
    expect(waitingPick(w("/etc/tpm2-tss/fapi-profiles/../../shadow"))).not.toBe("new"); // only real profile names
  });
});
