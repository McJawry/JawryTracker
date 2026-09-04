// @ts-expect-error node:fs is a nodejs builtin (@types/node isn't installed)
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// package.json is the single source of truth for the version (tauri.conf.json
// reads it too, via the path "../package.json"). Injected at config time
// rather than imported from src/: SvelteKit's dev server restricts
// server.fs.allow to src//.svelte-kit/node_modules, so a plain
// `import "../../package.json"` 404s in dev even though it would bundle fine
// in a production build.
const packageVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [sveltekit()],

  test: {
    // Logic-only suites - the pure rule modules, no DOM required.
    include: ["src/**/*.test.ts"]
  },

  define: {
    __APP_VERSION__: JSON.stringify(packageVersion),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
