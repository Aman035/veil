// Phase 1a end-to-end: load the built extension, drive a real page's fetch,
// and confirm the request was routed through tor-js (not sent directly) with a
// per-account isolation key, and that stats + the popup reflect it.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const dist = here + "../dist";
const ACCT = "0x28c6c06298d514db089934071355e5743bf21d60";
const OTHER = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
const RPC = "https://ethereum-rpc.publicnode.com";

const PAGE = `<!doctype html><meta charset=utf8><title>dapp</title><body><h1>test dapp</h1><script>
  // a wallet-like provider the page "connects" to
  window.ethereum = { isMetaMask:true, request: async ({method}) => {
    if (method==='eth_accounts'||method==='eth_requestAccounts') return ['${ACCT}'];
    if (method==='eth_chainId') return '0x1';
    throw new Error('unsupported');
  }};
  async function rpc(body){ const r = await fetch('${RPC}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); return r.json(); }
  (async () => {
    const out = { steps: [] };
    try {
      await window.ethereum.request({method:'eth_accounts'});        // inject observes the account
      out.balanceAcct = await rpc({jsonrpc:'2.0',id:101,method:'eth_getBalance',params:['${ACCT}','latest']});
      out.block       = await rpc({jsonrpc:'2.0',id:102,method:'eth_blockNumber',params:[]});
      out.balanceOther= await rpc({jsonrpc:'2.0',id:103,method:'eth_getBalance',params:['${OTHER}','latest']});
      out.done = true;
    } catch(e){ out.error = String(e && e.message || e); }
    window.__results = out;
  })();
</script>`;

const srv = createServer((_req, res) => { res.setHeader("content-type", "text/html"); res.end(PAGE); }).listen(0);
const port = srv.address().port;
const origin = `http://127.0.0.1:${port}`;

const ctx = await chromium.launchPersistentContext("", {
  channel: "chromium", headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let sw = ctx.serviceWorkers().find((w) => w.url().includes("background.js"));
for (let i = 0; i < 60 && !sw; i++) { await sleep(250); sw = ctx.serviceWorkers().find((w) => w.url().includes("background.js")); }
if (!sw) { console.error("FAIL: no background service worker"); await ctx.close(); srv.close(); process.exit(1); }

const page = await ctx.newPage();
await page.goto(origin, { waitUntil: "domcontentloaded" });

// wait for results (harness boot ~20s + reads)
let results = null;
for (let i = 0; i < 120 && !results; i++) { await sleep(500); results = await page.evaluate(() => window.__results).catch(() => null); if (results && !results.done && !results.error) results = null; }

console.log("\n=== page results ===");
console.log(JSON.stringify(results, null, 2));

const hex = (x) => typeof x === "string" && /^0x[0-9a-f]+$/i.test(x);
const okBalAcct = hex(results?.balanceAcct?.result);
const okBlock = hex(results?.block?.result);
const okBalOther = hex(results?.balanceOther?.result);
// ids must come back as the page's original ids (blinding restored)
const idsRestored = results?.balanceAcct?.id === 101 && results?.block?.id === 102 && results?.balanceOther?.id === 103;

const tabId = await page.evaluate(() => 0).catch(() => 0); // not used; read via SW
const dump = await sw.evaluate(([o]) => ({ tabs: self.__veil.tabs(), today: self.__veil.today(), accounts: self.__veil.accounts(o), harness: self.__veil.harness() }), [origin]);
console.log("\n=== extension state ===");
console.log(JSON.stringify(dump, null, 2));

const tab = dump.tabs.map(([, s]) => s).find((s) => s.origin === origin);
const routes = tab?.routes ?? [];
const learnedAcct = dump.accounts.includes(ACCT.slice(2).toLowerCase());
const acctRoute = routes.includes("acct:" + ACCT.slice(2).toLowerCase());
const hasNeutral = routes.includes("neutral");

// popup render check
const pop = await ctx.newPage();
await pop.goto(sw.url().replace("background.js", "popup/popup.html"));
await sleep(600);
const statusText = await pop.textContent("#statusText").catch(() => "");
await pop.screenshot({ path: here + "popup.png" });

const checks = {
  "page got valid balance (connected account)": okBalAcct,
  "page got valid block number": okBlock,
  "page got valid balance (other account)": okBalOther,
  "JSON-RPC ids restored after blinding": idsRestored,
  "harness ready": dump.harness.harness === "ready",
  "learned connected account from wallet": learnedAcct,
  "connected-account traffic keyed to its own route": acctRoute,
  "neutral route used for account-agnostic calls": hasNeutral,
  "popup shows Private": /private/i.test(statusText),
};
console.log("\n=== checks ===");
let pass = true;
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"}  ${k}`); if (!v) pass = false; }
console.log("\npopup status text:", JSON.stringify(statusText), "| screenshot -> tests/popup.png");
console.log(pass ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");

await ctx.close(); srv.close();
process.exit(pass ? 0 : 1);
