import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const dictionary = (path: string) => fileURLToPath(new URL(`./node_modules/${path}`, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "dictionary-ru-aff": dictionary("dictionary-ru/index.aff"),
      "dictionary-ru-dic": dictionary("dictionary-ru/index.dic"),
      "dictionary-en-aff": dictionary("dictionary-en/index.aff"),
      "dictionary-en-dic": dictionary("dictionary-en/index.dic"),
    },
  },
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
