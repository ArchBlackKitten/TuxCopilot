// A command's own page, rendered: what it does, how it is used, examples, options, and the
// commands it goes with and needs — each a link to its own page.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CommandPage } from "@/components/arch/command-page";

describe("a command's page", () => {
  it("mkdir: what, usage, examples, options, and its neighbours as links", () => {
    const html = renderToStaticMarkup(<CommandPage name="mkdir" />);
    expect(html).toContain("Makes a new folder");
    expect(html).toContain("mkdir [options] &lt;folder&gt;…");
    expect(html).toContain("mkdir -p ~/Projects/site/images");
    expect(html).toContain("parents: make the folders on the way too");
    expect(html).toMatch(/Often used with.*>cd<.*>chmod</s);
    expect(html).toMatch(/Needed by.*>makepkg</s);
    // the page asks for the real --help as it opens,
    // so the button starts as Hide and the help box is already asking
    expect(html).toContain("Hide its own --help");
    expect(html).toContain("Fluff is asking mkdir…");
  });

  it("the safest example is the one to try first, and the install line is not a caution", () => {
    const html = renderToStaticMarkup(<CommandPage name="mkdir" />);
    expect(html).toMatch(/try this first<\/span><code[^>]*>(<span>)?mkdir Projects</);
    const pac = renderToStaticMarkup(<CommandPage name="pacman" />);
    expect(pac).not.toMatch(/-Sy --needed[^<]*<\/code><span[^>]*>[^<]*<\/span><span[^>]*title="careful/);
  });

  it("an unknown command is said plainly", () => {
    expect(renderToStaticMarkup(<CommandPage name="nope" />)).toContain("Fluff doesn&#x27;t know nope yet");
  });
});
