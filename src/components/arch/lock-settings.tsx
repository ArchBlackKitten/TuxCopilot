// Settings → Lock and signing → The lock: when it locks itself, what opens it after a pause, a new
// password code, a new phone, and "lock now". Each change asks for your password code first —
// someone at an unlocked computer cannot change your lock. These are saved at once, not
// staged for Apply: a password code must never sit in the list of pending changes.
import { useEffect, useState } from "react";
import { Cpu, Lock, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { errText } from "@/lib/host";
import { changePassword, codeDigits, grouped, lockStatus, MIN_PASSWORD, newPhoneBegin, newPhoneFinish, passwordLongEnough, qrSrc, setPause, tieLock, type Enrol, type LockStatus } from "@/lib/lock";
import { LOCK_NOW_EVENT } from "./lock-gate";

const MINUTES = [0, 1, 5, 10, 15, 30, 60];

export function LockSettings() {
  const { toast } = useToast();
  const [status, setStatus] = useState<LockStatus | null>(null);
  const [minutes, setMinutes] = useState(10);
  const [unlockWith, setUnlockWith] = useState<"password" | "code">("password");
  const [form, setForm] = useState<null | "password" | "phone" | "tie">(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [enrol, setEnrol] = useState<Enrol | null>(null);
  const [code, setCode] = useState("");

  const load = () =>
    lockStatus().then((s) => {
      setStatus(s);
      setMinutes(s.pause.afterMinutes);
      setUnlockWith(s.pause.unlockWith);
    }, () => {});
  useEffect(() => void load(), []);
  const done = (title: string, description = "") => {
    toast({ title, description });
    setForm(null);
    setCurrent("");
    setNext("");
    setAgain("");
    setEnrol(null);
    setCode("");
    void load();
  };
  const fail = (e: unknown) => toast({ title: "Fluff didn't change it", description: errText(e), variant: "destructive" });

  if (!status) return null;
  const pauseChanged = minutes !== status.pause.afterMinutes || unlockWith !== status.pause.unlockWith;

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center gap-2">
        <Lock className="h-3.5 w-3.5 text-primary" />
        <div className="text-xs font-medium">The lock</div>
        <span className="text-[10px] text-muted-foreground">your data is sealed: TuxCopilot asks for your 30-second code and your password code; the files themselves open with the password code (or the seed)</span>
        <Button size="sm" variant="outline" className="ml-auto h-7 gap-1 px-2 text-[11px]" onClick={() => window.dispatchEvent(new Event(LOCK_NOW_EVENT))}>
          <Lock className="h-3 w-3" /> Lock now
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span>Lock itself after</span>
        <select className="rounded border bg-transparent px-1.5 py-0.5" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
          {MINUTES.map((m) => (
            <option key={m} value={m}>
              {m === 0 ? "never" : `${m} minute${m === 1 ? "" : "s"}`}
            </option>
          ))}
        </select>
        <span>with no one at it; then open it with</span>
        <select className="rounded border bg-transparent px-1.5 py-0.5" value={unlockWith} onChange={(e) => setUnlockWith(e.target.value as "password" | "code")}>
          <option value="password">my password code</option>
          <option value="code">my 30-second code</option>
        </select>
        {pauseChanged && (
          <Button size="sm" className="h-6 px-2 text-[10px]" onClick={() => setPause(minutes, unlockWith).then(() => done("Saved", "Fluff will lock up the way you chose."), fail)}>
            Save
          </Button>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">Closing TuxCopilot always locks it: opening it again asks for both.</p>

      <div className="space-y-1 rounded-md border p-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-2">
          <Cpu className="h-3.5 w-3.5 text-primary" />
          <span className="font-medium">Tied to this computer's security chip (TPM)</span>
          <Badge variant="outline" className={`px-1 py-0 text-[9px] ${status.tied ? "text-ok" : "text-muted-foreground"}`}>{status.tied ? "on" : "off"}</Badge>
          <Button size="sm" variant="outline" className="ml-auto h-6 px-2 text-[10px]" onClick={() => setForm(form === "tie" ? null : "tie")}>
            {status.tied ? "Untie…" : "Tie it…"}
          </Button>
        </div>
        <p className="text-muted-foreground">
          Tied, a copy of TuxCopilot's files can't be opened on any other computer, even with your password code: this computer's chip
          must open it too. Your seed words still open it anywhere — moving house, or if the chip is ever cleared (a BIOS reset, some
          firmware updates, reinstalling Arch). Keep your paper safe.
        </p>
        {form === "tie" && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Input type="password" autoComplete="current-password" placeholder="your password code" value={current} onChange={(e) => setCurrent(e.target.value)} className="h-7 w-56 text-xs" />
            <Button
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={!current}
              onClick={() =>
                tieLock(current, !status.tied).then(
                  () => done(status.tied ? "Fluff untied the lock from this computer" : "Fluff tied the lock to this computer", status.tied ? "Your password code opens it on any computer again." : "A copy of the files opens nowhere else with the password code; your seed words still do."),
                  fail,
                )
              }
            >
              {status.tied ? "Untie it" : "Tie it"}
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setForm(form === "password" ? null : "password")}>
          Change my password code…
        </Button>
        <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setForm(form === "phone" ? null : "phone")}>
          <Smartphone className="h-3 w-3" /> New device…
        </Button>
      </div>

      {form === "password" && (
        <div className="space-y-1.5 rounded-md border p-2">
          <Input type="password" autoComplete="current-password" placeholder="your password code now" value={current} onChange={(e) => setCurrent(e.target.value)} className="h-8 text-xs" />
          <Input type="password" autoComplete="new-password" placeholder="the new one" value={next} onChange={(e) => setNext(e.target.value)} className="h-8 text-xs" />
          <Input type="password" autoComplete="new-password" placeholder="the new one, again" value={again} onChange={(e) => setAgain(e.target.value)} className="h-8 text-xs" />
          {next !== "" && !passwordLongEnough(next) && <p className="text-[11px] text-warn">At least {MIN_PASSWORD} characters ({[...next].length} so far): it opens the files on its own.</p>}
          {again !== "" && next !== again && <p className="text-[11px] text-warn">The two are not the same.</p>}
          <Button size="sm" className="h-7 px-2 text-[11px]" disabled={!current || !passwordLongEnough(next) || next !== again} onClick={() => changePassword(current, next).then(() => done("Your password code is changed", "Your seed words stay the same."), fail)}>
            Change it
          </Button>
        </div>
      )}

      {form === "phone" && (
        <div className="space-y-1.5 rounded-md border p-2">
          {!enrol ? (
            <>
              <p className="text-[11px] text-muted-foreground">Your password code first; then the new device scans a new QR code, and the old device's codes stop working.</p>
              <Input type="password" autoComplete="current-password" placeholder="your password code" value={current} onChange={(e) => setCurrent(e.target.value)} className="h-8 text-xs" />
              <Button size="sm" className="h-7 px-2 text-[11px]" disabled={!current} onClick={() => newPhoneBegin(current).then(setEnrol, fail)}>
                Show the QR code
              </Button>
            </>
          ) : (
            <>
              <img src={qrSrc(enrol.qr)} alt="QR code for your authenticator app" className="h-40 w-40 rounded-md bg-white p-2" />
              <div className="select-all font-mono text-[10px]">{grouped(enrol.secret)}</div>
              <Input inputMode="numeric" placeholder="the 6 digits the new device's app shows" value={code} onChange={(e) => setCode(codeDigits(e.target.value))} className="h-8 font-mono text-xs" />
              <Button size="sm" className="h-7 px-2 text-[11px]" disabled={code.length !== 6} onClick={() => newPhoneFinish(code).then(() => done("Your new device is set", "The old device's codes no longer open TuxCopilot."), fail)}>
                It works
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
