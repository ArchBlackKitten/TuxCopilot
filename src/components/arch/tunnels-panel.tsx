// Fluff dismantles the myths about VPNs, Tor and the web, under the Firewall (tunnels.ts): how each
// works, each myth with what's true (the tunnels', then the web's), then which one when.
// Words only: nothing here runs anything.
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { TUNNEL_PARTS, TUNNELS_IN_ONE, type TunnelPart } from "@/lib/tunnels";
import { FluffSays } from "./fluff-says";
import { useArch } from "./store";

export function TunnelsPanel({ vpns }: { vpns: string[] | null }) {
  const setView = useArch((s) => s.setView);
  const [open, setOpen] = useState<string | null>(null);
  const fold = (p: TunnelPart) => (
    <div key={p.id} className="px-3 py-1.5">
      <button className="flex w-full items-center gap-1.5 text-left text-xs font-medium" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
        {open === p.id ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        {p.kind === "myth" && (
          <Badge variant="outline" className="border-warn/50 px-1 py-0 text-[9px] text-warn">
            myth
          </Badge>
        )}
        <span>{p.kind === "myth" ? `“${p.title}”` : p.title}</span>
      </button>
      {open === p.id && (
        <div className="mt-1 ml-5 space-y-0.5">
          {p.kind === "myth" && <div className="text-[10px] font-semibold text-ok">What's true</div>}
          <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-muted-foreground">
            {p.points.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
  const group = (keep: (p: TunnelPart) => boolean) => <div className="divide-y divide-border/60 overflow-hidden rounded-md border">{TUNNEL_PARTS.filter(keep).map(fold)}</div>;
  return (
    <section className="space-y-2 rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-semibold">VPN, Tor and the web: Fluff dismantles the myths</span>
        <span className="text-[11px] text-muted-foreground">a VPN isn't Wi-Fi protection, and a private window doesn't hide you</span>
      </div>
      <FluffSays title="Fluff explains">
        {TUNNELS_IN_ONE}
        {vpns && vpns.length > 0 && (
          <span className="mt-1 block">
            You're on a VPN now ({vpns.join(", ")}): what you send goes through its tunnel, and this computer is still on the network you're on.
          </span>
        )}
      </FluffSays>
      {group((p) => p.kind === "how")}
      <div className="text-[11px] font-medium">The myths: VPN and Tor</div>
      {group((p) => p.kind === "myth" && p.about === "tunnel")}
      <div className="text-[11px] font-medium">The myths: the web</div>
      {group((p) => p.kind === "myth" && p.about === "web")}
      {group((p) => p.kind === "which")}
      <p className="text-[10px] text-muted-foreground">
        Tor on this computer — its connection, bridges and settings — is in the{" "}
        <button className="text-primary hover:underline" onClick={() => setView("tor")}>
          Tor section
        </button>
        .
      </p>
    </section>
  );
}
