import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    // Plain Node. Everything under src/lib is isomorphic on purpose — forge
    // and WebCrypto through `globalThis.crypto`, which in Node 20 and later
    // is the same API the browser has — so testing here is testing what runs
    // there, not a stand-in for it.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
