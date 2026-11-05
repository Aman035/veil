// Build the kill-test extension: bundle the service worker and copy the
// version-stamped anon-rpc static assets (offscreen + sandbox pages) into ext/.
import esbuild from "esbuild";
import { cpSync, rmSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const staticSrc = here + "node_modules/@anon-rpc/browser-extension-harness/dist/static/anon-rpc";
if (!existsSync(staticSrc)) throw new Error("missing anon-rpc static assets; run pnpm install first: " + staticSrc);

await esbuild.build({
  entryPoints: [here + "background.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: here + "ext/background.js",
  logLevel: "info",
});

rmSync(here + "ext/anon-rpc", { recursive: true, force: true });
cpSync(staticSrc, here + "ext/anon-rpc", { recursive: true });
console.log("copied anon-rpc assets:", readdirSync(here + "ext/anon-rpc"));
