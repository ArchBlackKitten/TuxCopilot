// Settings → Your penguin: the whole of TuxCopilot in one file, to take it to another computer.
// Export: a passphrase (yours, or words TuxCopilot picks — 9 unless you choose) seals it. Import: the file's
// checksum and signature first, then the passphrase, then what it holds — and only then, on
// your word, it replaces what is here (which is kept first, sealed the same way).
import { useEffect, useState } from "react";
import { Check, Download, KeyRound, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { errText } from "@/lib/host";
import { exportSigner, importVerdict, savedNote, type Verdict } from "@/lib/integrity";
import { iconUrl } from "@/lib/look-runtime";
import { IMPORT_EVENT, appsLine, contentsLine, exportPenguin, passphraseWords, peekPenguin, pickKey, pickPenguin, previewPenguin, restorePenguin, shownPath, type Carried, type PenguinPreview, type PenguinSummary } from "@/lib/penguin";
import { PenguinApps } from "./penguin-apps";
import { FluffSays } from "./fluff-says";
import { useArch } from "./store";
import { TuxTag } from "./tux-tag";
import { tuxPath } from "@/lib/tux-own";

const mb = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(n >= 10 << 20 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Your apps' settings, each ticked or not: ~/.config folders first, then your home's files. */
function SettingsTicks({ items, off, setOff, note }: { items: Carried[]; off: Set<string>; setOff: (s: Set<string>) => void; note: string }) {
  if (!items.length) return null;
  const on = items.filter((i) => !off.has(pickKey(i)));
  const flip = (k: string) => {
    const n = new Set(off);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setOff(n);
  };
  return (
    <details className="rounded-md border p-2">
      <summary className="cursor-pointer text-[11px]">
        <b>Your apps' settings</b>: {on.length} of {items.length} ticked ({mb(on.reduce((t, i) => t + i.size, 0))}) — {note}
      </summary>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Settings can hold passwords and logins (a browser's, a chat app's): Fluff's belongings are sealed, and each one is your choice. Large ones
        start unticked. Your keys (~/.ssh, ~/.gnupg) are never taken: move them yourself.
      </p>
      <div className="mt-1 flex gap-2 text-[10px]">
        <button className="hover:underline" onClick={() => setOff(new Set())}>all</button>
        <button className="hover:underline" onClick={() => setOff(new Set(items.map(pickKey)))}>none</button>
      </div>
      <div className="mt-1 flex max-h-48 flex-wrap gap-1 overflow-y-auto">
        {items.map((i) => {
          const k = pickKey(i);
          const ticked = !off.has(k);
          return (
            <button key={k} onClick={() => flip(k)} className={`flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${ticked ? "border-primary/50 bg-primary/10" : "opacity-50"}`}>
              {ticked && <Check className="h-2.5 w-2.5" />}
              {shownPath(i)} {tuxPath(shownPath(i)) && <TuxTag why={tuxPath(shownPath(i))!} />} <span className="text-muted-foreground">{mb(i.size)}</span>
            </button>
          );
        })}
      </div>
    </details>
  );
}

type Step =
  | { at: "idle" }
  | { at: "export"; words: string[] | null }
  | { at: "import"; name: string; verdict: Verdict; summary: PenguinSummary | null };

export function PenguinPanel() {
  const { look, history } = useArch();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>({ at: "idle" });
  const [pass, setPass] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(9);
  const pendingCount = history.pending.length;
  const [preview, setPreview] = useState<PenguinPreview | null>(null);
  const exporting = step.at === "export";
  const [leaveOut, setLeaveOut] = useState<Set<string>>(new Set()); // settings unticked for export
  const [withTorrc, setWithTorrc] = useState(true);
  const [withFirewall, setWithFirewall] = useState(true);
  const [skip, setSkip] = useState<Set<string>>(new Set()); // settings unticked for import
  useEffect(() => {
    if (!exporting) return;
    setPreview(null);
    previewPenguin().then((p) => {
      setPreview(p);
      setLeaveOut(new Set(p.configs.filter((c) => !c.ticked).map(pickKey)));
    }, (e) => fail("Fluff couldn't list your apps", e));
  }, [exporting]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    setStep({ at: "idle" });
    setPass("");
    setAgain("");
  };
  const fail = (title: string, e: unknown) => toast({ title, description: errText(e), variant: "destructive" });
  // the welcome's "Import my penguin"
  useEffect(() => {
    const go = () => void pick();
    window.addEventListener(IMPORT_EVENT, go);
    return () => window.removeEventListener(IMPORT_EVENT, go);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const makeWords = async () => {
    try {
      const words = await passphraseWords(Math.max(1, Math.floor(count) || 9));
      setStep({ at: "export", words });
      setPass(words.join(" "));
      setAgain(words.join(" "));
    } catch (e) {
      fail("No words", e);
    }
  };

  const doExport = async () => {
    setBusy(true);
    try {
      if (!preview) return;
      const picks = preview.configs.filter((c) => !leaveOut.has(pickKey(c))).map(({ place, name }) => ({ place, name }));
      const saved = await exportPenguin(pass, picks, withTorrc && preview.torrc, withFirewall && preview.firewall);
      if (saved) {
        toast({ title: "Packed! Fluff's belongings are saved", description: `${savedNote(saved, exportSigner())} On the other computer: Fluff's welcome → Relocate Fluff (or Settings → Relocate Fluff → Bring Fluff's belongings…).` });
        close();
      }
    } catch (e) {
      fail("Fluff didn't save it", e);
    } finally {
      setBusy(false);
    }
  };

  const pick = async () => {
    try {
      const f = await pickPenguin();
      if (!f) return;
      const verdict = importVerdict(f.integrity);
      if (!verdict.ok) return toast({ title: "Fluff didn't import it", description: verdict.note, variant: "destructive" });
      setPass("");
      setStep({ at: "import", name: f.name, verdict, summary: null });
    } catch (e) {
      fail("Fluff didn't import it", e);
    }
  };

  const peek = async () => {
    if (step.at !== "import") return;
    setBusy(true);
    try {
      setStep({ ...step, summary: await peekPenguin(pass) });
      setSkip(new Set());
    } catch (e) {
      fail("Not opened", e);
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    try {
      if (step.at !== "import" || !step.summary) return;
      const putBack = step.summary.configs.filter((c) => !skip.has(pickKey(c))).map(({ place, name }) => ({ place, name }));
      const r = await restorePenguin(pass, putBack);
      const moved = r.configs.filter(([, aside]) => aside).length;
      toast({
        title: "Fluff has moved in!",
        description:
          `${r.configs.length} of your apps' settings are back${moved ? ` (${moved} that were here are kept beside them, as .before-fluff)` : ""}. ` +
          `What TuxCopilot held before is kept in ${r.kept} (same passphrase). TuxCopilot starts again with it — then Get your apps back.` +
          (r.configError ? ` Settings not put back: ${r.configError}` : ""),
        variant: r.configError ? "destructive" : undefined,
      });
      setTimeout(() => window.location.reload(), r.configError ? 8000 : 4000);
    } catch (e) {
      fail("Fluff didn't import it", e);
      setBusy(false);
    }
  };

  const matches = pass.trim() !== "" && pass === again;

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <img src={iconUrl(look.icon)} alt="" className="h-12 w-12" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Relocate Fluff</h2>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Moving to another computer? Fluff packs its belongings into one file: everything TuxCopilot knows (your sections and items,
            the history of runs, how you use your apps, every setting and the look), and your apps, their settings, your git clones,
            Ollama models, Docker images, Tor's and the firewall's settings — to get them all back there. Or keep it somewhere safe. It
            is sealed by a passphrase: without it the file is unreadable, to anyone. What Fluff learned about <i>this</i> computer
            stays here; on the new one, Fluff learns its new home.
          </p>
        </div>
        {step.at === "idle" && (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setStep({ at: "export", words: null })}>
              <Download className="h-3 w-3" /> Pack Fluff's belongings…
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" disabled={pendingCount > 0} onClick={() => void pick()}>
              <Upload className="h-3 w-3" /> Bring Fluff's belongings…
            </Button>
          </div>
        )}
      </div>
      {step.at === "idle" && <PenguinApps />}
      {step.at === "idle" && pendingCount > 0 && (
        <p className="text-[11px] text-muted-foreground">To bring Fluff's belongings in, first Apply or Undo your pending changes (top bar): the belongings replace them.</p>
      )}

      {step.at === "export" && (
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            <KeyRound className="h-3.5 w-3.5 text-primary" /> Choose the passphrase that seals it
          </div>
          <div className="text-[11px]">
            {preview ? (
              <>
                Fluff is packing your apps too — <b>{appsLine(preview)}</b> — so the new computer can install them and download your
                clones again.
                {(preview.notCarried.noRemote.length > 0 || preview.notCarried.unsavedWork.length > 0) && (
                  <div className="my-1.5">
                    <FluffSays>
                      {preview.notCarried.unsavedWork.length > 0 && (
                        <div>
                          Commit and push your work first: <b>{preview.notCarried.unsavedWork.join(", ")}</b> has changes that live only here, and
                          I can only bring back what is on its remote.
                        </div>
                      )}
                      {preview.notCarried.noRemote.length > 0 && (
                        <div>
                          Copy these yourself (a USB stick is fine): <b>{preview.notCarried.noRemote.join(", ")}</b> exist only on this computer, so I
                          can't download them again.
                        </div>
                      )}
                    </FluffSays>
                  </div>
                )}
                {preview.notCarried.outsideHome.length > 0 && (
                  <div className="text-muted-foreground">Outside your home folder, so not listed: {preview.notCarried.outsideHome.join(", ")}.</div>
                )}
                {preview.notCarried.dockerUnreadable && (
                  <div className="text-muted-foreground">Docker would not list its images to you (you are not in the docker group), so they are not listed.</div>
                )}
                <div className="mt-1.5 flex flex-wrap gap-3">
                  {preview.torrc && (
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={withTorrc} onChange={(e) => setWithTorrc(e.target.checked)} /> Tor's settings (torrc)
                    </label>
                  )}
                  {preview.firewall && (
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={withFirewall} onChange={(e) => setWithFirewall(e.target.checked)} /> your firewall's settings
                    </label>
                  )}
                </div>
                <div className="mt-1.5">
                  <SettingsTicks items={preview.configs} off={leaveOut} setOff={setLeaveOut} note="untick what should stay here" />
                </div>
              </>
            ) : (
              <span className="text-muted-foreground">Fluff is looking through your apps and git clones…</span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Write it down: TuxCopilot does not keep it, and nobody can open Fluff's belongings without it. Or let TuxCopilot pick words for you: 9 is a good number; choose as many as you like.
          </p>
          <Input type="password" autoComplete="new-password" placeholder="passphrase" value={pass} onChange={(e) => { setPass(e.target.value); setStep({ at: "export", words: null }); }} className="h-8 text-xs" />
          <Input type="password" autoComplete="new-password" placeholder="the same, again" value={again} onChange={(e) => setAgain(e.target.value)} className="h-8 text-xs" />
          {step.words && (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-2">
              <div className="text-[10px] text-muted-foreground">Your words — write them down now, in this order:</div>
              <div className="font-mono text-sm">{step.words.join(" ")}</div>
            </div>
          )}
          {again !== "" && pass !== again && <p className="text-[11px] text-warn">The two are not the same.</p>}
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" className="h-7 px-2 text-[11px]" disabled={!matches || busy || !preview} onClick={() => void doExport()}>
              {busy ? "Fluff is packing…" : "Seal and save…"}
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={busy} onClick={() => void makeWords()}>
              Pick words for me
            </Button>
            <Input type="number" min={1} max={5000} value={count} onChange={(e) => setCount(Number(e.target.value))} className="h-7 w-16 text-xs" aria-label="how many words" />
            <span className="self-center text-[10px] text-muted-foreground">words</span>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" disabled={busy} onClick={close}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {step.at === "import" && (
        <div className="space-y-2 rounded-md border p-3">
          <div className="text-xs font-medium">{step.name}</div>
          <p className="text-[11px] text-muted-foreground">{step.verdict.note}</p>
          {!step.summary ? (
            <>
              <Input type="password" autoComplete="off" placeholder="its passphrase" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && pass && void peek()} className="h-8 text-xs" />
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" className="h-7 px-2 text-[11px]" disabled={!pass || busy} onClick={() => void peek()}>
                  {busy ? "Fluff is opening it…" : "Open it"}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" disabled={busy} onClick={close}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[11px]">
                Made on <b>{step.summary.from || "another computer"}</b>, {new Date(step.summary.made).toLocaleString()} (TuxCopilot {step.summary.appVersion}).
                It holds {contentsLine(step.summary)}, and the list of your apps: {appsLine(step.summary)}
                {step.summary.torrc ? ", Tor's settings" : ""}
                {step.summary.firewall ? ", your firewall's settings" : ""}.
              </p>
              <SettingsTicks items={step.summary.configs} off={skip} setOff={setSkip} note="put back now; untick what should not be" />
              <p className="text-[11px] text-muted-foreground">
                Importing replaces what is here with it; then TuxCopilot shows which of your apps this computer does not have yet, to install them with a click. What is here now is packed first, as belongings in TuxCopilot's own folder, sealed
                by this same passphrase — bring those in to go back.
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" className="h-7 px-2 text-[11px]" disabled={busy} onClick={() => void restore()}>
                  {busy ? "Fluff is unpacking…" : "Replace this TuxCopilot with it"}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" disabled={busy} onClick={close}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
