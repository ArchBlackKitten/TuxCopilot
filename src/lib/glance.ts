// Security at a glance: its own section (Settings is only for TuxCopilot's own settings). Each
// protection on one line: how it is now, against what Fluff recommends, and where to change it — a
// panel in one of Security's sub-sections (the firewall is in Network: it is network security). The
// firmware is in System, and in Updates too.
// Each reading may be missing: undefined while Fluff is still looking, null when it couldn't read.
// "look" is only said where Fluff recommends a change; a choice that is yours is "yours".

import type { FirewallState } from "./firewall";
import type { Firmware } from "./firmware";
import { listAge } from "./firmware";
import type { Group } from "./groups";
import { wordsFor } from "./groups";
import type { InputControl } from "./input-control";
import { inputMode, unfinished } from "./input-control";
import type { Failures } from "./logins";
import { failuresSaid } from "./logins";
import type { ScreenLock } from "./screenlock";
import { lockFindings } from "./screenlock";
import type { PackageSecurity } from "./security";
import { summary } from "./security";
import type { StorageControl } from "./storage-control";
import { storageMode } from "./storage-control";
import type { UsbGuard } from "./usbguard";
import type { Recorded } from "./filecheck";
import { presetChanges, presetNow } from "./hardening";

export type GlanceLevel = "good" | "look" | "yours" | "unknown";
import type { SecurityTab } from "@/components/arch/store";
export type GlancePlace = Exclude<SecurityTab, "glance">;

export interface GlanceRow {
  id: string; // the panel's anchor (sec-<id>)
  place: GlancePlace;
  name: string;
  level: GlanceLevel;
  now: string;
  fluff?: string; // what Fluff recommends, when it isn't so now
}

export interface GlanceInput {
  firewall?: FirewallState | null;
  packages?: PackageSecurity[] | null;
  firmware?: Firmware | null;
  input?: InputControl | null;
  storage?: StorageControl | null;
  usbguard?: UsbGuard | null;
  groups?: Group[] | null;
  screen?: ScreenLock | null;
  logins?: Pick<Failures, "failures" | "since"> | null;
  files?: Recorded | "none" | null; // "none": nothing recorded yet
  kernel?: { values: Record<string, string | null>; fileThere: boolean } | null;
}

export const anchorOf = (id: string) => `sec-${id}`;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One reading's row; a missing reading says so instead of guessing. */
function row<T>(id: string, place: GlancePlace, name: string, v: T | null | undefined, said: (v: T) => Omit<GlanceRow, "id" | "place" | "name">): GlanceRow {
  if (v === undefined) return { id, place, name, level: "unknown", now: "Fluff is looking…" };
  if (v === null) return { id, place, name, level: "unknown", now: "Fluff couldn't read it." };
  return { id, place, name, ...said(v) };
}

