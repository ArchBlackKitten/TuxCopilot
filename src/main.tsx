import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./globals.css";
import App from "./App";
import { LockGate } from "@/components/arch/lock-gate";
import { Toaster } from "@/components/ui/toaster";
import { openExternal } from "@/lib/host";

// A webview has no tabs: every off-site link (README links, source pages) goes to the
// desktop browser instead of replacing the app.
document.addEventListener("click", (e) => {
  const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a) return;
  if (/^https?:\/\//i.test(a.href) && new URL(a.href).origin !== window.location.origin) {
    e.preventDefault();
    void openExternal(a.href);
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LockGate>
      <App />
    </LockGate>
    <Toaster />
  </StrictMode>
);
