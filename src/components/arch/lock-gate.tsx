// The lock, on screen: nothing of TuxCopilot shows until it is open. Fluff guards it.
//
//   not set up    the setup: the phone (QR), the password code, the seed (on paper, typed back),
//                 the optional recovery file — then the database is sealed and TuxCopilot opens
//   set up        the lock screen: the 30-second code AND the password code
//   lost          the seed (and, if lock.json is gone, the recovery file): a new phone and a
//                 new password code
//   open          the app; after a pause with no one at it, it locks itself, and the password
//                 code or the code (your choice, Settings → Lock and signing) opens it again
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { KeyRound, Lock, ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { errText } from "@/lib/host";
import { importVerdict, saveFile, savedNote, exportSigner } from "@/lib/integrity";
import {
  askBack,
  codeDigits,
  grouped,
  lockNow,
  lockStatus,
  openLock,
  pauseLock,
  qrSrc,
  recoverBegin,
  recoveryText,
  resumeLock,
  setupBegin,
  setupCode,
  setupFinish,
  type Enrol,
  type LockStatus,
} from "@/lib/lock";
import { decodeText, iconUrl, openFile } from "@/lib/look-runtime";
import { BEFORE_THE_LOCK, MIN_PASSWORD, passwordLongEnough, seedWarning } from "@/lib/lock";

/** Settings → Lock and signing's "Lock now" (and the top bar's lock) ask through this. */
export const LOCK_NOW_EVENT = "tuxcopilot:lock-now";

const fluff = iconUrl(null);

function Card({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border bg-card p-6 shadow-lg">
        <div className="flex items-center gap-3">
          <img src={fluff} alt="" className="h-14 w-14" />
          <div>
            <h1 className="text-base font-semibold">{title}</h1>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function CodeBox({ value, onChange, onEnter, autoFocus }: { value: string; onChange: (v: string) => void; onEnter?: () => void; autoFocus?: boolean }) {
  return (
    <Input
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="the 6 digits your app shows now"
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(codeDigits(e.target.value))}
      onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
      className="font-mono tracking-widest"
    />
  );
}

function PasswordBox({ value, onChange, placeholder = "your password code", onEnter, autoFocus, isNew }: { value: string; onChange: (v: string) => void; placeholder?: string; onEnter?: () => void; autoFocus?: boolean; isNew?: boolean }) {
  return (
    <Input
      type="password"
      autoComplete={isNew ? "new-password" : "current-password"}
      placeholder={placeholder}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
    />
  );
}

function Problem({ text }: { text: string | null }) {
  return text ? <p className="text-xs text-bad">{text}</p> : null;
}

// ── the phone ────────────────────────────────────────────────────────────

function PhoneStep({ enrol, onDone }: { enrol: Enrol; onDone: () => void }) {
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const confirm = async () => {
    try {
      await setupCode(code);
      onDone();
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm">
        <Smartphone className="mr-1 inline h-4 w-4" /> Open an authenticator app on your device and scan this QR code — or copy the key below into the app by hand:
      </p>
      <img src={qrSrc(enrol.qr)} alt="QR code for your authenticator app" className="mx-auto h-48 w-48 rounded-md bg-white p-2" />
      <div className="space-y-1 rounded-md border p-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>The key:</span>
          <span className="min-w-0 flex-1 select-all break-all font-mono text-[11px] text-foreground">{grouped(enrol.secret)}</span>
          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => void navigator.clipboard.writeText(enrol.secret).then(() => setCopied(true))}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <div>In the app: time-based (TOTP), 6 digits, every 30 seconds.</div>
      </div>
      <p className="text-xs text-muted-foreground">Then type the 6 digits it shows, to prove it works:</p>
      <CodeBox value={code} onChange={setCode} onEnter={() => void confirm()} autoFocus />
      <Problem text={err} />
      <Button className="w-full" disabled={code.length !== 6} onClick={() => void confirm()}>
        It works
      </Button>
    </div>
  );
}

// ── the password code ────────────────────────────────────────────────────

function PasswordStep({ onDone, note }: { onDone: (password: string) => void; note: string }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  return (
    <div className="space-y-3">
      <p className="text-sm">
        <KeyRound className="mr-1 inline h-4 w-4" /> Choose your password code. {note}
      </p>
      <p className="text-xs text-muted-foreground">
        Only you know it. It opens TuxCopilot's files on its own — a copy of them too, on any computer — so make it a good one: at least{" "}
        {MIN_PASSWORD} characters; a few words you will remember are best.
      </p>
      <PasswordBox value={a} onChange={setA} isNew autoFocus />
      <PasswordBox value={b} onChange={setB} placeholder="the same, again" isNew onEnter={() => passwordLongEnough(a) && a === b && onDone(a)} />
      {a !== "" && !passwordLongEnough(a) && <p className="text-xs text-warn">At least {MIN_PASSWORD} characters ({[...a].length} so far).</p>}
      {b !== "" && a !== b && <p className="text-xs text-warn">The two are not the same.</p>}
      <Button className="w-full" disabled={!passwordLongEnough(a) || a !== b} onClick={() => onDone(a)}>
        Next
      </Button>
    </div>
  );
}

// ── the seed ─────────────────────────────────────────────────────────────

function SeedShow({ seed, onDone }: { seed: string[]; onDone: () => void }) {
  const [wrote, setWrote] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-sm">
        These are your <b>seed words</b>. If you ever lose your device or forget your password code, they are the only way back in.
      </p>
      <ol className="grid grid-cols-3 gap-1.5 rounded-md border bg-muted/30 p-3 font-mono text-sm">
        {seed.map((w, i) => (
          <li key={i}>
            <span className="text-muted-foreground">{i + 1}.</span> {w}
          </li>
        ))}
      </ol>
      <p className="text-xs text-warn">
        Write them on paper, in this order, and keep it somewhere safe. Not in a file, a photo or a cloud: TuxCopilot never stores
        them, and whoever has them can open your data.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={wrote} onChange={(e) => setWrote(e.target.checked)} /> I wrote them down on paper
      </label>
      <Button className="w-full" disabled={!wrote} onClick={onDone}>
        Next
      </Button>
    </div>
  );
}

function SeedBack({ count, onBack, onDone, busy }: { count: number; onBack: () => void; onDone: (typed: Array<[number, string]>) => void; busy: boolean }) {
  const [ask] = useState(() => askBack(count));
  const [typed, setTyped] = useState<Record<number, string>>({});
  const { toast } = useToast();
  const saveRecovery = async () => {
    try {
      const saved = await saveFile("tuxcopilot-recovery.age", await recoveryText());
      if (saved) toast({ title: "Fluff saved your recovery file", description: `${savedNote(saved, exportSigner())} It opens only with your seed words.` });
    } catch (e) {
      toast({ title: "Fluff didn't save it", description: errText(e), variant: "destructive" });
    }
  };
  const all = ask.every((i) => (typed[i] ?? "").trim());
  return (
    <div className="space-y-3">
      <p className="text-sm">From your paper, type these words back:</p>
      {ask.map((i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-16 text-right text-xs text-muted-foreground">word {i + 1}</span>
          <Input autoComplete="off" spellCheck={false} value={typed[i] ?? ""} onChange={(e) => setTyped({ ...typed, [i]: e.target.value })} className="font-mono" />
        </div>
      ))}
      <div className="rounded-md border p-2 text-xs text-muted-foreground">
        <b className="text-foreground">Optional: a recovery file.</b> If this computer's lock file is ever lost, the recovery file and your seed words
        together bring your data back (it also opens with the plain <code>age</code> tool). Keep it apart from your paper.
        <div className="mt-1.5">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void saveRecovery()}>
            Save a recovery file…
          </Button>
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          See the words again
        </Button>
        <Button className="flex-1" disabled={!all || busy} onClick={() => onDone(ask.map((i) => [i, typed[i].trim()]))}>
          {busy ? "Fluff is sealing your data…" : "Seal my data"}
        </Button>
      </div>
    </div>
  );
}

