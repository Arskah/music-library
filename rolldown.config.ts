import { defineConfig } from "rolldown";

import { base } from "./base.ts";

// The image's entrypoint, next to the server Nitro builds.
export default defineConfig({
  input: "main.ts",
  platform: "node",
  external: ["pg-native", /^\.\/server\//],
  transform: { define: { "import.meta.env.BASE_URL": JSON.stringify(`${base}/`) } },
  output: { file: ".output/main.mjs", format: "esm" },
});
