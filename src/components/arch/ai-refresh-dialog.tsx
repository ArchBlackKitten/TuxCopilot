// "Ask AI to refresh" — the command knowledge, refreshed by an AI of your choice:
//   1. ask with: a model Ollama runs here, an AI's API, or an AI's page in a terminal browser;
//   2. Send prompt: the prompt goes in short parts (PART_LIMIT characters, cut only between
//      commands), each answered on its own, and every answer lands in the answer box — by
//      itself from Ollama or an API; from a chat page you copy each answer and press "Bring
//      the answer back", and Fluff copies the next part for you;
//   3. read it, edit it if you like — what it would add updates as you type;
//   4. Integrate (into pending changes; Apply makes it stick) or Deny.
// Only gaps and new options are offered, never a change to what is there. What you add is kept
// in your TuxCopilot, so it moves house with Fluff.

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, ClipboardCopy, ClipboardPaste, FilePlus, Info, Loader2, Plus, Send, Square, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { errText } from "@/lib/host";
import { joinAdditions, NO_ADDITIONS } from "@/lib/commands/catalog";
import { askApi, askOllama, browseInTerminal, clipboardText, isPrompt, PART_LIMIT, promptParts, proposals, readAnswers, terminalBrowser, type AskWith, type ChatMessage, type Proposal, proposalRisk, startOff } from "@/lib/ai-refresh";
import { useArch } from "./store";

const WAYS: Array<{ id: AskWith; label: string; note: string }> = [
  { id: "ollama", label: "Ollama", note: "a model on this computer — nothing leaves it" },
  { id: "api", label: "API", note: "an AI's API address and key (OpenAI, Mistral, OpenRouter, LM Studio…)" },
  { id: "browser", label: "Browser in terminal", note: "an AI's chat page (duck.ai unless you change it), in browsh or carbonyl" },
];
const BROWSH_INSTALL = "yay -Syu --needed browsh";

type Read = { items: Proposal[]; refused: string[]; answers: number; unreadable: number; error: null } | { items: []; refused: []; answers: 0; unreadable: 0; error: string };

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

