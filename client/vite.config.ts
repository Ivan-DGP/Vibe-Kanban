import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Target 127.0.0.1 (not "localhost"): the server binds IPv4 only, but on
      // dual-stack hosts "localhost" can resolve to ::1 first, making every
      // proxied API/WS call fail with ECONNREFUSED.
      "/api/": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:3001",
        ws: true,
      },
      "/mcp": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
