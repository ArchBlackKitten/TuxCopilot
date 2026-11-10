// Security: "Did anyone change my system files?" — the packages' recorded SHA-256s, and
// Fluff's own for what no package tracks. It only reads.
import { useState } from "react";
import { FileSearch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { errText } from "@/lib/host";
import {
  CHECK_AS_ROOT, changeKind, compare, getRecorded, KIND_WORDS, knownChange, packageFilesCheck, placeWords, record, reinstallCommand, toLookAt, untrackedFingerprints,
  type Compared, type Fingerprint, type PackageCheck, type Recorded,
} from "@/lib/filecheck";
import { useArch } from "./store";

export function SystemFilesPanel() {
  const { runQuick, dryRun, stageChange, history } = useArch();
  const waiting = history.pending.some((c) => c.kind === "files.recorded");
  const { toast } = useToast();
  const [pkg, setPkg] = useState<PackageCheck | null>(null);
  const [busy, setBusy] = useState<"packages" | "fluff" | null>(null);
  const [fp, setFp] = useState<{ now: Fingerprint[]; recorded: Recorded | null; diff: Compared | null } | null>(null);
  const fail = (e: unknown) => toast({ title: "Fluff couldn't check", description: errText(e), variant: "destructive" });
  const checkPackages = async () => {
    setBusy("packages");
    try {
      setPkg(await packageFilesCheck());
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const checkFluff = async () => {
    setBusy("fluff");
    try {
      const [now, recorded] = await Promise.all([untrackedFingerprints(), getRecorded()]);
      setFp({ now, recorded, diff: recorded ? compare(recorded, now) : null });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  // every edit waits for Apply: the record is a change in your list, saved when you apply it
  const keep = () => {
    if (!fp) return;
    stageChange({ kind: "files.recorded", label: `Fluff's fingerprints: ${fp.now.length} files recorded`, value: record(fp.now) });
  };
  const look = pkg ? toLookAt(pkg.changed) : [];
  const unknown = look.filter((c) => !knownChange(c.path));
  const settings = pkg ? pkg.changed.filter((c) => c.settings).length : 0;

  return (
    <div className="space-y-1.5 rounded-md border p-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <FileSearch className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium">Did anyone change my system files?</span>
        <span className="text-muted-foreground">(it only reads)</span>
      </div>

      <div className="space-y-1 border-t pt-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">1. Against the packages' own fingerprints</span>
          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={!!busy} onClick={() => void checkPackages()}>
            {busy === "packages" ? "Checking every installed file… (about a minute)" : pkg ? "Check again" : "Check every installed file"}
          </Button>
        </div>
        <p className="text-muted-foreground">Every package recorded a SHA-256 for each of its files; Fluff compares them with what is on the disk now.</p>
        {pkg && (
          <>
            <p>
              {pkg.packages} packages checked. <span className={unknown.length ? "text-warn" : "text-ok"}>{unknown.length ? `${unknown.length} program file${unknown.length === 1 ? "" : "s"} to look at` : "No program file changed that Fluff can't explain"}</span>
              {settings > 0 && <span className="text-muted-foreground"> · {settings} settings files you or a tool changed (that is what they are for)</span>}
            </p>
            {look.map((c) => {
              const why = knownChange(c.path);
              return (
                <div key={c.path} className="flex flex-wrap items-start gap-1.5 border-t border-border/40 pt-1">
                  <Badge variant="outline" className={`px-1 py-0 text-[9px] ${why ? "text-muted-foreground" : "text-warn border-warn/40"}`}>{why ? "known" : "look"}</Badge>
                  <div className="min-w-0 flex-1">
                    <code className="font-mono">{c.path}</code> <span className="text-muted-foreground">({c.package}) — {KIND_WORDS[changeKind(c)]}.</span>
                    {why && <span className="text-muted-foreground"> Fine: {why}</span>}
                  </div>
                </div>
              );
            })}
            {unknown.length > 0 && (
              <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => void runQuick("Put program files back", reinstallCommand(unknown.map((c) => c.package)), dryRun)}>
                Put them back as their packages have them
              </Button>
            )}
            {pkg.unreadable > 0 && (
              <p className="text-muted-foreground">
                {pkg.unreadable} files only root may read weren't checked as you.{" "}
                <button className="underline" onClick={() => void runQuick("Check root's files too", CHECK_AS_ROOT, dryRun)}>
                  Check them as root
                </button>
              </p>
            )}
          </>
        )}
      </div>

      <div className="space-y-1 border-t pt-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">2. Against Fluff's own fingerprints</span>
          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={!!busy} onClick={() => void checkFluff()}>
            {busy === "fluff" ? "Fingerprinting…" : "Compare"}
          </Button>
        </div>
        <p className="text-muted-foreground">
          For what no package tracks — where something planted would hide: files in /etc and /usr/local no package owns, and the files that run when you
          log in. Fluff records their SHA-256s in your locked database, and tells you what changed since.
        </p>
        {fp && !fp.recorded && (
          <p>
            Fluff has no record yet: {fp.now.length} files found.{" "}
            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={keep}>
              Record them as they are now
            </Button>
          </p>
        )}
        {fp?.recorded && fp.diff && (
          <>
            <p>
              Recorded {fp.recorded.when.slice(0, 16).replace("T", " ")}.{" "}
              {fp.diff.added.length + fp.diff.changed.length + fp.diff.removed.length === 0 ? (
                <span className="text-ok">Nothing changed since.</span>
              ) : (
                <span className="text-warn">
                  {fp.diff.changed.length} changed, {fp.diff.added.length} new, {fp.diff.removed.length} gone.
                </span>
              )}
            </p>
            {(["changed", "added", "removed"] as const).flatMap((k) =>
              fp.diff![k].slice(0, 50).map((p) => (
                <div key={`${k}${p}`} className="border-t border-border/40 pt-1">
                  <Badge variant="outline" className="mr-1 px-1 py-0 text-[9px]">{k === "added" ? "new" : k === "removed" ? "gone" : "changed"}</Badge>
                  <code className="font-mono">{p}</code> <span className="text-muted-foreground">— {placeWords(p)}</span>
                </div>
              )),
            )}
            {fp.diff.added.length + fp.diff.changed.length + fp.diff.removed.length > 0 && (
              <p className="text-muted-foreground">
                If you know each one (an update, something you installed or edited), record them again.{" "}
                <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={keep}>
                  They're mine: record them as they are now
                </Button>
              </p>
            )}
          </>
        )}
        {waiting && <p className="text-info">Your new record waits in your changes: Apply saves it.</p>}
      </div>
    </div>
  );
}
