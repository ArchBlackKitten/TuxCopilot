// Every mention of an app opens its page. A span with role="link" rather than a button, so it
// can sit inside rows that are buttons themselves; its click does not reach the row.
import { Fragment } from "react";
import { useArch } from "./store";
import { TuxTag } from "./tux-tag";
import { tuxPackage } from "@/lib/tux-own";

export function AppLink({ name, source = "pacman", className = "" }: { name: string; source?: string; className?: string }) {
  const { openAppPage } = useArch();
  const open = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
    openAppPage(name, source);
  };
  const tux = tuxPackage(name);
  const link = (
    <span
      role="link"
      tabIndex={0}
      title={`${name}: how it works, what it needs, what you can change`}
      className={`cursor-pointer font-mono underline-offset-2 hover:text-primary hover:underline ${className}`}
      onClick={open}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && open(e)}
    >
      {name}
    </span>
  );
  return tux ? (
    <span className="inline-flex items-center gap-1">
      {link}
      <TuxTag why={tux} />
    </span>
  ) : (
    link
  );
}

/** "a, b, c" with each name a link. */
export function AppLinks({ names, source, sep = ", " }: { names: string[]; source?: string; sep?: string }) {
  return (
    <>
      {names.map((n, i) => (
        <Fragment key={n}>
          {i > 0 && sep}
          <AppLink name={n} source={source} />
        </Fragment>
      ))}
    </>
  );
}
