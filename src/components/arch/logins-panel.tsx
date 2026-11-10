// Security: wrong passwords — sudo, su, the login and lock screens, password windows, SSH.
import { useCallback, useEffect, useState } from "react";
import { KeySquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { errText } from "@/lib/host";
import { failuresSaid, keepJournalCommand, loginFailures, PLACE_WORDS, type Failures } from "@/lib/logins";
import { useArch } from "./store";

const TONE = { ok: "text-ok", info: "text-info", warn: "text-warn", bad: "text-bad" } as const;

export function LoginsPanel() {
  const { runQuick, dryRun, machineVersion } = useArch();
  const { toast } = useToast();
  const [f, setF] = useState<Failures | null>(null);
  const load = useCallback(() => void loginFailures(30).then(setF, () => setF(null)), []);
  useEffect(load, [load, machineVersion]);
  if (!f) return null;
  const said = failuresSaid(f);
  const short = f.since ? (Date.now() - new Date(f.since.replace(" ", "T")).getTime()) / 86400000 < 21 : false;
  return (
    <div className="space-y-1 rounded-md border p-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <KeySquare className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium">Wrong passwords</span>
        <span className="text-muted-foreground">(sudo, the login and lock screens, password windows, SSH)</span>
      </div>
      <p className={TONE[said.level]}>{said.text}</p>
      {f.failures.slice(-20).reverse().map((x, i) => (
        <div key={i} className="text-muted-foreground">
          {x.when.replace("T", " ").slice(0, 16)} — {PLACE_WORDS[x.place] ?? x.place}
          {x.user && `, for ${x.user}`}
          {x.from && `, from ${x.from}`}
        </div>
      ))}
      {short && (
        <p className="text-muted-foreground">
          The journal keeps only a few days here (50 MB).{" "}
          <button
            className="underline"
            onClick={() =>
              void runQuick("Keep a month of the journal", keepJournalCommand(), dryRun).then((e) => {
                if (e) toast({ title: "Fluff couldn't finish", description: errText(e), variant: "destructive" });
                load();
              })
            }
          >
            Keep a month (up to 500 MB)
          </button>
        </p>
      )}
    </div>
  );
}
