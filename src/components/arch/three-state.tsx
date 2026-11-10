// On / Off / Dead — one control for apps and for a port's service.
//   On    running
//   Off   stopped for now; starts again at the next restart (or login)
//   Dead  stopped and kept from starting until you choose On
// The highlighted state is read from the machine, not remembered: if something starts or
// re-enables it, the control shows that.
export type Three = "on" | "off" | "dead";

const META: Record<Three, { label: string; hint: string; on: string }> = {
  on: { label: "On", hint: "running", on: "border-emerald-500/60 bg-emerald-500/15 text-emerald-300" },
  off: { label: "Off", hint: "stopped for now — starts again at the next restart", on: "border-amber-500/60 bg-amber-500/15 text-amber-300" },
  dead: { label: "Dead", hint: "stopped, and kept from starting until you choose On", on: "border-red-500/60 bg-red-500/15 text-red-300" },
};

export function ThreeState({
  value,
  onPick,
  pending = false,
  unavailable = {},
  size = "sm",
}: {
  value: Three;
  onPick: (to: Three) => void;
  pending?: boolean;
  /** states that can't be chosen here, with why (shown on hover) */
  unavailable?: Partial<Record<Three, string>>;
  size?: "sm" | "xs";
}) {
  const pad = size === "xs" ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-[11px]";
  return (
    <span className="inline-flex overflow-hidden rounded-md border" role="radiogroup" aria-label="On, Off or Dead">
      {(["on", "off", "dead"] as Three[]).map((s) => {
        const why = unavailable[s];
        const current = s === value;
        return (
          <button
            key={s}
            role="radio"
            aria-checked={current}
            disabled={pending || !!why || current}
            title={why ?? (current ? `${META[s].label}: ${META[s].hint}` : `make it ${META[s].label}: ${META[s].hint}`)}
            onClick={() => onPick(s)}
            className={`${pad} border-r last:border-r-0 transition-colors ${
              current ? META[s].on : why ? "cursor-not-allowed text-muted-foreground/40" : "text-muted-foreground hover:bg-accent/50"
            } ${pending ? "opacity-60" : ""}`}
          >
            {META[s].label}
          </button>
        );
      })}
    </span>
  );
}
