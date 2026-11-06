// Build the Veil extension into dist/ (load unpacked).
import esbuild from "esbuild";
import { cpSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const dist = here + "dist/";
const watch = process.argv.includes("--watch");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const SPECIFIER = process.env.VEIL_SPECIFIER || "0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e";
const GATEWAYS = process.env.VEIL_GATEWAYS || '["152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ"]';
const common = {
  bundle: true, platform: "browser", target: "es2022", sourcemap: false, logLevel: "info",
  define: { __VEIL_SPECIFIER__: JSON.stringify(SPECIFIER), __VEIL_GATEWAYS__: JSON.stringify(GATEWAYS) },
};
const builds = [
  { entryPoints: [here + "src/background.ts"], outfile: dist + "background.js", format: "esm" },
  { entryPoints: [here + "src/content.ts"], outfile: dist + "content.js", format: "iife" },
  { entryPoints: [here + "src/inject.ts"], outfile: dist + "inject.js", format: "iife" },
  { entryPoints: [here + "src/popup/popup.ts"], outfile: dist + "popup/popup.js", format: "iife" },
  { entryPoints: [here + "src/onboarding/onboarding.ts"], outfile: dist + "onboarding/onboarding.js", format: "iife" },
  { entryPoints: [here + "src/options/options.ts"], outfile: dist + "options/options.js", format: "iife" },
  { entryPoints: [here + "src/activity/activity.ts"], outfile: dist + "activity/activity.js", format: "iife" },
];

async function copyStatic() {
  cpSync(here + "src/manifest.json", dist + "manifest.json");
  cpSync(here + "src/popup/popup.html", dist + "popup/popup.html");
  cpSync(here + "src/popup/popup.css", dist + "popup/popup.css");
  mkdirSync(dist + "onboarding", { recursive: true });
  cpSync(here + "src/onboarding/onboarding.html", dist + "onboarding/onboarding.html");
  cpSync(here + "src/onboarding/onboarding.css", dist + "onboarding/onboarding.css");
  mkdirSync(dist + "options", { recursive: true });
  cpSync(here + "src/options/options.html", dist + "options/options.html");
  cpSync(here + "src/options/options.css", dist + "options/options.css");
  mkdirSync(dist + "activity", { recursive: true });
  cpSync(here + "src/activity/activity.html", dist + "activity/activity.html");
  cpSync(here + "src/activity/activity.css", dist + "activity/activity.css");
  // anon-rpc version-stamped assets (offscreen + sandbox) - must match the installed package
  const staticSrc = here + "node_modules/@anon-rpc/browser-extension-harness/dist/static/anon-rpc";
  if (!existsSync(staticSrc)) throw new Error("missing anon-rpc assets; run pnpm install");
  rmSync(dist + "anon-rpc", { recursive: true, force: true });
  cpSync(staticSrc, dist + "anon-rpc", { recursive: true });
  execFileSync(process.execPath, [here + "tools/generate-icons.mjs"], { stdio: "inherit" });
}

if (watch) {
  for (const b of builds) { const ctx = await esbuild.context({ ...common, ...b }); await ctx.watch(); }
  await copyStatic();
  console.log("watching…");
} else {
  await Promise.all(builds.map((b) => esbuild.build({ ...common, ...b })));
  await copyStatic();
  console.log("built -> dist/");
}
