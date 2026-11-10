// Text with every command it mentions as a link to that command's page (src/lib/command-links.ts).
// `line`: the text is a command line; otherwise a sentence.
import { lineLinks, textLinks } from "@/lib/command-links";
import { useArch } from "./store";

export function CommandText({ text, line = false, skip }: { text: string; line?: boolean; skip?: string }) {
  const openCommand = useArch((s) => s.openCommand);
  return (
    <>
      {(line ? lineLinks(text, skip) : textLinks(text, skip)).map((p, i) =>
        p.command ? (
          <span
            key={i}
            role="link"
            tabIndex={0}
            title={`${p.command}: its page`}
            onClick={(e) => {
              e.stopPropagation();
              openCommand(p.command!);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                openCommand(p.command!);
              }
            }}
            className={`cursor-pointer underline decoration-dotted underline-offset-2 hover:text-primary ${p.code && !line ? "font-mono" : ""}`}
          >
            {p.text}
          </span>
        ) : p.code && !line ? (
          <code key={i} className="font-mono">
            {p.text}
          </code>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
