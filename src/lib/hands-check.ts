// "Can you still type and click?" — a timed test, so a change can't leave you with nothing to press
// "Ask" with. After a change that
// could take your keyboard or mouse away (Block, USBGuard), Fluff shows a word: type it, then click
// the circle. Not done in time — or "Go back now" — and Fluff undoes the change by itself, with the
// command it showed you in the window. A program that fakes typing can't pass it: those doors are
// the ones just shut.

export interface HandsCheck {
  title: string;
  what: string; // what goes back if you don't pass
  undoLabel: string;
  undo: string; // shown in the window before it can run
  word: string;
  deadline: number; // ms since epoch
  done: (passed: boolean) => void;
}

export const HANDS_SECONDS = 30;

// short, plain, no letters that look alike (l / I / 1, O / 0)
const WORDS = ["fluff", "penguin", "snow", "tux", "arch", "kitten", "pebble", "maple", "river", "cloud", "ember", "mango"];

export const pickWord = (rand: () => number = Math.random): string => WORDS[Math.floor(rand() * WORDS.length) % WORDS.length];

/** Typed as shown (spaces around it and capitals don't matter). */
export const typedRight = (typed: string, word: string): boolean => typed.trim().toLowerCase() === word.toLowerCase();

export const secondsLeft = (deadline: number, now: number): number => Math.max(0, Math.ceil((deadline - now) / 1000));
