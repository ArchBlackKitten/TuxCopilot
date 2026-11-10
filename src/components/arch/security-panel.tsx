// Settings → Lock and signing: TuxCopilot's own safety — what keeps your exports trustworthy (every
// export travels with its SHA-256 checksum; a GPG signature adds who made it), and the lock
// (lock-settings). The computer's protections are their own section, Security (security-view).
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { gpgKeys } from "@/lib/integrity";
import { useArch } from "./store";
import { LockSettings } from "./lock-settings";

export function LockAndSigningPanel() {
  const { signWith, setSignWith } = useArch();
  const [keys, setKeys] = useState<Array<{ fingerprint: string; user: string }> | null>(null);
  useEffect(() => {
    gpgKeys().then(setKeys, () => setKeys([]));
  }, []);
  const chosen = keys?.find((k) => k.fingerprint === signWith);
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Lock and signing</h2>
        <span className="text-[11px] text-muted-foreground">TuxCopilot's own: the computer's protections are in Security</span>
      </div>
      <div className="space-y-1.5">
        <div className="text-xs font-medium">Sign what you export</div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Every file TuxCopilot saves (backups, Fluff's belongings, looks, colour schemes, usage lists) gets its SHA-256 checksum beside it
          (<code>.sha256</code>), and every file it opens is checked against one. A checksum shows a file arrived unchanged, but
          not who made it: whoever changes a file can change its checksum too. A <b>GPG signature</b> (<code>.asc</code>) shows
          both, and only you can make yours. Recommended.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setSignWith(null, "Exports: not signed")}
            className={`rounded-md border px-2.5 py-1 text-[11px] ${signWith === null ? "border-primary/60 bg-primary/10" : "hover:bg-accent/40"}`}
          >
            Don't sign
          </button>
          {(keys ?? []).map((k) => (
            <button
              key={k.fingerprint}
              onClick={() => setSignWith(k.fingerprint, `Exports: signed by ${k.user || k.fingerprint.slice(-16)}`)}
              className={`rounded-md border px-2.5 py-1 text-left text-[11px] ${signWith === k.fingerprint ? "border-primary/60 bg-primary/10" : "hover:bg-accent/40"}`}
            >
              <div>{k.user || "(no name)"}</div>
              <div className="font-mono text-[9px] text-muted-foreground">{k.fingerprint.replace(/(.{4})/g, "$1 ").trim()}</div>
            </button>
          ))}
        </div>
        {keys !== null && keys.length === 0 && (
          <p className="text-[11px] text-muted-foreground">
            No GPG key of yours was found. To make one, run <code>gpg --full-generate-key</code> in a terminal (the defaults are good),
            then come back here.
          </p>
        )}
        {signWith && !chosen && keys !== null && <p className="text-[11px] text-amber-300">The chosen key is no longer in your keyring: exports are saved unsigned.</p>}
        {chosen && <p className="text-[10px] text-muted-foreground">gpg asks for your key's passphrase when a file is signed.</p>}
      </div>
      <LockSettings />
    </section>
  );
}
