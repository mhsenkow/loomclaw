import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://localhost:7717", changeOrigin: true },
      "/events": { target: "http://localhost:7717", changeOrigin: true },
    },
  },
});
