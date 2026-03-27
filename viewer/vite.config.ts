import path from "path";
import fs from "fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// Copy index.html to 404.html so GitHub Pages serves the SPA for all routes
function githubPages404(): Plugin {
  return {
    name: "github-pages-404",
    closeBundle() {
      const outDir = path.resolve(__dirname, "dist");
      const index = path.join(outDir, "index.html");
      const notFound = path.join(outDir, "404.html");
      if (fs.existsSync(index)) {
        fs.copyFileSync(index, notFound);
      }
    },
  };
}

export default defineConfig({
  base: process.env.NODE_ENV === "production" ? "/context-viewer/" : "/",
  envDir: path.resolve(__dirname, ".."),
  plugins: [react(), wasm(), topLevelAwait(), githubPages404()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
