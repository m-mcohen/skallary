import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const devPort = 1420;
const apiOrigin = "http://127.0.0.1:4321";
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  build: {
    // vendor-ag-grid (~1 MB) is real and inherent to AG-Grid itself, but it's
    // lazy-loaded (App.tsx's React.lazy(() => import("./BudgetGrid"))) and
    // never part of the initial page load, so it shouldn't trip the same
    // "you shipped a >500kB chunk on first paint" warning that mattered
    // before this pass. The default 500 kB warning is still useful for the
    // chunks that DO load on first paint (index + vendor, ~647 kB combined).
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        // Polish pass (bundle-size fix): App.tsx's React.lazy() split keeps
        // AG-Grid/Recharts out of the initial route chunk, but their shared
        // vendor code would otherwise still land wherever it's first
        // imported unless pulled into its own named chunk here -- so split
        // the two big third-party libraries out individually; everything
        // else (react/react-dom included) stays in the generic "vendor"
        // bucket. react/react-dom were tried as their own chunk too, but
        // that produced a "Circular chunk: vendor -> vendor-react -> vendor"
        // warning (shared UI deps like @base-ui/react import react, and
        // react-dom's own graph touches shared helpers back in "vendor") --
        // not worth it since react/react-dom are needed on first paint
        // regardless of chunking, so splitting them out doesn't reduce the
        // initial download anyway.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("ag-grid")) return "vendor-ag-grid";
          return "vendor";
        },
      },
    },
  },

  server: {
    port: devPort,
    strictPort: true,
    cors: false,
    proxy: {
      "/api": {
        target: apiOrigin,
        configure(proxy) {
          proxy.on("proxyReq", (outgoing, incoming) => {
            const host = incoming.headers.host?.toLowerCase();
            const local = host === `localhost:${devPort}` || host === `127.0.0.1:${devPort}`;
            // Preserve same-origin writes across the local development proxy.
            if (!local) return;
            outgoing.setHeader("Host", new URL(apiOrigin).host);
            if (incoming.headers.origin === `http://${host}`) outgoing.setHeader("Origin", apiOrigin);
          });
        },
      },
    },
  },
}));
