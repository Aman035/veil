import { chromium } from "/Users/amangupta/Desktop/Personal_Projects/pro_mum/research/experiments/u4-anon-rpc-transport/node_modules/playwright/index.mjs";
import { hits, rpc, proxy } from "./server.mjs";
const dir = new URL(".", import.meta.url).pathname;
const ctx = await chromium.launchPersistentContext("", { channel: "chromium", headless: true,
  args: ["--host-resolver-rules=MAP rpc.example.test 127.0.0.1", `--disable-extensions-except=${dir}extA,${dir}extB`, `--load-extension=${dir}extA,${dir}extB`] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let workers = ctx.serviceWorkers();
for (let i = 0; i < 40 && workers.length < 2; i++) { await sleep(250); workers = ctx.serviceWorkers(); }
const ids = workers.map((w) => w.url());
const B = workers.find((w) => w.url().includes("bg.js") && w !== undefined && w.url()) ;
// identify B by evaluating a function only B defines
let extB;
for (const w of workers) { if (await w.evaluate(() => typeof self.getSeen === "function").catch(() => false)) extB = w; }
console.log("service workers:", ids.length, "B found:", !!extB);

await sleep(2500);
const seenByB = await extB.evaluate(() => self.getSeen());
console.log("\n[1] webRequest: requests from A that B observed:", seenByB.length, "| requests that reached the RPC:", hits.rpc.length);

hits.rpc.length = 0;
await extB.evaluate(() => self.setupDnr());
await sleep(2500);
console.log("[2] declarativeNetRequest redirect: A's requests redirected by B:", hits.redirected.length, "| still reached the RPC directly:", hits.rpc.length);
await extB.evaluate(() => self.clearDnr());

hits.rpc.length = 0;
await extB.evaluate(() => self.setupProxy());
await sleep(2500);
console.log("[3] chrome.proxy (PAC): A's requests that went to B's proxy:", hits.proxy.length, "| reached the RPC directly:", hits.rpc.length);
console.log("    sample proxied url:", hits.proxy[0] ?? "none");
const before = hits.proxy.length;
const page = await ctx.newPage();
await page.goto("about:blank");
await page.evaluate(() => fetch("http://rpc.example.test:18901/rpc?from=page", { method: "POST", body: "{}" }).catch(() => {}));
await sleep(500);
console.log("    control: a web page's request went to the proxy:", hits.proxy.length > before);
await ctx.close(); rpc.close(); proxy.close();
