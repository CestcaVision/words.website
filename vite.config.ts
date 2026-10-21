import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  root: "apps/web",
  build: { outDir: "../../dist", emptyOutDir: true },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${process.env.PORT || loadEnv(mode, process.cwd(), "").PORT || 3000}`,
    },
  },
}));
