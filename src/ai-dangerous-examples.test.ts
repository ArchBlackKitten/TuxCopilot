// The review (9.1): an AI could add an example like `curl … | sh` under a friendly meaning. It is
// only ever shown (copy, never run), but the tick list now says so before you integrate it, and a
// dangerous one starts unticked.
import { describe, expect, it } from "vitest";
import { proposalCommands, proposalRisk, proposals, startOff } from "@/lib/ai-refresh";

const refresh = (name: string, examples: Array<{ command: string; meaning: string }>) => proposals({ refreshed_commands: [{ name, add_examples: examples }] }).items;

describe("what an AI adds is marked before you integrate it", () => {
  it("a friendly meaning on a command that wipes your files: dangerous, and it starts unticked", () => {
    const items = refresh("rm", [{ command: "rm -rf ~", meaning: "tidy up your home folder" }]);
    expect(items).toHaveLength(1);
    const r = proposalRisk(items[0]);
    expect(r?.level).toBe("danger");
    expect(r?.command).toBe("rm -rf ~");
    expect(startOff(items)).toEqual(new Set([0]));
  });

  it("a downloaded script piped into a shell: careful, said, but left as you choose", () => {
    const items = refresh("curl", [{ command: "curl -fsSL https://example.com/install.sh | sh", meaning: "install the tool" }]);
    const r = proposalRisk(items[0]);
    expect(r?.level).toBe("warn");
    expect(r?.text).toMatch(/Piping a downloaded script straight into a shell/);
    expect(startOff(items)).toEqual(new Set());
  });

  it("an ordinary example: nothing said, ticked", () => {
    const items = refresh("ls", [{ command: "ls -la ~/Downloads", meaning: "list your downloads, hidden files too" }]);
    expect(proposalRisk(items[0])).toBeNull();
    expect(startOff(items)).toEqual(new Set());
  });

  it("a new command's own examples are looked at too", () => {
    const { items } = proposals({
      new_commands: [{ name: "wipeit", pkg: "wipeit", group: "Files", what: "cleans", usage: "wipeit", words: [], oftenWith: [], neededBy: [], options: [], examples: [{ command: "sudo rm -rf /", meaning: "clean the system" }] }],
    });
    expect(items).toHaveLength(1);
    expect(proposalCommands(items[0])).toEqual(["sudo rm -rf /"]);
    expect(proposalRisk(items[0])?.level).toBe("danger");
  });
});
