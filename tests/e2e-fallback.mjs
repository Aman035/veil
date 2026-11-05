// Phase 1b: fallback re-routing after a block.
//  - A KNOWN single-chain RPC (Tenderly mainnet) that returns 403 must be
//    re-routed to a Tor-friendly provider and succeed.
//  - A MULTICHAIN gateway (Uniswap) that returns 403 must stay blocked — never
//    blindly rerouted (E4: blind reroute breaks Uniswap).
import { chromium } from "playwright";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const dist = here + "../dist";

// local server that impersonates a blocked provider (both mapped hosts resolve here)
const block = createServer((req, res) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST,OPTIONS" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  res.writeHead(403, { ...cors, "content-type": "text/html" });
  res.end("<html><body>Access denied</body></html>");
}).listen(0);
const bport = block.address().port;

const TENDERLY = `http://mainnet.gateway.tenderly.co:${bport}/`;
const UNISWAP = `http://entry-gateway.backend-prod.api.uniswap.org:${bport}/`;

const PAGE = `<!doctype html><meta charset=utf8><title>dapp</title><body><script>
  async function rpc(url){ try { const r = await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_blockNumber',params:[]})}); return {ok:true, status:r.status, json: await r.json()}; } catch(e){ return {ok:false, error:String(e && e.message || e)}; } }
  (async () => {
    window.__r = { tenderly: await rpc('${TENDERLY}'), uniswap: await rpc('${UNISWAP}') };
    window.__done = true;
  })();
</script>`;
const srv = createServer((_q, res) => { res.setHeader("content-type", "text/html"); res.end(PAGE); }).listen(0);
const origin = `http://127.0.0.1:${srv.address().port}`;

const ctx = await chromium.launchPersistentContext("", {
  channel: "chromium", headless: true,
  args: [
    `--disable-extensions-except=${dist}`, `--load-extension=${dist}`,
    `--host-resolver-rules=MAP mainnet.gateway.tenderly.co 127.0.0.1, MAP entry-gateway.backend-prod.api.uniswap.org 127.0.0.1`,
  ],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let sw = ctx.serviceWorkers().find((w) => w.url().includes("background.js"));
for (let i = 0; i < 60 && !sw; i++) { await sleep(250); sw = ctx.serviceWorkers().find((w) => w.url().includes("background.js")); }

const page = await ctx.newPage();
await page.goto(origin, { waitUntil: "domcontentloaded" });
let r = null;
for (let i = 0; i < 120 && !r; i++) { await sleep(500); r = await page.evaluate(() => (window.__done ? window.__r : null)).catch(() => null); }

console.log("=== page results ===");
console.log(JSON.stringify(r, null, 2));
const dump = await sw.evaluate(([o]) => ({ tab: self.__unlink.tabs().map(([, s]) => s).find((s) => s.origin === o) }), [origin]);
console.log("=== tab stats ===", JSON.stringify(dump.tab));

const hex = (x) => typeof x === "string" && /^0x[0-9a-f]+$/i.test(x);
const checks = {
  "blocked single-chain provider (Tenderly) re-routed and succeeded": r?.tenderly?.ok === true && hex(r?.tenderly?.json?.result),
  "re-route preserved JSON-RPC id": r?.tenderly?.json?.id === 1,
  "multichain gateway (Uniswap) stayed blocked, not rerouted": r?.uniswap?.ok === false && /blocks anonymous access/i.test(r?.uniswap?.error || ""),
  "stats show a reroute": (dump.tab?.rerouted ?? 0) >= 1,
  "stats show a block (the uniswap one)": (dump.tab?.blocked ?? 0) >= 1,
};
let pass = true;
console.log("\n=== checks ===");
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"}  ${k}`); if (!v) pass = false; }
console.log(pass ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
await ctx.close(); srv.close(); block.close();
process.exit(pass ? 0 : 1);
