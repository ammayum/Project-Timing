import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl"; // 1. Import the plugin

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "development" ? [basicSsl()] : [])],
  
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          query: ["@tanstack/react-query"],
          auth: ["@azure/msal-browser", "@azure/msal-react"],
          csv: ["papaparse"],
          icons: ["lucide-react"],
        },
      },
    },
  },

  server: {
    port: 5173,
    host: true, // 1. Exposes the client app to your local network
    https: true, // 3. Turn on HTTPS mode
    proxy: {
      "/api": {
        target: "http://localhost:4000", // 2. Resolves proxy routing conflicts
        changeOrigin: true,
         secure: false, // Prevents proxy failure if backend is HTTP
      },
    },
  },
}));
