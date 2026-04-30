import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    },
    dedupe: ["react", "react-dom"],
  },

  root: path.resolve(__dirname),

  build: {
    outDir: "dist",
    emptyOutDir: true,
  },

  server: {
    port: 5000,
    host: "0.0.0.0",
    allowedHosts: true,
    watch: {
      ignored: ["**/.local/**", "**/node_modules/**"],
    },
    hmr: {
      clientPort: 443,
    },
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        secure: false,
      },
      "/socket.io": {
        target: "http://localhost:3001",
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },

  preview: {
    port: 5000,
    host: "0.0.0.0",
  },
});
