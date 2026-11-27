import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath } from "node:url";

const demo = process.env.VITE_DEMO === "1";

// Builds ONE self-contained HTML file (JS, CSS and fonts inlined) that the Worker serves as page.html.
// Demo builds (sample data, used for screenshots and the public demo) swap in an original notebook cover.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: { "@cover": fileURLToPath(new URL(demo ? "./src/assets/cover-demo.ts" : "./src/assets/cover.ts", import.meta.url)) },
  },
  build: { assetsInlineLimit: 100_000_000, cssCodeSplit: false, outDir: "dist", emptyOutDir: true },
});
