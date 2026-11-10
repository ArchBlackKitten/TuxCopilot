// The Feedback section: Fluff is fresh out of the egg and may get things wrong — tell its
// creator. You tick which sections it is about and fill the form; what it makes is shown in full
// (and editable), and saved as a document you upload to GitHub. TuxCopilot sends nothing itself:
// your browser opens GitHub's page, and it is sent only when you press Submit there.
import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, FileDown, MessageSquareHeart, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getRun, listRuns, type RunLogRow } from "@/lib/api";
import { runCheckup } from "@/lib/checkup";
import { firewallState } from "@/lib/firewall";
import { reportNames } from "@/lib/report";
import type { Logs } from "@/lib/feedback";
import { makeReport } from "./report-panel";
import { errText, openExternal } from "@/lib/host";
import { documentName, feedbackContext, ISSUES, issueBody, issueDocument, issueLink, KINDS, OTHER_PLACES, scrub, type FeedbackContext, type Kind } from "@/lib/feedback";
import { saveFile } from "@/lib/integrity";
import { originalCheck, type OriginalFacts } from "@/lib/original";
import { FluffSays } from "./fluff-says";
import { useArch } from "./store";

function Tick({ on, set, label, note, disabled }: { on: boolean; set: (v: boolean) => void; label: string; note: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-2 text-xs ${disabled ? "opacity-50" : ""}`}>
      <input type="checkbox" checked={on && !disabled} disabled={disabled} onChange={(e) => set(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-primary" />
      <span>
        {label} <span className="text-[10px] text-muted-foreground">— {note}</span>
      </span>
    </label>
  );
}

/** The logs to add: TuxCopilot's last 20 runs, the end of what the last 3 failed ones printed, the
 *  journal's errors since this start, and the helper's report — with what to take out of them. */
async function readLogs(): Promise<Logs> {
  const [names, runs, checkup, fw, report] = await Promise.all([
    reportNames(),
    listRuns(),
    runCheckup().catch(() => null),
    firewallState().catch(() => null),
    makeReport().catch(() => null),
  ]);
  const last = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
  const failedRuns = last.filter((r) => r.status === "failed" && !r.dryRun).slice(0, 3);
  const failed = (await Promise.all(failedRuns.map((r) => getRun(r.id).catch(() => null)))).flatMap((r) => (r ? [{ label: r.label, output: r.output ?? "" }] : []));
  return {
    runs: last.map(({ label, status, dryRun, createdAt }) => ({ label, status, dryRun, createdAt })),
    failed,
    errors: checkup?.errors ?? [],
    report,
    names,
    networks: fw?.networks.map((n) => n.name) ?? [],
  };
}

/** `sections`: the side menu's sections, to tick which ones it is about. */
export function FeedbackView({ sections }: { sections: string[] }) {
  const { toast } = useToast();
  const { profile } = useArch();
  const [kind, setKind] = useState<Kind>("bug");
  const places = [...sections, ...OTHER_PLACES];
  const [where, setWhere] = useState<Set<string>>(new Set());
  const tickWhere = (w: string, on: boolean) => (setWhere((s) => { const n = new Set(s); if (on) n.add(w); else n.delete(w); return n; }), setEdited(null));
  const [title, setTitle] = useState("");
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [addCopy, setAddCopy] = useState(true);
  const [addMachine, setAddMachine] = useState(true);
  const [addFailed, setAddFailed] = useState(false);
  const [copyFacts, setCopyFacts] = useState<OriginalFacts | null>(null);
  const [ctx, setCtx] = useState<FeedbackContext>({ kernel: "", home: "", user: "" });
  const [failed, setFailed] = useState<RunLogRow | null>(null);
  const [edited, setEdited] = useState<string | null>(null); // the issue text, once you change it by hand
  const [addLogs, setAddLogs] = useState(false);
  const [logs, setLogs] = useState<Logs | null | "reading">(null);
  // read only when ticked; without the names to take out, no logs are added at all
  useEffect(() => {
    if (!addLogs || logs) return;
    setLogs("reading");
    readLogs().then(setLogs, (e) => {
      setAddLogs(false);
      setLogs(null);
      toast({ title: "Fluff couldn't gather the logs", description: errText(e), variant: "destructive" });
    });
  }, [addLogs, logs, toast]);

  useEffect(() => {
    originalCheck().then(setCopyFacts, () => setCopyFacts(null));
    feedbackContext().then(setCtx, () => undefined);
    listRuns().then((rs) => setFailed([...rs].filter((r) => r.status === "failed" && !r.dryRun).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null), () => setFailed(null));
  }, []);

  const k = KINDS.find((x) => x.id === kind)!;
  const made = useMemo(
    () =>
      scrub(
        issueBody({
          kind,
          title,
          where: places.filter((w) => where.has(w)), // in the menu's order
          first,
          second,
          copy: addCopy ? copyFacts : null,
          machine: addMachine && profile ? { os: profile.osName, desktop: profile.desktop, sessionType: profile.sessionType } : null,
          kernel: addMachine ? ctx.kernel || null : null,
          failed: addFailed ? failed : null,
          logs: addLogs && logs && logs !== "reading" ? logs : null,
        }),
        ctx,
      ),
    [kind, title, where, first, second, addCopy, copyFacts, addMachine, profile, ctx, addFailed, failed, addLogs, logs], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const body = edited ?? made;
  const ready = title.trim().length > 0 && (first.trim().length > 0 || edited !== null);

  const open = async () => {
    const { url, viaClipboard } = issueLink(kind, scrub(title, ctx), body);
    try {
      if (viaClipboard) await navigator.clipboard.writeText(body);
      await openExternal(url);
      toast({
        title: "GitHub's page is opening in your browser",
        description: viaClipboard
          ? "It's too long for a link, so the text is on your clipboard: paste it into the page. It is sent only when you press Submit there."
          : "It's filled in. Read it once more; it is sent only when you press Submit there (you need a GitHub account).",
      });
    } catch (e) {
      toast({ title: "Fluff couldn't open the page", description: errText(e), variant: "destructive" });
    }
  };
  const saveDoc = async () => {
    try {
      const saved = await saveFile(documentName(title), issueDocument(scrub(title, ctx), body));
      if (!saved) return; // cancelled
      toast({
        title: "Fluff saved your document",
        description: `${scrub(saved.path, ctx)} — now press "Open GitHub's page", give it a title, and drag the file into the box (or click "Paste, drop, or click to add files"). It is sent only when you press Submit there.`,
      });
    } catch (e) {
      toast({ title: "Fluff couldn't save it", description: errText(e), variant: "destructive" });
    }
  };
  const openBlank = async () => {
    try {
      await openExternal(`${ISSUES}?${new URLSearchParams({ title: scrub(title, ctx).trim() }).toString()}`);
    } catch (e) {
      toast({ title: "Fluff couldn't open the page", description: errText(e), variant: "destructive" });
    }
  };
  const copy = () => {
    void navigator.clipboard.writeText(`${scrub(title, ctx)}\n\n${body}`);
    toast({ title: "Fluff copied it", description: "The title and the text, to send however you like." });
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquareHeart className="h-5 w-5 text-primary" />
        <h2 className="text-sm font-semibold">Feedback</h2>
        <span className="text-[11px] text-muted-foreground">tell Fluff's creator what went wrong, or what you'd like</span>
      </div>
      <FluffSays title="Fluff is new at this">
        Fluff hatched not long ago: this is its first time around, so it may have bugs and get things wrong. When it does, tell its creator — that's how
        Fluff learns. Tick where it happened and fill in the form: Fluff makes a document of it, which you upload to GitHub yourself. Nothing is sent by
        TuxCopilot; it is sent only when you press Submit on GitHub's page.
      </FluffSays>
      {copyFacts?.isCreators === false && (
        <p className="rounded-md border border-warn/40 bg-warn/5 p-2 text-[11px]">
          This copy is a fork ({copyFacts.origin}). If the problem is in what the fork changed, its own page is the place to tell.
        </p>
      )}

      <section className="space-y-3 rounded-lg border bg-card p-4">
        <div className="grid gap-1.5 sm:grid-cols-4">
          {KINDS.map((x) => (
            <button key={x.id} onClick={() => setKind(x.id)} className={`rounded-md border px-2.5 py-1.5 text-left ${kind === x.id ? "border-primary/60 bg-primary/10" : "hover:bg-accent/40"}`}>
              <div className="text-xs font-medium">{x.label}</div>
              <div className="text-[10px] text-muted-foreground">{x.note}</div>
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          <div className="text-xs font-medium">
            Where in TuxCopilot? <span className="text-[10px] font-normal text-muted-foreground">— tick every section it is about</span>
          </div>
          <div className="grid gap-x-3 gap-y-1 sm:grid-cols-3">
            {places.map((w) => (
              <label key={w} className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={where.has(w)} onChange={(e) => tickWhere(w, e.target.checked)} className="h-3.5 w-3.5 accent-primary" aria-label={w} />
                {w}
              </label>
            ))}
          </div>
        </div>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="In a few words (the issue's title)" className="h-8 text-xs" aria-label="title" />
        <label className="block space-y-1 text-xs">
          <span className="font-medium">{k.label1}</span>
          <Textarea value={first} onChange={(e) => (setFirst(e.target.value), setEdited(null))} className="min-h-[80px] text-xs" />
        </label>
        <label className="block space-y-1 text-xs">
          <span className="font-medium">{k.label2}</span>
          <Textarea value={second} onChange={(e) => (setSecond(e.target.value), setEdited(null))} className="min-h-[60px] text-xs" />
        </label>
        <div className="space-y-1.5">
          <div className="text-xs font-medium">Add, if you like</div>
          <Tick on={addCopy} set={(v) => (setAddCopy(v), setEdited(null))} label="About this TuxCopilot" note="its version and where it was built from" />
          <Tick on={addMachine} set={(v) => (setAddMachine(v), setEdited(null))} label="About this computer" note="the OS, the desktop, Wayland or X11, the kernel" />
          <Tick
            on={addFailed}
            set={(v) => (setAddFailed(v), setEdited(null))}
            disabled={!failed}
            label="The last thing that failed"
            note={failed ? `${failed.label}: its commands and the end of what it printed` : "nothing has failed"}
          />
          <Tick
            on={addLogs}
            set={(v) => (setAddLogs(v), setEdited(null))}
            label={logs === "reading" ? "Anonymized logs, for review later (Fluff is gathering them…)" : "Anonymized logs, for review later"}
            note="TuxCopilot's last runs, what the failed ones printed, the system's errors since this start, and the helper's report — with your names, addresses, networks and your own files' names taken out. Read them below before you send."
          />
          <p className="text-[10px] text-muted-foreground">Your home folder is written as ~ and your user name as &lt;you&gt;, everywhere in the message.</p>
        </div>
      </section>

      <section className="space-y-2 rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">What will be sent — exactly this</span>
          {edited !== null && (
            <Button size="sm" variant="ghost" className="ml-auto h-6 gap-1 px-2 text-[10px]" onClick={() => setEdited(null)}>
              <Undo2 className="h-3 w-3" /> Back to what the form makes
            </Button>
          )}
        </div>
        <div className="rounded-md border bg-background px-2 py-1 text-xs font-medium">{scrub(title, ctx) || <span className="text-muted-foreground">(the title)</span>}</div>
        <Textarea value={body} onChange={(e) => setEdited(e.target.value)} className="min-h-[200px] bg-code font-mono text-[11px] text-term-foreground" spellCheck={false} aria-label="the message" />
        <p className="text-[10px] text-muted-foreground">You can change it here too. It is public on GitHub once you press Submit there.</p>
        <ol className="ml-4 list-decimal space-y-0.5 text-[11px] text-muted-foreground">
          <li>
            <span className="text-foreground">Save it as a document</span> — a file on this computer, exactly what is shown above.
          </li>
          <li>
            <span className="text-foreground">Open GitHub's page</span>, then drag the file into the box (or click "Paste, drop, or click to add files"). You need a GitHub account.
          </li>
          <li>Read it once more and press Submit there. Nothing is sent before that.</li>
        </ol>
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={copy} disabled={!ready} title="The title and the text, to paste anywhere">
            <Copy className="h-3 w-3" /> Copy it
          </Button>
          <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={() => void open()} disabled={!ready} title="GitHub's page with the text already filled in, instead of a document">
            <ExternalLink className="h-3 w-3" /> Or fill it in on GitHub
          </Button>
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void saveDoc()} disabled={!ready}>
            <FileDown className="h-3 w-3" /> 1. Save it as a document
          </Button>
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void openBlank()} disabled={!title.trim()}>
            <ExternalLink className="h-3 w-3" /> 2. Open GitHub's page
          </Button>
        </div>
      </section>
    </div>
  );
}
