// Troubleshoot: a plain report for a helper (report.ts). Made only
// when you press it, shown whole before anything else, then saved (with its checksum, like every
// export) or copied: you choose who gets it.
import { useState } from "react";
import { ClipboardCopy, FileText, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { errText } from "@/lib/host";
import { saveFile, savedNote, exportSigner } from "@/lib/integrity";
import { loadSystemProfile } from "@/lib/system-profile";
import { bootFacts } from "@/lib/boot";
import { updatesFacts } from "@/lib/updates";
import { runCheckup } from "@/lib/checkup";
import { servicesList } from "@/lib/services";
import { glance } from "@/lib/glance";
import { helperReport, reportNames } from "@/lib/report";
import { readGlance } from "./security-view";
import { readLevels } from "./level-sections";

const nul = <T,>(p: Promise<T>) => p.catch(() => null);

/** Every reading the report needs, read now; a failed one is said in the report, never guessed. */
export async function makeReport(now = new Date()): Promise<string> {
  const [names, profile, boot, updates, checkup, services, g, levels] = await Promise.all([
    reportNames(),
    nul(loadSystemProfile(true)),
    nul(bootFacts()),
    nul(updatesFacts()),
    nul(runCheckup()),
    nul(servicesList()),
    readGlance(),
    readLevels().catch(() => ({})),
  ]);
  return helperReport({ profile, boot, updates, checkup, services, glance: glance(g), levels }, names, now);
}

export function ReportPanel() {
  const { toast } = useToast();
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try {
      setText(await makeReport());
    } catch (e) {
      // without the names to leave out, no report is shown at all
      toast({ title: "Fluff couldn't make the report", description: errText(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!text) return;
    try {
      const s = await saveFile(`tuxcopilot-report-${new Date().toISOString().slice(0, 10)}.md`, text);
      if (s) toast({ title: "Report saved", description: savedNote(s, exportSigner()) });
    } catch (e) {
      toast({ title: "Fluff couldn't save it", description: errText(e), variant: "destructive" });
    }
  };
  const copy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied", description: "Paste it where your helper asked for it." });
    } catch (e) {
      toast({ title: "Fluff couldn't copy it", description: `${errText(e)} — save it instead.`, variant: "destructive" });
    }
  };
  return (
    <section data-guide="report" className="space-y-2 rounded-md border bg-card p-3 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="h-4 w-4 text-primary" />
        <h3 className="text-xs font-semibold">A report for a helper</h3>
        <span className="text-muted-foreground">— when you ask for help on a forum or from a friend, they first ask how your computer stands</span>
      </div>
      <p className="text-muted-foreground">
        It says how things are, never a secret: no passwords, keys or settings files, no journal lines, and no names of people, computers or networks, and no addresses. Nothing is sent: you read it here first, then save it or copy it.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void make()}>
          {busy ? "Fluff is looking…" : text ? "Make it again" : "Make the report"}
        </Button>
        {text && (
          <>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => void save()}>
              <Save className="h-3 w-3" /> Save it…
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => void copy()}>
              <ClipboardCopy className="h-3 w-3" /> Copy
            </Button>
          </>
        )}
      </div>
      {text && <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-2 font-mono text-[10px] leading-relaxed">{text}</pre>}
    </section>
  );
}
