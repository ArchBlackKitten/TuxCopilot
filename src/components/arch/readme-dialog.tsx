// GitHub "instruction look up": shows the repository's official README with
// its install instructions. Every code block gets Copy + "Save as command"
// (saved into a "Saved from READMEs" section so Play can run it later).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useArch } from "./store";
import { sameNode } from "@/lib/changes";
import { errText, openExternal } from "@/lib/host";
import { githubReadme } from "@/lib/lookups";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, Save, Star, BookOpen, TriangleAlert, ExternalLink, Image as ImageIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { useToast } from "@/hooks/use-toast";

interface ReadmeData {
  found: boolean;
  markdown: string;
  meta: {
    fullName: string;
    description: string | null;
    htmlUrl: string;
    stars: number;
    defaultBranch: string;
    homepage: string | null;
  } | null;
  error?: string;
}

interface Props {
  open: boolean;
  repo: string | null; // e.g. "user/repo" or a pasted URL
  onClose: () => void;
}

// crude but effective: flag install-related code blocks in the README
const INSTALL_HINT = /(pacman|-S\s|yay|aur|makepkg|git clone|cmake|cargo install|go install|npm i|pnpm|pip install|install|meson)/i;

export function ReadmeDialog({ open, repo, onClose }: Props) {
  const { toast } = useToast();
  const [data, setData] = useState<ReadmeData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !repo) return;
    setLoading(true);
    setData(null);
    githubReadme(repo)
      .then((d) => setData(d as ReadmeData))
      .catch(() => setData({ found: false, markdown: "", meta: null, error: "Network error" }))
      .finally(() => setLoading(false));
  }, [open, repo]);

  const saveAsCommand = useCallback(
    async (code: string, hint: string) => {
      try {
        // find or create the "Saved from READMEs" root section
        const st = useArch.getState();
        const parentId = st.ensureSection("Saved from READMEs");
        const fields = { name: `${repo} — ${hint}`.slice(0, 80), category: "command" as const, source: null, content: code.trim(), parentId };
        const already = sameNode(st.tree, fields);
        st.nodeCreate(fields);
        if (already) toast({ title: "Fluff already has it", description: `Saved from READMEs › ${hint} (${repo}) is already there.` });
        else toast({ title: "Saved to Commands — pending", description: `Saved from READMEs › ${hint} (${repo}) · Apply to keep it` });
      } catch (err) {
        toast({
          title: "Fluff couldn't save the command",
          description: errText(err, "Fluff doesn't know why"),
          variant: "destructive",
        });
      }
    },
    [repo, toast]
  );

  const markdownComponents = useMemo(
    () => ({
      pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
      code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
        const raw = String(children ?? "").replace(/\n$/, "");
        const isBlock = Boolean(className);
        if (!isBlock) {
          return (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">{raw}</code>
          );
        }
        const installish = INSTALL_HINT.test(raw);
        return (
          <div className="my-2 overflow-hidden rounded-md border border-border/70 bg-code">
            <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-2.5 py-1">
              {installish && (
                <Badge variant="outline" className="border-emerald-400/40 px-1.5 py-0 text-[9px] text-emerald-400">
                  likely install step
                </Badge>
              )}
              <span className="ml-auto flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 gap-1 px-2 text-[10px]"
                  onClick={() => {
                    navigator.clipboard.writeText(raw);
                    toast({ title: "Fluff copied it", description: raw.slice(0, 60) });
                  }}
                >
                  <Copy className="h-3 w-3" /> copy
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 gap-1 px-2 text-[10px] text-primary hover:text-primary"
                  onClick={() => saveAsCommand(raw, installish ? "install" : "snippet")}
                >
                  <Save className="h-3 w-3" /> save as command
                </Button>
              </span>
            </div>
            <pre className="max-h-64 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-emerald-200/90">
              {raw}
            </pre>
          </div>
        );
      },
      // pictures are not loaded from the internet by themselves (a README can point anywhere,
      // and loading tells that server you looked): a chip opens one in your browser on a click
      img: ({ src, alt }: { src?: string; alt?: string }) => (
        <button
          type="button"
          className="my-1 inline-flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-primary"
          title={src ? `open ${src} in your browser` : undefined}
          onClick={() => src && /^https:\/\//i.test(src) && void openExternal(src)}
        >
          <ImageIcon className="h-3 w-3" /> picture{alt ? `: ${alt}` : ""}
        </button>
      ),
      a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
        <a
          href={href}
          className="text-primary underline underline-offset-2"
          onClick={(e) => {
            e.preventDefault(); // never inside TuxCopilot's own window
            if (href && /^https?:\/\//i.test(href)) void openExternal(href);
          }}
        >
          {children}
        </a>
      ),
      h1: ({ children }: { children?: React.ReactNode }) => <h1 className="mb-2 mt-4 text-base font-bold">{children}</h1>,
      h2: ({ children }: { children?: React.ReactNode }) => <h2 className="mb-2 mt-4 text-sm font-bold">{children}</h2>,
      h3: ({ children }: { children?: React.ReactNode }) => <h3 className="mb-1.5 mt-3 text-sm font-semibold">{children}</h3>,
      p: ({ children }: { children?: React.ReactNode }) => <p className="my-2 text-xs leading-relaxed text-foreground/85">{children}</p>,
      ul: ({ children }: { children?: React.ReactNode }) => <ul className="my-2 list-disc space-y-1 pl-5 text-xs text-foreground/85">{children}</ul>,
      ol: ({ children }: { children?: React.ReactNode }) => <ol className="my-2 list-decimal space-y-1 pl-5 text-xs text-foreground/85">{children}</ol>,
      li: ({ children }: { children?: React.ReactNode }) => <li className="leading-relaxed">{children}</li>,
      table: ({ children }: { children?: React.ReactNode }) => (
        <div className="my-2 overflow-x-auto rounded border border-border/60">
          <table className="w-full text-[11px]">{children}</table>
        </div>
      ),
      th: ({ children }: { children?: React.ReactNode }) => <th className="border-b border-border/60 bg-muted/40 px-2 py-1 text-left font-medium">{children}</th>,
      td: ({ children }: { children?: React.ReactNode }) => <td className="border-b border-border/40 px-2 py-1 align-top">{children}</td>,
      blockquote: ({ children }: { children?: React.ReactNode }) => (
        <blockquote className="my-2 border-l-2 border-primary/50 pl-3 text-xs italic text-muted-foreground">{children}</blockquote>
      ),
    }),
    [saveAsCommand, toast]
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <BookOpen className="h-4 w-4 text-primary" />
            Instruction look up{repo ? ` — ${repo}` : ""}
          </DialogTitle>
          <DialogDescription className="text-xs">
            The official README, fetched from GitHub. Install-relevant blocks are flagged — but read critically:
            readmes are often outdated or incomplete. Saved commands live in Commands › Saved from READMEs.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {loading && (
            <div className="space-y-3 py-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          )}
          {!loading && data && !data.found && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <TriangleAlert className="h-6 w-6 text-amber-400" />
              <p className="text-xs text-muted-foreground">{data.error ?? "README not available."}</p>
            </div>
          )}
          {!loading && data?.found && (
            <div className="space-y-1">
              {data.meta && (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-muted/30 p-2.5">
                  <a
                    href={data.meta.htmlUrl}
                    onClick={(e) => {
                      e.preventDefault();
                      void openExternal(data.meta!.htmlUrl);
                    }}
                    className="flex items-center gap-1 font-mono text-xs font-semibold text-primary hover:underline"
                  >
                    {data.meta.fullName} <ExternalLink className="h-3 w-3" />
                  </a>
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <Star className="h-2.5 w-2.5" /> {data.meta.stars !== null ? data.meta.stars.toLocaleString() : "—"}
                  </Badge>
                  {data.meta.defaultBranch !== "HEAD" && (
                    <Badge variant="outline" className="text-[10px]">
                      branch: {data.meta.defaultBranch}
                    </Badge>
                  )}
                  {data.meta.homepage && (
                    <a
                      href={data.meta.homepage}
                      onClick={(e) => {
                        e.preventDefault();
                        if (/^https?:\/\//i.test(data.meta!.homepage!)) void openExternal(data.meta!.homepage!);
                      }}
                      className="text-[10px] text-primary hover:underline">
                      homepage ↗
                    </a>
                  )}
                  {data.meta.description && (
                    <p className="w-full text-[11px] text-muted-foreground">{data.meta.description}</p>
                  )}
                </div>
              )}
              {data.markdown ? (
                <ReactMarkdown
                  rehypePlugins={[
                    rehypeRaw,
                    [
                      rehypeSanitize,
                      {
                        ...defaultSchema,
                        tagNames: (defaultSchema.tagNames ?? []).concat("details", "summary", "img"),
                        attributes: {
                          ...(defaultSchema.attributes ?? {}),
                          img: (defaultSchema.attributes?.img ?? []).concat("src", "alt", "width", "height", "align"),
                          a: (defaultSchema.attributes?.a ?? []).concat("target", "rel"),
                        },
                      },
                    ],
                  ]}
                  components={markdownComponents}
                >
                  {data.markdown}
                </ReactMarkdown>
              ) : (
                <p className="py-6 text-center text-xs text-muted-foreground">This repository has no README.</p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