// ── first start ──────────────────────────────────────────────────────────

function Setup({ onOpen }: { onOpen: () => void }) {
  const [words, setWords] = useState(9);
  const [sureShort, setSureShort] = useState(false); // fewer than 6 words: you said you understand
  const [enrol, setEnrol] = useState<Enrol | null>(null);
  const [step, setStep] = useState<"intro" | "phone" | "password" | "seed" | "back">("intro");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const begin = async () => {
    try {
      setEnrol(await setupBegin(Math.max(1, Math.floor(words) || 9)));
      setStep("phone");
      setErr(null);
    } catch (e) {
      setErr(errText(e));
    }
  };
  const finish = async (typed: Array<[number, string]>) => {
    setBusy(true);
    try {
      await setupFinish(password, typed);
      onOpen();
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };

  const titles = { intro: "Hello, I'm Fluff", phone: "1 · Your device", password: "2 · Your password code", seed: "3 · Your seed words", back: "4 · Check your paper" };
  return (
    <Card title={titles[step]} sub={step === "intro" ? "your TuxCopilot. First, let's keep your data safe." : "Fluff is setting up your lock"}>
      {step === "intro" && (
        <div className="space-y-3 text-sm">
          <p>
            TuxCopilot keeps private things: what you run, your apps, your settings. So it is <b>locked and encrypted</b>, and TuxCopilot asks
            for two things together:
          </p>
          <ul className="ml-4 list-disc space-y-1 text-xs">
            <li>
              the <b>30-second code</b> from an authenticator app on your device (phone, tablet…), and
            </li>
            <li>
              your <b>password code</b>.
            </li>
          </ul>
          <p className="text-xs text-muted-foreground">
            Honestly: the 30-second code guards TuxCopilot's door. The files themselves open with the password code alone (or the seed words) —
            a copy of them too, on another computer — so both must be hard to guess.
          </p>
          <p className="text-xs text-muted-foreground">{BEFORE_THE_LOCK}</p>
          <p className="text-xs text-muted-foreground">
            Then I'll give you <b>seed words</b> to write on paper: they bring your data back if you lose your phone or forget the password
            code. 9 words is a good number; you can choose more or fewer.
          </p>
          <div className="flex items-center gap-2 text-xs">
            Seed words:
            <Input type="number" min={1} max={5000} value={words} onChange={(e) => (setWords(Number(e.target.value)), setSureShort(false))} className="h-7 w-20 text-xs" aria-label="how many seed words" />
          </div>
          <p className={`text-[11px] ${seedWarning(words).level === "ok" ? "text-muted-foreground" : "text-warn"}`}>{seedWarning(words).text}</p>
          {seedWarning(words).level === "weak" && (
            <label className="flex items-center gap-1.5 text-[11px]">
              <input type="checkbox" checked={sureShort} onChange={(e) => setSureShort(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
              I understand: so few words are easy to guess.
            </label>
          )}
          <Problem text={err} />
          <Button className="w-full" disabled={!Number.isFinite(words) || words < 1 || (seedWarning(words).level === "weak" && !sureShort)} onClick={() => void begin()}>
            <ShieldCheck className="mr-1.5 h-4 w-4" /> Let's begin
          </Button>
        </div>
      )}
      {step === "phone" && enrol && <PhoneStep enrol={enrol} onDone={() => setStep("password")} />}
      {step === "password" && (
        <PasswordStep
          note="You'll type it with the 30-second code every time TuxCopilot opens."
          onDone={(p) => {
            setPassword(p);
            setStep("seed");
          }}
        />
      )}
      {step === "seed" && enrol && <SeedShow seed={enrol.seed} onDone={() => setStep("back")} />}
      {step === "back" && enrol && (
        <>
          <SeedBack count={enrol.seed.length} busy={busy} onBack={() => setStep("seed")} onDone={(t) => void finish(t)} />
          <Problem text={err} />
        </>
      )}
    </Card>
  );
}

// ── lost the phone or the password code ──────────────────────────────────

function Recover({ needsFile, onOpen, onCancel }: { needsFile: boolean; onOpen: () => void; onCancel?: () => void }) {
  const [seed, setSeed] = useState("");
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [enrol, setEnrol] = useState<Enrol | null>(null);
  const [step, setStep] = useState<"seed" | "phone" | "password">("seed");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pickFile = async () => {
    try {
      const f = await openFile("recovery");
      if (!f) return;
      const v = importVerdict(f.integrity);
      if (!v.ok) return setErr(v.note);
      setFile({ name: f.name, text: decodeText(f.base64) });
      setErr(null);
    } catch (e) {
      setErr(errText(e));
    }
  };
  const begin = async () => {
    setBusy(true);
    try {
      setEnrol(await recoverBegin(seed, file?.text ?? null));
      setStep("phone");
      setErr(null);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const finish = async (password: string) => {
    setBusy(true);
    try {
      await setupFinish(password, []);
      onOpen();
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };

  return (
    <Card title="Let's get you back in" sub="with your seed words — Fluff kept everything safe">
      {step === "seed" && (
        <div className="space-y-3">
          {needsFile && (
            <div className="space-y-1.5 rounded-md border p-2 text-xs">
              <p>
                This computer's lock file is missing, so your <b>recovery file</b> is needed too (<code>tuxcopilot-recovery.age</code>).
              </p>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void pickFile()}>
                {file ? `✓ ${file.name}` : "Choose the recovery file…"}
              </Button>
            </div>
          )}
          <p className="text-sm">Type your seed words from your paper, in order, with spaces between them:</p>
          <textarea
            className="min-h-24 w-full rounded-md border bg-transparent p-2 font-mono text-sm"
            spellCheck={false}
            autoComplete="off"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
          />
          <Problem text={err} />
          <div className="flex gap-2">
            {onCancel && (
              <Button variant="ghost" onClick={onCancel} disabled={busy}>
                Back
              </Button>
            )}
            <Button className="flex-1" disabled={!seed.trim() || (needsFile && !file) || busy} onClick={() => void begin()}>
              {busy ? "Fluff is checking…" : "Open with my seed"}
            </Button>
          </div>
        </div>
      )}
      {step === "phone" && enrol && (
        <>
          <p className="text-xs text-muted-foreground">Your seed opened it. Now set up your device again (the old one stops working):</p>
          <PhoneStep enrol={enrol} onDone={() => setStep("password")} />
        </>
      )}
      {step === "password" && (
        <>
          <PasswordStep note="A new one: the old password code stops working. Your seed words stay the same." onDone={(p) => void finish(p)} />
          <Problem text={err} />
        </>
      )}
    </Card>
  );
}

// ── every start ──────────────────────────────────────────────────────────

function LockScreen({ status, onOpen, onLost }: { status: LockStatus; onOpen: () => void; onLost: () => void }) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      await openLock(code, password);
      setPassword("");
      onOpen();
    } catch (e) {
      setErr(errText(e));
      setCode("");
    } finally {
      setBusy(false);
    }
  };
  const ready = code.length === 6 && password !== "" && !busy;
  return (
    <Card title="Fluff is keeping your data safe" sub="Your 30-second code and your password code, please.">
      <div className="space-y-3">
        <CodeBox value={code} onChange={setCode} autoFocus onEnter={() => ready && void open()} />
        <PasswordBox value={password} onChange={setPassword} onEnter={() => ready && void open()} />
        <Problem text={err} />
        {status.waitSeconds > 0 && <p className="text-xs text-warn">Too many wrong tries: wait {status.waitSeconds} seconds.</p>}
        <Button className="w-full" disabled={!ready} onClick={() => void open()}>
          <Lock className="mr-1.5 h-4 w-4" /> {busy ? "Fluff is opening…" : "Open"}
        </Button>
        <button className="w-full text-center text-xs text-muted-foreground hover:underline" onClick={onLost}>
          Lost your device, or forgot your password code?
        </button>
      </div>
    </Card>
  );
}

// ── a pause while open ───────────────────────────────────────────────────

function Paused({ status, onOpen }: { status: LockStatus; onOpen: () => void }) {
  const [answer, setAnswer] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const byCode = status.pause.unlockWith === "code";
  const go = async () => {
    try {
      await resumeLock(answer);
      setAnswer("");
      onOpen();
    } catch (e) {
      setErr(errText(e));
      setAnswer("");
    }
  };
  return (
    <div className="fixed inset-0 z-[100] bg-background">
      <Card title="Fluff kept your data safe while you were away" sub={byCode ? "Your 30-second code, please." : "Your password code, please."}>
        <div className="space-y-3">
          {byCode ? <CodeBox value={answer} onChange={setAnswer} autoFocus onEnter={() => void go()} /> : <PasswordBox value={answer} onChange={setAnswer} autoFocus onEnter={() => void go()} />}
          <Problem text={err} />
          <Button className="w-full" disabled={!answer} onClick={() => void go()}>
            <Lock className="mr-1.5 h-4 w-4" /> Open
          </Button>
        </div>
      </Card>
    </div>
  );
}

/** Locks itself after `minutes` with no one at the keyboard or the mouse. */
function useIdle(minutes: number, active: boolean, onIdle: () => void) {
  const last = useRef(Date.now());
  useEffect(() => {
    if (!active || minutes <= 0) return;
    const touch = () => (last.current = Date.now());
    const events = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    last.current = Date.now();
    const t = setInterval(() => {
      if (Date.now() - last.current >= minutes * 60_000) onIdle();
    }, 5_000);
    return () => {
      clearInterval(t);
      events.forEach((e) => window.removeEventListener(e, touch));
    };
  }, [minutes, active, onIdle]);
}

export function LockGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LockStatus | null>(null);
  const [lost, setLost] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setStatus(await lockStatus());
    } catch (e) {
      setFailed(errText(e));
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);
  // a wait after wrong tries counts down
  useEffect(() => {
    if (!status?.waitSeconds) return;
    const t = setTimeout(() => void refresh(), 1000);
    return () => clearTimeout(t);
  }, [status, refresh]);

  const pause = useCallback(() => void pauseLock().then(refresh), [refresh]);
  useIdle(status?.pause.afterMinutes ?? 0, !!status?.open && !status.paused, pause);
  useEffect(() => {
    const now = () => void lockNow().then(refresh);
    window.addEventListener(LOCK_NOW_EVENT, now);
    return () => window.removeEventListener(LOCK_NOW_EVENT, now);
  }, [refresh]);

  if (failed) return <Card title="Fluff couldn't reach the lock">{failed}</Card>;
  if (!status) return <Card title="Fluff is waking up…">{null}</Card>;
  if (!status.setUp && status.needsRecovery) return <Recover needsFile onOpen={() => void refresh()} />;
  if (!status.setUp) return <Setup onOpen={() => void refresh()} />;
  if (!status.open && lost) return <Recover needsFile={false} onOpen={() => { setLost(false); void refresh(); }} onCancel={() => setLost(false)} />;
  if (!status.open) return <LockScreen status={status} onOpen={() => void refresh()} onLost={() => setLost(true)} />;
  return (
    <>
      {children}
      {status.paused && <Paused status={status} onOpen={() => void refresh()} />}
    </>
  );
}
