import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL(".", import.meta.url));

// Mock de desenvolvimento, isolado em web/mock/ e DESLIGADO por padrão.
// Só é carregado com WEB_MOCK=1 (ex.: `WEB_MOCK=1 npm run web:dev`).
async function mockPlugins(): Promise<Plugin[]> {
  if (process.env.WEB_MOCK !== "1") return [];
  const { mockApi } = await import("./mock/mockApi.ts");
  return [mockApi()];
}

export default defineConfig(async () => ({
  root,
  plugins: [react(), ...(await mockPlugins())],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 800, // app local: React + Recharts num chunk só é aceitável
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
}));
