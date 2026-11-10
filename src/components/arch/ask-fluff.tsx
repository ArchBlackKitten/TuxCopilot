// Ask Fluff (top bar): a chat with Fluff's brain, the local model chosen in Settings. Each
// command in an answer can be explained (Commands) or copied, and every command it mentions is
// a link to its page; Fluff never runs anything itself.
import { useRef, useState } from "react";
import { Copy, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { askFluff, type ChatMessage } from "@/lib/brain";
import { errText } from "@/lib/host";
import { iconUrl } from "@/lib/look-runtime";
import { CommandText } from "./command-text";
import { useArch } from "./store";

function Answer({ text, onExplain }: { text: string; onExplain: (c: string) => void }) {
  const { toast } = useToast();
  return (
    <div className="space-y-1.5">
      {text.split(/(```[a-z]*\n?[\s\S]*?```)/g).map((part, i) => {
        const block = part.match(/^```[a-z]*\n?([\s\S]*?)```$/);
        if (!block)
          return part.trim() ? (
            <p key={i} className="whitespace-pre-line">
              <CommandText text={part.trim()} />
            </p>
          ) : null;
        return (
          <div key={i} className="space-y-0.5 rounded-md bg-term p-1.5">
            {block[1]
              .split("\n")
              .map((l) => l.replace(/^\$\s+/, ""))
              .filter((l) => l.trim())
              .map((l, j) =>
                l.trim().startsWith("#") ? (
                  <div key={j} className="font-mono text-[10px] text-term-foreground/60">
                    {l}
                  </div>
                ) : (
                  <div key={j} className="flex items-center gap-1">
                    <code className="min-w-0 flex-1 font-mono text-[11px] text-term-foreground">
                      <CommandText text={l} line />
                    </code>
                    <Button size="icon" variant="ghost" className="h-5 w-5 text-term-foreground" title="Copy" onClick={() => {
                      void navigator.clipboard.writeText(l.trim());
                      toast({ title: "Fluff copied it", description: l.trim() });
                    }}>
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-5 w-5 text-term-foreground" title="Explain it, part by part (Commands)" onClick={() => onExplain(l.trim())}>
                      <Sparkles className="h-3 w-3" />
                    </Button>
                  </div>
                ),
              )}
          </div>
        );
      })}
    </div>
  );
}

export function AskFluff({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { brain, profile, explain, setView } = useArch();
  const icon = useArch((s) => s.look.icon);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const ready = brain.on && brain.model;
  const machine = profile ? { os: profile.osName, desktop: profile.desktop, sessionType: profile.sessionType, installedDesktops: profile.sessions } : null;

  const ask = async () => {
    const q = draft.trim();
    if (!q || !ready || busy) return;
    const next: ChatMessage[] = [...chat, { role: "user", content: q }];
    setChat(next);
    setDraft("");
    setBusy(true);
    setFailed(null);
    try {
      const a = await askFluff(brain.model!, machine, next);
      setChat([...next, { role: "assistant", content: a }]);
    } catch (e) {
      setFailed(errText(e));
    } finally {
      setBusy(false);
      setTimeout(() => end.current?.scrollIntoView({ block: "end" }), 0);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img src={iconUrl(icon)} alt="" className="h-6 w-6" /> Ask Fluff
          </DialogTitle>
          <DialogDescription>
            {ready ? `Fluff answers with ${brain.model}, on this computer. Fluff is a chick: check what it says, and nothing runs unless you run it.` : "Fluff's brain is off."}
          </DialogDescription>
        </DialogHeader>

        {!ready ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Choose a local model in Settings → Fluff's brain, then Apply.</span>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { onClose(); setView("settings"); }}>
              Open Settings
            </Button>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 text-[12px] leading-relaxed">
              {chat.length === 0 && <p className="text-muted-foreground">Ask about your computer: "why is my wifi not connecting?", "how do I install Steam?", "what is a .pacnew?"</p>}
              {chat.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="ml-8 whitespace-pre-line rounded-md bg-primary/10 p-2">
                    {m.content}
                  </div>
                ) : (
                  <div key={i} className="mr-4 rounded-md border bg-card p-2">
                    <Answer text={m.content} onExplain={(c) => { onClose(); explain(c); }} />
                  </div>
                ),
              )}
              {busy && <p className="text-muted-foreground">Fluff is thinking…</p>}
              {failed && <p className="text-bad">Fluff couldn't answer: {failed}</p>}
              <div ref={end} />
            </div>
            <div className="flex gap-2">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void ask();
                  }
                }}
                placeholder="Ask Fluff… (Enter sends, Shift+Enter: a new line)"
                className="min-h-[44px] flex-1 resize-none text-xs"
              />
              <Button className="h-auto gap-1" disabled={busy || !draft.trim()} onClick={() => void ask()}>
                <Send className="h-3.5 w-3.5" /> Ask
              </Button>
            </div>
            {chat.length > 0 && (
              <button className="self-start text-[10px] text-muted-foreground hover:underline" onClick={() => setChat([])}>
                Start over
              </button>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
