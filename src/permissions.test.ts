// Item 11: permission numbers said in words — chmod 700 / 755 / 644, the letters (u+x, go-w),
// and mkdir's and install's -m — wherever the explainer meets them.
import { describe, expect, it } from "vitest";
import { explainCommand } from "@/lib/arch-explain";
import { permissionWords } from "@/lib/permissions";

const said = (cmd: string) => explainCommand(cmd).segments[0].tokens.filter((t) => t.meaning?.startsWith("permissions — ")).map((t) => [t.raw, t.meaning!.slice(14)]);
const FOLDER = " (run means open, for a folder)";

describe("permission numbers in words", () => {
  it("the everyday numbers", () => {
    expect(permissionWords("700")).toBe(`you: read, change and run · your group: nothing · everyone else: nothing${FOLDER}`);
    expect(permissionWords("755")).toBe(`you: read, change and run · your group: read and run · everyone else: read and run${FOLDER}`);
    expect(permissionWords("644")).toBe(`you: read and change · your group: read · everyone else: read${FOLDER}`);
    expect(permissionWords("600")).toBe(`you: read and change · your group: nothing · everyone else: nothing${FOLDER}`);
    expect(permissionWords("'640'")).toBe(`you: read and change · your group: read · everyone else: nothing${FOLDER}`);
    expect(permissionWords("321")).toBe(`you: change and run · your group: change · everyone else: run${FOLDER}`);
  });

  it("a fourth digit in front: the special cases, each said; 0 says nothing extra", () => {
    expect(permissionWords("0755")).toBe(permissionWords("755"));
    expect(permissionWords("4755")).toContain("· it runs with its owner's rights, whoever starts it (setuid)");
    expect(permissionWords("2775")).toContain("new files get the folder's group (setgid)");
    expect(permissionWords("1777")).toContain("only a file's owner can delete it, as in /tmp (sticky)");
    expect(permissionWords("6755")).toMatch(/setuid.*setgid/);
  });

  it("the letters", () => {
    expect(permissionWords("+x")).toBe("everyone can now run it");
    expect(permissionWords("u+x")).toBe("you can now run it");
    expect(permissionWords("go-w")).toBe("your group and everyone else can no longer change it");
    expect(permissionWords("a=r")).toBe("everyone: only read");
    expect(permissionWords("ugo+rw")).toBe("everyone can now read and change it");
    expect(permissionWords("u=rwx,go=")).toBe("you: only read, change and run · your group and everyone else: nothing");
    expect(permissionWords("o+")).toBe("everyone else: unchanged");
  });

  it("what isn't a mode stays unexplained", () => {
    for (const x of ["999", "75", "75555", "site", "u+q", "-R", "x+u", ""]) expect(permissionWords(x), x).toBeNull();
  });

  it("the explainer says it where a command sets permissions, and nowhere else", () => {
    expect(said("chmod -R 755 ~/public")).toEqual([["755", `you: read, change and run · your group: read and run · everyone else: read and run${FOLDER}`]]);
    expect(said("chmod -x run.sh")).toEqual([["-x", "everyone can no longer run it"]]);
    expect(said("chmod 600 644")).toHaveLength(1); // a file named 644 is a file
    expect(said("mkdir -m 700 secrets").map((x) => x[0])).toEqual(["700"]);
    expect(said("mkdir -pm 700 secrets").map((x) => x[0])).toEqual(["700"]);
    expect(said("mkdir --mode=700 secrets").map((x) => x[0])).toEqual(["--mode=700"]);
    expect(said("install -Dm644 tux.desktop /usr/share/applications/").map((x) => x[0])).toEqual(["-Dm644"]);
    expect(said("mkdir -p 755")).toEqual([]); // a folder named 755
    expect(said("rm -x")).toEqual([]);
    expect(said("ls 755")).toEqual([]);
  });
});
