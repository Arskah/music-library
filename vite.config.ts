import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

import { base } from "./base.ts";

export default defineConfig({
  base: `${base}/`,
  plugins: [
    tanstackStart(),
    // A Node handler rather than a server: `main.ts` serves it, behind the
    // login. The assets are behind it too, so no shared cache may keep them.
    nitro({
      preset: "node-middleware",
      serveStatic: true,
      baseURL: `${base}/`,
      routeRules: {
        "/assets/**": {
          headers: { "cache-control": "private, max-age=31536000, immutable" },
        },
      },
    }),
    viteReact(),
  ],
});
