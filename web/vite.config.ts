import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const dictionaries = [
  { source: "node_modules/dictionary-ru/index.aff", target: "dictionaries/ru.aff" },
  { source: "node_modules/dictionary-ru/index.dic", target: "dictionaries/ru.dic" },
  { source: "node_modules/dictionary-en/index.aff", target: "dictionaries/en.aff" },
  { source: "node_modules/dictionary-en/index.dic", target: "dictionaries/en.dic" },
];

function dictionaryAssets(): Plugin {
  const read = (source: string) => readFileSync(fileURLToPath(new URL(`./${source}`, import.meta.url)));
  return {
    name: "dictionary-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? "").split("?")[0];
        const item = dictionaries.find((entry) => `/${entry.target}` === path);
        if (!item) {
          next();
          return;
        }
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        response.end(read(item.source));
      });
    },
    generateBundle() {
      for (const entry of dictionaries) {
        this.emitFile({ type: "asset", fileName: entry.target, source: read(entry.source) });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), dictionaryAssets()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:7788",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "node",
  },
});
