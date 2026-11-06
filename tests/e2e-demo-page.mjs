// Verify the real site/demo.html: load it with the real extension, click Run,
// confirm the page itself reports Veil on with per-account Tor exits.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const dist = here + "../dist";
const demo = readFileSync(here + "../site/demo.html", "utf8");

const srv = createServer((_q, res) => { res.setHeader("content-type", "text/html"); res.end(demo); }).listen(0);
const origin = `http://127.0.0.1:${srv.address().port}`;

const ctx = await chromium.launchPersistentContext("", {
  channel: "chromium", headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let sw = ctx.serviceWorkers().find((w) => w.url().includes("background.js"));
for (let i = 0; i < 60 && !sw; i++) { await sleep(250); sw = ctx.serviceWorkers().find((w) => w.url().includes("background.js")); }

const page = await ctx.newPage();
const echoQ = process.env.ECHO_URL ? ("/?echo=" + encodeURIComponent(process.env.ECHO_URL)) : "";
await page.goto(origin + echoQ, { waitUntil: "domcontentloaded" });
await page.click("#run");
// wait for all three values to be filled (not the placeholder/ellipsis)
await page.waitForFunction(() => {
  const t = (id) => document.getElementById(id).textContent;
  return ["vDirect", "vA", "vB"].every((id) => t(id) && t(id) !== "…" && t(id) !== "—");
}, { timeout: 170000 }).catch(() => {});

const out = await page.evaluate(() => ({
  direct: document.getElementById("vDirect").textContent,
  a: document.getElementById("vA").textContent,
  b: document.getElementById("vB").textContent,
  verdict: document.getElementById("verdict").textContent,
  on: document.getElementById("verdict").classList.contains("on"),
}));
console.log(JSON.stringify(out, null, 2));
const ok = out.on && out.a !== out.direct && out.b !== out.direct && out.a !== out.b;
console.log("\nlive page shows Veil protecting, per-account:", ok ? "YES" : "NO");
await ctx.close(); srv.close();
process.exit(ok ? 0 : 1);
