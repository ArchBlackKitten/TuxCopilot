// Settings → Is this the real TuxCopilot?: what this copy can say about itself (a signed
// release, the creator's code between releases, changed here, a fork), its source to read, and
// — said plainly — the checks from outside it, since a changed copy could change this check too.
import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, CircleAlert, CircleCheck, CircleX, Copy, ExternalLink, Info, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { errText, openExternal } from "@/lib/host";
import { findings, originalCheck, outsideChecks, sourceUrl, spacedKey, type OriginalFacts } from "@/lib/original";
import { CommandText } from "./command-text";
import { FluffSays } from "./fluff-says";

const ICON = { ok: CircleCheck, info: Info, warn: CircleAlert, bad: CircleX } as const;
const TONE = { ok: "text-ok", info: "text-info", warn: "text-warn", bad: "text-bad" } as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-0.5 text-[11px]">
      <span className="w-32 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-all">{children}</span>
    </div>
  );
}

export function OriginalPanel() {
  const { toast } = useToast();
  const [f, setF] = useState<OriginalFacts | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const load = useCallback(async () => {
    setBusy(true);
    setFailed(null);
    try {
      setF(await originalCheck());
    } catch (e) {
      setFailed(errText(e));
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
    toast({ title: "Fluff copied it", description: text.length > 80 ? `${text.slice(0, 80)}…` : text });
  };
  const list = f ? findings(f) : [];

  return (
    <section className="space-y-2 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2">
        <BadgeCheck className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Is this the real TuxCopilot?</h2>
        <span className="text-[11px] text-muted-foreground">where this copy comes from, and whether it was changed</span>
        <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1 px-2 text-[11px]" onClick={() => void load()} disabled={busy}>
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} /> Check again
        </Button>
      </div>
      {failed && <p className="rounded-md border border-bad/40 bg-bad/5 p-2 text-[11px]">Fluff couldn't check: {failed}</p>}
      {busy && !f ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        f && (
          <>
            <div className="divide-y divide-border/60 overflow-hidden rounded-md border">
              {list.map((x) => {
                const Icon = ICON[x.level];
                return (
                  <div key={x.id} className="flex items-start gap-2 px-3 py-2">
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${TONE[x.level]}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium">{x.title}</div>
                      <p className="text-[11px] text-muted-foreground">
                        <CommandText text={x.detail} />
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            {f.changedFiles.length > 0 && (
              <details className="text-[11px]">
                <summary className="cursor-pointer text-muted-foreground">The changed files ({f.changedFiles.length})</summary>
                <ul className="ml-4 mt-1 list-disc font-mono text-[10px]">
                  {f.changedFiles.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </details>
            )}

            <div className="rounded-md border bg-background p-2">
              <Row label="Version">
                {f.version}
                {f.releaseTag ? ` (release ${f.releaseTag})` : ""}
              </Row>
              <Row label="Built from">
                {f.builtFrom === "release" ? "a release" : f.builtFrom === "git" ? `a git folder${f.folder ? `: ${f.folder}` : " (no longer here)"}` : "unknown"}
              </Row>
              {f.commit && <Row label="Commit">{f.commit}</Row>}
              {f.origin && <Row label="Downloaded from">{f.origin}</Row>}
              <Row label="The creator's key">
                <span className="font-mono">{spacedKey(f.releaseKey)}</span>
              </Row>
              <Row label="This program">
                <span className="font-mono">{f.exe}</span>
              </Row>
              {f.exeSha256 && (
                <Row label="Its SHA-256">
                  <span className="font-mono">{f.exeSha256}</span>{" "}
                  <button className="text-muted-foreground underline hover:text-foreground" onClick={() => copy(f.exeSha256!)}>
                    copy
                  </button>
                </Row>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]" onClick={() => void openExternal(sourceUrl(f))}>
                <ExternalLink className="h-3 w-3" /> {f.isCreators === false ? "Open the fork's source" : "Open the source"}
              </Button>
              {f.isCreators === false && (
                <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]" onClick={() => void openExternal(`https://${f.creatorRepo}`)}>
                  <ExternalLink className="h-3 w-3" /> Open the creator's
                </Button>
              )}
            </div>

            <FluffSays title="Fluff says, honestly">
              A changed TuxCopilot could change this check too, so it can't fully vouch for itself. These checks work from outside it — the creator's key
              is the one shown above:
              <div className="mt-1 space-y-1">
                {outsideChecks(f).map((c) => (
                  <div key={c.command}>
                    <div className="text-muted-foreground">{c.what}</div>
                    <div className="flex items-start gap-1.5">
                      <code className="min-w-0 flex-1 break-all rounded bg-code px-1.5 py-0.5 font-mono text-[10px] text-term-foreground">
                        <CommandText text={c.command} line />
                      </code>
                      <button className="shrink-0 text-muted-foreground hover:text-foreground" title="Copy" onClick={() => copy(c.command)}>
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </FluffSays>
          </>
        )
      )}
    </section>
  );
}
