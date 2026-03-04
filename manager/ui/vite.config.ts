import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../src/public",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/auth": "http://localhost:4000",
      "/api": "http://localhost:4000",
      "/ws": { target: "ws://localhost:4000", ws: true },
      "/agent": { target: "ws://localhost:4000", ws: true },
    },
  },
});
