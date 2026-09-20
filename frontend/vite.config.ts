import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const viteWatchIgnored = [
  /[\\/]node_modules[\\/]/,
  /[\\/][^\\/]+\.(?:spec|test)\.[^\\/]+$/,
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    reportCompressedSize: false,
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    watch: {
      ignored: viteWatchIgnored,
      usePolling: true,
    },
  },
});
