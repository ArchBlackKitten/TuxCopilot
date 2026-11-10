import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

/**
 * The dev preview (localhost:5173, started by `npm run tauri dev`) stops itself when no window
 * has been connected to it for a while — after a crash, or a terminal closed the wrong way, it
 * would otherwise keep running unseen. TUXCOPILOT_DEV_IDLE_MINUTES sets how long (0: never).
 */
function stopWhenUnused(): Plugin {
  const minutes = Number(process.env.TUXCOPILOT_DEV_IDLE_MINUTES ?? 5);
  return {
    name: "tuxcopilot-stop-when-unused",
    apply: "serve",
    configureServer(server) {
      if (!(minutes > 0)) return;
      let windows = 0;
      let timer: NodeJS.Timeout | null = null;
      const arm = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          server.config.logger.info(`\nNo TuxCopilot window for ${minutes} min: the dev preview stops itself.`);
          void server.close().finally(() => process.exit(0));
        }, minutes * 60_000);
      };
      server.ws.on("connection", (socket) => {
        windows++;
        if (timer) clearTimeout(timer);
        timer = null;
        socket.on("close", () => {
          windows--;
          if (windows === 0) arm();
        });
      });
      server.httpServer?.once("listening", arm); // no window ever came: stop too
    },
  };
}

// Tauri expects a fixed dev port and must see Rust-side errors, so the screen is not cleared.
export default defineConfig({
  plugins: [react(), tailwindcss(), stopWhenUnused()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  clearScreen: false,
  // this computer only: the preview is never reachable from your network
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  build: { target: "es2022", outDir: "dist" },
});
