// TuxCopilot's tag: on everything that is TuxCopilot's own — its ports, its services, its files —
// so nothing it put on your computer looks like a stranger.
import { iconUrl } from "@/lib/look-runtime";

export function TuxTag({ why }: { why: string }) {
  return (
    <span title={why} className="inline-flex shrink-0 items-center gap-0.5 rounded border border-primary/40 bg-primary/10 px-1 text-[9px] font-medium text-primary">
      <img src={iconUrl(null)} alt="" className="h-2.5 w-2.5" /> TuxCopilot
    </span>
  );
}
