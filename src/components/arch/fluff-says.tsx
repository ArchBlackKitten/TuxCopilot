// Fluff's advice, always looking the same wherever it appears: Fluff's face, "Fluff
// recommends", and what to do — so a recommendation is never mistaken for a plain note.
import type { ReactNode } from "react";
import { iconUrl } from "@/lib/look-runtime";
import { useArch } from "./store";

export function FluffSays({ children, title = "Fluff recommends", action }: { children: ReactNode; title?: string; action?: ReactNode }) {
  const icon = useArch((s) => s.look.icon);
  return (
    <div className="flex items-start gap-2 rounded-md border border-primary/40 bg-primary/5 p-2">
      <img src={iconUrl(icon)} alt="" className="h-7 w-7 shrink-0" />
      <div className="min-w-0 flex-1 text-[11px] leading-relaxed">
        <div className="text-[10px] font-semibold text-primary">{title}</div>
        <div>{children}</div>
        {action && <div className="mt-1.5">{action}</div>}
      </div>
    </div>
  );
}