export function glance(i: GlanceInput, now = Date.now()): GlanceRow[] {
  return [
    row("firewall", "network", "The firewall (the network)", i.firewall, (f) =>
      f.firewalldOn
        ? { level: "good", now: `On (firewalld${f.defaultZone ? `, zone ${f.defaultZone}` : ""}).` }
        : f.ufwOn
          ? { level: "good", now: "On (ufw)." }
          : { level: "look", now: "Off: nothing stops other computers on your network reaching this one.", fluff: "Switch the firewall on (Network)." },
    ),
    row("packages", "system", "Packages with known security problems", i.packages, (p) => {
      const s = summary(p);
      return s.level === "ok" || s.level === "info"
        ? { level: "good", now: s.text }
        : { level: "look", now: s.text, fluff: "Update: the fix is waiting." };
    }),
    row("firmware", "system", "Firmware (BIOS, Secure Boot keys, disks)", i.firmware, (f) => {
      if (!f.available) return { level: "yours", now: "fwupd isn't installed, so Fluff can't see firmware updates." };
      const age = listAge(f, now);
      const old = age !== null && age > 14 && !f.refreshTimer ? ` fwupd's list is ${age} days old.` : "";
      const important = f.updates.filter((u) => u.urgency === "high" || u.urgency === "critical").length;
      if (f.updates.length)
        return {
          level: "look",
          now: `${plural(f.updates.length, "firmware update")} waiting${important ? `, ${important} important` : ""}.${old}`,
          fluff: "Install them (System, or Updates), each said first.",
        };
      return old ? { level: "look", now: `No firmware update offered.${old}`, fluff: "Look for new firmware (System, or Updates)." } : { level: "good", now: "No firmware update waiting." };
    }),
    row("input", "devices", "Programs controlling your keyboard and mouse", i.input, (s) => {
      const m = inputMode(s);
      if (m === "allow") return { level: "look", now: "Allowed: a program can type and click for you without asking.", fluff: "Ask." };
      if (unfinished(s)) return { level: "look", now: "Ask isn't finished: KWin's door still hands them out with no window.", fluff: "Press Ask again." };
      return { level: "good", now: m === "block" ? "Blocked (deny all)." : "Ask: a window asks first." };
    }),
    row("storage", "devices", "USB sticks and SD cards", i.storage, (s) => {
      const m = storageMode(s);
      if (m === "allow") return { level: "look", now: "Allowed: any program can open one, no password.", fluff: "Ask." };
      if (m === null) return { level: "look", now: "Half way: the panel says what is.", fluff: "Choose Allow, Ask or Block again." };
      return { level: "good", now: m === "block" ? "Blocked." : "Ask: opening one needs your password." };
    }),
    row("usbguard", "devices", "New USB devices (USBGuard)", i.usbguard, (u) =>
      u.active
        ? { level: "good", now: `On: a new USB device is blocked until you allow it${u.blocked?.length ? ` (${plural(u.blocked.length, "device")} waiting)` : ""}.${u.enabled ? "" : " Not yet at every start."}` }
        : { level: "yours", now: "Off: a USB stick pretending to be a keyboard would be let in. Your choice." },
    ),
    row("groups", "accounts", "Your groups", i.groups, (gs) => {
      const root = gs.filter((g) => g.listed && wordsFor(g.name).risk === "root").map((g) => g.name);
      return root.length
        ? { level: "look", now: `In ${root.join(", ")}: any program you run can act as root without your password.`, fluff: `Leave ${root.length === 1 ? "it" : "them"} unless you need ${root.length === 1 ? "it" : "them"}.` }
        : { level: "good", now: "No group of yours gives root without a password." };
    }),
    row("screenlock", "accounts", "The screen lock", i.screen, (s) => {
      const warn = lockFindings(s).filter((f) => f.level === "warn");
      return warn.length ? { level: "look", now: warn.map((f) => f.text).join(" "), fluff: warn.flatMap((f) => (f.fix ? [f.fix.label] : [])).join(", ") || undefined } : { level: "good", now: "It locks by itself, after sleep and with the lid, and asks for your password." };
    }),
    row("logins", "accounts", "Wrong passwords", i.logins, (f) => {
      const s = failuresSaid(f);
      return { level: s.level === "ok" ? "good" : s.level === "info" ? "yours" : "look", now: s.text };
    }),
    row("files", "system", "Did anyone change your system files?", i.files, (r) =>
      r === "none"
        ? { level: "look", now: "No fingerprints recorded yet.", fluff: "Record them, so a later change shows." }
        : { level: "yours", now: `Fingerprints recorded ${new Date(r.when).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}: Check compares them (it takes about a minute).` },
    ),
    row("kernel", "system", "The kernel's own protections", i.kernel, (k) => {
      const p = presetNow(k.values, k.fileThere);
      if (p === "recommended" || p === "strict") return { level: "good", now: p === "strict" ? "Strict." : "Recommended." };
      const n = presetChanges(k.values, "recommended").length;
      return { level: "look", now: p === "usual" ? "The usual values." : "A mix of values.", fluff: n ? `Recommended: it changes ${plural(n, "setting")}, at no cost on a desktop.` : "Recommended." };
    }),
  ];
}

/** How many Fluff would change. */
export const toLook = (rows: GlanceRow[]): number => rows.filter((r) => r.level === "look").length;
