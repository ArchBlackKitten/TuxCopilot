// Security: your groups — what each gives away; ✗ to leave (after Fluff says what happens
// without it), ✓ to join. Groups you can't leave have no switch.
import { useCallback, useEffect, useState } from "react";
import { Check, KeyRound, Lock, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { errText } from "@/lib/host";
import { groupCommand, groupState, myGroups, neededWhy, needsPassword, RISK_WORDS, sortGroups, wordsFor, type Group } from "@/lib/groups";
import { useArch } from "./store";

const TONE = { root: "text-bad border-bad/40", admin: "text-warn border-warn/40", private: "text-warn border-warn/40", plain: "text-muted-foreground" } as const;

export function GroupsPanel() {
  const { runQuick, dryRun, machineVersion } = useArch();
  const { toast } = useToast();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [pick, setPick] = useState("");
  const [leaving, setLeaving] = useState<Group | null>(null);
  const load = useCallback(() => void myGroups().then(setGroups, () => setGroups(null)), []);
  useEffect(load, [load, machineVersion]);
  if (!groups?.length) return null;
  const { mine, others } = sortGroups(groups);
  const run = async (g: Group, add: boolean) => {
    const label = add ? `Into the ${g.name} group` : `Out of the ${g.name} group`;
    let command: string;
    try {
      command = groupCommand(g, add);
    } catch (e) {
      return toast({ title: "Fluff didn't run it", description: errText(e), variant: "destructive" });
    }
    const err = await runQuick(label, command, dryRun);
    if (err) toast({ title: `Fluff couldn't finish: ${label}`, description: errText(err), variant: "destructive" });
    load();
  };
  const chosen = others.find((g) => g.name === pick);
  const Row = ({ g }: { g: Group }) => {
    const w = wordsFor(g.name);
    const needed = neededWhy(g);
    return (
      <div className="flex flex-wrap items-start gap-2 border-t pt-1.5">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <code className="font-mono">{g.name}</code>
            <Badge variant="outline" className={`px-1 py-0 text-[9px] ${TONE[w.risk]}`}>{RISK_WORDS[w.risk]}</Badge>
            <span className="text-muted-foreground">{groupState(g)}</span>
          </div>
          <p className="text-muted-foreground">{w.gives}</p>
          {needed && <p className="text-muted-foreground">Needed: {needed}</p>}
        </div>
        {needed ? (
          <span title={`Needed: ${needed}`} className="flex h-6 w-6 items-center justify-center text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
          </span>
        ) : g.listed ? (
          <div className="flex items-center gap-1">
            <Check className="h-3.5 w-3.5 text-ok" aria-label="you are in it" />
            <Button size="sm" variant="outline" className="h-6 w-6 p-0" title={`Leave ${g.name}`} aria-label={`Leave ${g.name}`} onClick={() => setLeaving(g)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="h-6 w-6 p-0" title={`Back into ${g.name}`} aria-label={`Back into ${g.name}`} onClick={() => void run(g, true)}>
            <Check className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );
  };
  return (
    <div className="space-y-1.5 rounded-md border p-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium">Your groups</span>
        <span className="text-muted-foreground">(what each one lets the programs you run do; a change counts from your next login)</span>
      </div>
      {mine.map((g) => (
        <Row key={g.name} g={g} />
      ))}
      <div className="flex flex-wrap items-center gap-2 border-t pt-1.5">
        <span>Join a group:</span>
        <select value={pick} onChange={(e) => setPick(e.target.value)} className="rounded border bg-background px-1 py-0.5 text-[11px]">
          <option value="">a group…</option>
          {others.map((g) => (
            <option key={g.name} value={g.name}>
              {g.name} — {RISK_WORDS[wordsFor(g.name).risk]}
            </option>
          ))}
        </select>
        {chosen && (
          <Button size="sm" variant="outline" className="h-6 w-6 p-0" title={`Join ${chosen.name}`} aria-label={`Join ${chosen.name}`} onClick={() => void run(chosen, true)}>
            <Check className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {chosen && (
        <p className="text-muted-foreground">
          {wordsFor(chosen.name).gives}
          {needsPassword(chosen.name) && " Joining it needs an administrator's password."}
        </p>
      )}

      <AlertDialog open={!!leaving} onOpenChange={(o) => !o && setLeaving(null)}>
        {leaving && (
          <AlertDialogContent className="max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>Leave the {leaving.name} group?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-xs text-foreground">
                  <p>
                    <span className="font-medium">What it gives you now:</span> {wordsFor(leaving.name).gives}
                  </p>
                  <p>
                    <span className="font-medium">What happens without it:</span> {wordsFor(leaving.name).without}
                  </p>
                  {needsPassword(leaving.name) && <p className="text-warn">Changing wheel needs an administrator's password, typed now — even if you typed it a moment ago.</p>}
                  <p className="text-muted-foreground">It counts from your next login{leaving.name === "wheel" ? " (sudo, at once)" : ""}. You can join it again here.</p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Stay in it</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const g = leaving;
                  setLeaving(null);
                  void run(g, false);
                }}
              >
                Leave {leaving.name}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </div>
  );
}