export function AiRefreshDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const { stageChange, ollama, loadOllama, brain, profile, runQuick, dryRun } = useArch();
  const [way, setWay] = useState<AskWith>("ollama");
  const [model, setModel] = useState("");
  const [apiUrl, setApiUrl] = useState("https://");
  const [apiKey, setApiKey] = useState(""); // this window only: never saved
  const [apiModel, setApiModel] = useState("");
  const [pageUrl, setPageUrl] = useState("https://duck.ai/"); // a default for the terminal browser
  const [browser, setBrowser] = useState<string | null | undefined>(undefined); // undefined: still looking
  const [answer, setAnswer] = useState("");
  const [off, setOff] = useState<Set<number>>(new Set());
  // where the parts are: the next one to send (a chat page) or being asked (Ollama, an API)
  const [next, setNext] = useState<number | null>(null); // null: not started
  const [asking, setAsking] = useState<{ part: number; since: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const stop = useRef(false);

  const machine = profile ? { os: profile.osName, desktop: profile.desktop, sessionType: profile.sessionType, installedDesktops: profile.sessions } : null;
  // asked one at a time, Ollama and an API need the list's names in the last part; a chat has seen them
  const parts = useMemo(() => (open ? promptParts(machine, { withNames: way !== "browser" }) : []), [open, profile, way]); // eslint-disable-line react-hooks/exhaustive-deps
  const models = ollama?.models ?? [];

  useEffect(() => {
    if (!open) return;
    setAnswer("");
    setOff(new Set());
    setNext(null);
    setAsking(null);
    setApiKey("");
    if (!ollama) void loadOllama();
    terminalBrowser().then(setBrowser, () => setBrowser(null));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!model && models.length) setModel(brain.model && models.some((m) => m.name === brain.model) ? brain.model : models[0].name);
  }, [models, brain.model, model]);
  useEffect(() => {
    if (!asking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [asking]);
  useEffect(() => setNext(null), [way]);

  // what the answers would add, read again as you edit them
  const read: Read | null = useMemo(() => {
    if (!answer.trim()) return null;
    try {
      const r = readAnswers(answer);
      return { ...proposals(r.answer), answers: r.read, unreadable: r.unreadable, error: null };
    } catch (e) {
      return { items: [], refused: [], answers: 0, unreadable: 0, error: errText(e) };
    }
  }, [answer]);
  // a dangerous example starts unticked: you tick it yourself if you want it
  useEffect(() => setOff(startOff(read?.items ?? [])), [read?.items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const questions = parts.filter((p) => p.answer === "json").length;
  const append = (text: string) => setAnswer((a) => (a.trim() ? `${a.trimEnd()}\n\n${text.trim()}` : text.trim()));

  /** Ollama or an API: each question asked on its own, after the parts answered "ready" before it. */
  const askAll = async () => {
    stop.current = false;
    const context: ChatMessage[] = [];
    let done = 0;
    try {
      for (let i = 0; i < parts.length && !stop.current; i++) {
        if (parts[i].answer === "ready") {
          context.push({ role: "user", content: parts[i].text }, { role: "assistant", content: "ready" });
          continue;
        }
        setAsking({ part: i, since: Date.now() });
        const messages: ChatMessage[] = [...context, { role: "user", content: parts[i].text }];
        append(way === "ollama" ? await askOllama(model, messages) : await askApi(apiUrl.trim(), apiKey, apiModel.trim(), messages));
        done++;
      }
      toast({ title: stop.current ? `Fluff stopped after ${done} of ${questions} answers` : `Fluff has all ${done} answers`, description: "Read them in the answer box, then Integrate or Deny." });
    } catch (e) {
      toast({ title: `Fluff couldn't get answer ${done + 1} of ${questions}`, description: `${errText(e)}${done ? ` — the ${done} answer${done === 1 ? "" : "s"} before it stay in the box.` : ""}`, variant: "destructive" });
    } finally {
      setAsking(null);
    }
  };

  const copyPart = async (i: number) => {
    await navigator.clipboard.writeText(parts[i].text);
    setNext(i);
  };

  /** A chat page: the first part is copied and the page opens in your terminal. */
  const openChat = async () => {
    try {
      const how = await browseInTerminal(pageUrl.trim());
      await copyPart(0);
      toast({ title: `Fluff copied ${parts[0].title.toLowerCase()}`, description: `Fluff opened ${how}. Paste it in the chat (Ctrl+Shift+V). When the AI says "ready", come back for part 2.` });
    } catch (e) {
      toast({ title: "Fluff couldn't open the chat", description: errText(e), variant: "destructive" });
    }
  };

  /** The answer you copied joins the box; the next part is copied for you. */
  const bringBack = async () => {
    try {
      const t = (await clipboardText()).trim();
      if (!t) return toast({ title: "Fluff found the clipboard empty", description: "Copy the AI's answer first." });
      if (isPrompt(t, parts))
        return toast({ title: "Fluff sees the prompt, not the answer", description: "The clipboard holds what Fluff copied for the chat, not the AI's answer. Copy the answer (all of it) first.", variant: "destructive" });
      try {
        readAnswers(t);
      } catch (e) {
        return toast({ title: "Fluff can't read that answer", description: `Fluff can't use it: ${errText(e)}. Copy the whole answer — the AI should answer with JSON only. (You can also paste into the box.)`, variant: "destructive" });
      }
      if (answer.includes(t)) return toast({ title: "Fluff already has that answer", description: "It is in the answer box." });
      append(t);
      const n = (next ?? 0) + 1;
      if (n < parts.length) {
        await copyPart(n);
        toast({ title: `Fluff took the answer and copied ${parts[n].title.toLowerCase()}`, description: "Paste it in the chat; when the AI has answered, copy the answer and bring it back." });
      } else {
        setNext(parts.length);
        toast({ title: "Fluff has all the answers", description: "Read them in the answer box, then Integrate or Deny." });
      }
    } catch (e) {
      toast({ title: "Fluff couldn't read the clipboard", description: errText(e), variant: "destructive" });
    }
  };

  const chosen = read && !read.error ? read.items.filter((_, i) => !off.has(i)) : [];
  const integrate = () => {
    if (!chosen.length) return;
    const additions = chosen.reduce((all, p) => joinAdditions(all, p.additions), NO_ADDITIONS);
    const names = [...new Set(chosen.map((p) => p.command))];
    stageChange({
      kind: "commands.learn",
      label: `Commands: ${chosen.length} addition${chosen.length === 1 ? "" : "s"} from the AI (${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""})`,
      additions,
    });
    toast({ title: "Fluff integrated it — waiting for Apply", description: "Apply (top bar) puts them into the catalogue; Undo takes them back." });
    onClose();
  };
  const deny = () => {
    setAnswer("");
    setNext(null);
    toast({ title: "Fluff let it go", description: "Nothing from that answer was kept." });
  };

  const canSend = way === "ollama" ? Boolean(model) : way === "api" ? apiUrl.trim().length > 8 && apiModel.trim() !== "" : pageUrl.trim().length > 8 && Boolean(browser);
  if (!open) return null;
  const flip = (i: number) =>
    setOff((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const total = parts.length;
  const waitingReady = next !== null && next < total && parts[next].answer === "ready";
  const longest = Math.max(...parts.map((p) => p.text.length));

  // what is happening, in one line: what Fluff is waiting for
  const status = asking
    ? `Asking ${parts[asking.part].title.toLowerCase()} — the AI is still thinking (${clock(now - asking.since)}). The answers so far are in the box below.`
    : way === "browser" && next !== null
      ? next >= total
        ? `Done: all ${questions} answers are in the box below.`
        : waitingReady
          ? `Waiting for you: paste ${parts[next].title.toLowerCase()} in the chat. When the AI answers "ready", press "Copy part ${next + 2}".`
          : `Waiting for you: paste ${parts[next].title.toLowerCase()} in the chat. The AI has finished when its answer stops growing and the chat's Stop button is gone — then copy the whole answer and press "Bring the answer back".`
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-md border bg-card p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2 border-b pb-3">
          <Bot className="h-5 w-5 text-primary" />
          <h2 className="text-sm font-semibold">Ask AI to refresh what Fluff knows about commands</h2>
          <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={onClose}>
            Close
          </Button>
        </div>

        {/* 1. ask with */}
        <div className="space-y-2">
          <div className="text-xs font-medium">1. Ask with</div>
          <div className="grid gap-1.5 sm:grid-cols-3">
            {WAYS.map((w) => (
              <button key={w.id} onClick={() => setWay(w.id)} disabled={Boolean(asking)} className={`rounded-md border px-2.5 py-1.5 text-left ${way === w.id ? "border-primary/60 bg-primary/10" : "hover:bg-accent/40"}`}>
                <div className="text-xs font-medium">{w.label}</div>
                <div className="text-[10px] text-muted-foreground">{w.note}</div>
              </button>
            ))}
          </div>

          {way === "ollama" &&
            (models.length ? (
              <label className="flex items-center gap-2 text-xs">
                Model
                <select value={model} onChange={(e) => setModel(e.target.value)} className="h-7 min-w-0 flex-1 rounded-md border bg-popover px-2 text-xs text-popover-foreground">
                  {models.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name} {m.sizeRaw ? `· ${m.sizeRaw}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {ollama === null ? "Fluff is looking for Ollama…" : !ollama.available ? "Ollama isn't installed: the Ollama section installs it." : !ollama.serverUp ? "Ollama isn't running: start it in the Ollama section." : "Ollama has no model yet: the Ollama section recommends ones that fit this computer."}
              </p>
            ))}

          {way === "api" && (
            <div className="grid gap-1.5 sm:grid-cols-[2fr_1fr]">
              <Input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="https://api.openai.com/v1/chat/completions" className="h-8 text-xs" aria-label="API address" />
              <Input value={apiModel} onChange={(e) => setApiModel(e.target.value)} placeholder="model, e.g. gpt-4o-mini" className="h-8 text-xs" aria-label="model" />
              <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" autoComplete="off" placeholder="API key (if it needs one)" className="h-8 text-xs sm:col-span-2" aria-label="API key" />
              <p className="text-[10px] text-muted-foreground sm:col-span-2">
                The address of the AI's chat API, not its web page. The key is used for these requests only: TuxCopilot never saves it. Only the parts below are sent.
              </p>
            </div>
          )}

          {way === "browser" && (
            <div className="space-y-1">
              <Input value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} placeholder="https://duck.ai/" className="h-8 text-xs" aria-label="AI chat page" />
              {browser === null && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-warn/40 bg-warn/5 p-2 text-[11px]">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-warn" />
                  <span className="min-w-0 flex-1">
                    No terminal browser yet. Fluff recommends <b>browsh</b>: it shows the chat page with your own Firefox, which Arch keeps updated. (w3m, lynx and links can't show chat pages: they don't run JavaScript.)
                  </span>
                  <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" title={BROWSH_INSTALL} onClick={() => void runQuick("Install browsh", BROWSH_INSTALL, dryRun).then(() => terminalBrowser().then(setBrowser, () => setBrowser(null)))}>
                    Install browsh
                  </Button>
                </div>
              )}
              <p className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
                <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                A chat page can't hand its answer to another app: Fluff copies each part for you to paste, and after each answer you copy it and press "Bring the answer back".
                {browser === "carbonyl" && " carbonyl's Chromium is from 2023 and gets no security updates; sign in there only if you are fine with that (browsh, with your Firefox, doesn't have that problem)."}
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {way !== "browser" ? (
              asking ? (
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => (stop.current = true)}>
                  <Square className="h-3 w-3" /> Stop after this part
                </Button>
              ) : (
                <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void askAll()} disabled={!canSend}>
                  <Send className="h-3 w-3" /> Send prompt ({questions} questions)
                </Button>
              )
            ) : (
              <>
                <Button size="sm" variant={next === null ? "default" : "outline"} className="h-8 gap-1.5 text-xs" onClick={() => void openChat()} disabled={!canSend}>
                  <Send className="h-3 w-3" /> {next === null ? "Send prompt (opens the chat, copies part 1)" : "Open the chat again"}
                </Button>
                {waitingReady && next + 1 < total && (
                  <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void copyPart(next + 1)}>
                    <ClipboardCopy className="h-3 w-3" /> It said "ready": copy part {next + 2}
                  </Button>
                )}
                {next !== null && next < total && !waitingReady && (
                  <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void bringBack()}>
                    <ClipboardPaste className="h-3 w-3" /> Bring the answer back
                  </Button>
                )}
              </>
            )}
          </div>
          {status && (
            <p className="flex items-start gap-1.5 rounded-md border border-primary/30 bg-primary/5 p-2 text-[11px]" role="status">
              {asking ? <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-primary" /> : next !== null && next >= total ? <Check className="mt-0.5 h-3 w-3 shrink-0 text-ok" /> : <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />}
              {status}
            </p>
          )}
          <details className="rounded-md border border-border/40">
            <summary className="cursor-pointer px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-accent/30">
              The prompt, in {total} parts of at most {PART_LIMIT.toLocaleString()} characters (cut only between commands, longest {longest.toLocaleString()}): your computer's OS, the desktop in use (and Wayland or X11) and the other desktops installed, and the catalogue's names and what each has — nothing else of yours
            </summary>
            <div className="max-h-64 space-y-2 overflow-auto bg-code p-2">
              {parts.map((p, i) => (
                <div key={p.title}>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className={way === "browser" && next !== null && i < next ? "text-ok" : ""}>
                      {p.title} · {p.text.length} characters · answered with {p.answer === "ready" ? '"ready"' : "JSON"}
                    </span>
                    {way === "browser" && (
                      <button className="ml-auto underline hover:text-foreground" onClick={() => void copyPart(i)}>
                        copy
                      </button>
                    )}
                  </div>
                  <pre className="whitespace-pre-wrap text-[10px] leading-relaxed text-term-foreground">{p.text}</pre>
                </div>
              ))}
            </div>
          </details>
        </div>

        {/* 2. the answer — editable while you read it */}
        <div className="mt-4 space-y-2">
          <label className="text-xs font-medium" htmlFor="ai-answer">
            2. The answer — read it, and change anything you like
          </label>
          <Textarea
            id="ai-answer"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="The AI's answers arrive here, one after another (you can also paste them)."
            className="min-h-[140px] resize-y bg-code font-mono text-[11px]"
            spellCheck={false}
          />
          {read?.error && <p className="text-[11px] text-bad">Fluff can't read this yet: {read.error}. The AI should answer with the JSON only, in the template's shape.</p>}
          {read && !read.error && read.unreadable > 0 && (
            <p className="text-[11px] text-warn">
              Fluff read {read.answers} answer{read.answers === 1 ? "" : "s"}; {read.unreadable} it couldn't (broken JSON — maybe cut off). Ask that part again, or fix it in the box.
            </p>
          )}
        </div>

        {/* 3. what it would add; integrate or deny */}
        {read && !read.error && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium">
              <span>3. What it would add ({read.items.length})</span>
              <Badge variant="outline" className="text-[9px] font-normal text-muted-foreground">
                only gaps and new options — nothing already there changes
              </Badge>
            </div>
            {read.items.length === 0 && <p className="text-[11px] text-muted-foreground">Nothing new: Fluff already knows everything in this answer.</p>}
            {read.items.length > 0 && (
              <div className="divide-y divide-border/40 rounded-md border">
                {read.items.map((d, i) => {
                  const Icon = d.kind === "command" ? FilePlus : Plus;
                  const risk = proposalRisk(d);
                  return (
                    <label key={`${d.label}-${i}`} className="flex items-start gap-2 px-3 py-2 text-xs hover:bg-accent/30">
                      <input type="checkbox" checked={!off.has(i)} onChange={() => flip(i)} className="mt-0.5 h-3.5 w-3.5 accent-primary" />
                      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[11px] text-primary">{d.label}</div>
                        <div className="text-[10px] text-muted-foreground">{d.detail}</div>
                        {risk && (
                          <div className={`mt-0.5 text-[10px] ${risk.level === "danger" ? "text-bad" : "text-warn"}`}>
                            <span className="font-medium">{risk.level === "danger" ? "Dangerous" : "Careful"}:</span> <code className="font-mono">{risk.command}</code> — {risk.text}
                            {risk.level === "danger" && " Fluff left it unticked."}
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
            {read.refused.length > 0 && (
              <div className="rounded-md border border-warn/40 bg-warn/5 p-2 text-[10px]">
                <div className="mb-0.5 font-medium">Fluff left these out:</div>
                <ul className="ml-4 list-disc">
                  {read.refused.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex items-start gap-1.5 rounded-md border border-primary/30 bg-primary/5 p-2 text-[10px] leading-relaxed text-foreground/80">
              <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              <span>
                Integrate puts what you ticked into pending changes: Apply makes it stick, Undo takes it back. It is kept in your TuxCopilot, so it moves
                house with Fluff. An AI can be wrong: each command's page also shows its real --help, so you can check.
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={deny}>
                <X className="h-3 w-3" /> Deny
              </Button>
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={integrate} disabled={chosen.length === 0}>
                Integrate {chosen.length}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
