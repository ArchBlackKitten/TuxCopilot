// Apps → "Is it safe to remove…?": type a package name, see whether it is part of the core
// system the app learned (Settings) — the same rule that keeps it out of every removal plan.
import { useState } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { protectedReason } from "@/lib/protected";

export function SafeToRemove() {
  const [query, setQuery] = useState("");
  const check = query.trim();
  const verdict = check ? protectedReason(check) : null;
  return (
    <section className="rounded-md border bg-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Is it safe to remove…?</h2>
      </div>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="type a package name, e.g. vlc or linux-firmware"
        className="h-8 font-mono text-xs"
      />
      {check && (
        <p className={`mt-2 flex items-start gap-1.5 text-xs ${verdict ? "text-red-400" : "text-emerald-400"}`}>
          {verdict ? <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          {verdict ? (
            <span>
              <span className="font-mono">{check}</span> is part of your system: {verdict}. Leave it installed.
            </span>
          ) : (
            <span>
              <span className="font-mono">{check}</span> is not part of the core system. pacman will still refuse to
              remove it if another package needs it.
            </span>
          )}
        </p>
      )}
    </section>
  );
}
