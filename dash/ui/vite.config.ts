import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Builds ONE self-contained HTML file (JS, CSS and fonts inlined) that the Worker serves as page.html.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { assetsInlineLimit: 100_000_000, cssCodeSplit: false, outDir: "dist", emptyOutDir: true },
});
