// Where each page was scrolled. Somewhere new opens at the top; Back and Forward return to
// where you were on that page, as in a browser.

export class ScrollMemory {
  private tops = new Map<string, number>();
  remember(place: string, top: number): void {
    this.tops.set(place, top);
  }
  /** Where to scroll when arriving at `place`. */
  target(place: string, move: "go" | "back" | "forward"): number {
    return move === "go" ? 0 : (this.tops.get(place) ?? 0);
  }
}
