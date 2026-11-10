// The "source symbol" next to an app. Clicking opens the app's real page in
// the browser (archlinux.org / AUR / github.com). If a lookup proves the
// source does not exist, the symbol is greyed out and not clickable.

import { openExternal } from "@/lib/host";
import { sourceCheck } from "@/lib/lookups";
import { useEffect, useRef, useState } from "react";
import { Github, Package, Anvil, Bot, Boxes, Box, ExternalLink } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Source } from "@/lib/types";

type Status = "checking" | "found" | "missing" | "error";

const cache = new Map<string, { status: Status; url: string | null }>();

function qFor(source: Source, content: string): string {
  return content.trim();
}

export function SourceLinkIcon({
  source,
  content,
  name,
  className = "h-3.5 w-3.5",
}: {
  source: Source;
  content: string;
  name?: string;
  className?: string;
}) {
  const key = `${source}:${qFor(source, content)}`;
  const cached = cache.get(key);
  const [status, setStatus] = useState<Status>(cached?.status ?? "checking");
  const [url, setUrl] = useState<string | null>(cached?.url ?? null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || cached) return;
    started.current = true;
    let cancelled = false;

    const run = async () => {
      try {
        const data = await sourceCheck(source, qFor(source, content));
        if (cancelled) return;
        const next: { status: Status; url: string | null } = data.url && data.found
          ? { status: "found", url: data.url }
          : { status: "missing", url: null };
        cache.set(key, next);
        setStatus(next.status);
        setUrl(next.url);
      } catch {
        if (!cancelled) setStatus("error");
      }
    };
    // small stagger so a list of 30 apps doesn't fire 30 requests at once
    const jitter = Math.floor(Math.random() * 400);
    const timer = setTimeout(run, jitter);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key]);

  const Icon =
    source === "github" ? Github : source === "pacman" ? Package : source === "ollama" ? Bot : source === "flatpak" ? Boxes : source === "snap" ? Box : Anvil;

  const sourceName =
    source === "github"
      ? "GitHub"
      : source === "pacman"
        ? "official repos"
        : source === "ollama"
          ? "the Ollama library"
          : source === "flatpak"
            ? "Flathub"
            : source === "snap"
              ? "the Snap Store"
              : "the AUR";

  const tooltip =
    status === "checking"
      ? "looking up the source page…"
      : status === "found"
        ? `open ${source} page in browser ↗`
        : status === "missing"
          ? `${name ?? "source"} not found in ${sourceName} — greyed out`
          : "lookup failed (offline?) — try again";

  const greyed = status === "missing";

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            disabled={greyed || status === "checking"}
            onClick={() => {
              if (!url) return;
              void openExternal(url);
            }}
            className={`relative inline-flex items-center justify-center rounded transition-all ${
              greyed
                ? "cursor-not-allowed text-muted-foreground/30"
                : status === "found"
                  ? "cursor-pointer hover:scale-110 hover:text-primary"
                  : "cursor-wait text-muted-foreground/60"
            } ${
              source === "pacman" && !greyed
                ? "text-sky-400"
                : source === "yay" && !greyed
                  ? "text-amber-400"
                  : source === "github" && !greyed
                    ? "text-violet-400"
                    : source === "ollama" && !greyed
                      ? "text-emerald-400"
                      : source === "flatpak" && !greyed
                        ? "text-indigo-400"
                        : source === "snap" && !greyed
                          ? "text-orange-400"
                          : ""
            }`}
            aria-label={tooltip}
          >
            <Icon className={className} />
            {status === "found" && (
              <ExternalLink className="absolute -right-1.5 -top-1.5 h-2 w-2 text-muted-foreground" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[220px] text-xs">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
