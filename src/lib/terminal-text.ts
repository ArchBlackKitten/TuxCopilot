// What a terminal would show: a line that redraws itself with \r (a progress bar, a download
// counter) shows only its latest state.
export function screen(text: string): string {
  if (!text.includes("\r")) return text;
  return text
    .split("\n")
    .map((line) => {
      const parts = line.split("\r");
      // a trailing \r with nothing after it has not been redrawn yet
      for (let i = parts.length - 1; i >= 0; i--) if (parts[i] !== "") return parts[i];
      return "";
    })
    .join("\n");
}
