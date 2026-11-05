// Kill test #1 runner.
// Loads our MV3 extension (optionally alongside MetaMask) in a Chromium
// persistent context and checks, via the extension's own service worker:
//   1. the EF extension harness + tor-js reaches worker.ready (and how long);
//   2. a real RPC read succeeds over tor-js;
//   3. two isolation keys both work and get different Tor exits;
//   4. (if MM_PATH is set) it coexists with MetaMask.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const extDir = here + "ext";
const MM_PATH = process.env.MM_PATH || ""; // optional: unpacked MetaMask dir
const BOOT_RPC = "https://ethereum-rpc.publicnode.com";
const VITALIK = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
const IP_ECHO = "https://api.ipify.org?format=json";

const exts = [extDir, ...(MM_PATH ? [MM_PATH] : [])].join(",");
const ctx = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${exts}`, `--load-extension=${exts}`],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function findOurSW() {
  return ctx.serviceWorkers().find((w) => w.url().includes("background.js"));
}
let sw = findOurSW();
for (let i = 0; i < 60 && !sw; i++) { await sleep(250); sw = findOurSW(); }
if (!sw) { console.error("FAIL: our service worker never appeared"); await ctx.close(); process.exit(1); }
console.log("our service worker:", sw.url());
console.log("all service workers:", ctx.serviceWorkers().map((w) => new URL(w.url()).host + new URL(w.url()).pathname));

const out = { mm: !!MM_PATH };

// 1. ready
console.log("\n[1] booting harness (tor-js)…");
out.ready = await sw.evaluate(() => self.anonReady());
console.log("    ready:", JSON.stringify(out.ready));
if (!out.ready.ok) { console.error("FAIL: worker.ready rejected"); await ctx.close(); process.exit(1); }

// 2. RPC read over tor-js
console.log("\n[2] eth_blockNumber over tor-js…");
out.block = await sw.evaluate(([url]) => self.anonFetch(url, { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }), [BOOT_RPC]);
console.log("    block:", JSON.stringify(out.block));

console.log("\n[2b] eth_getBalance (vitalik) over tor-js…");
out.balance = await sw.evaluate(([url, addr]) => self.anonFetch(url, { jsonrpc: "2.0", id: 2, method: "eth_getBalance", params: [addr, "latest"] }, "acct-" + addr), [BOOT_RPC, VITALIK]);
console.log("    balance:", JSON.stringify(out.balance));

// 3. isolation: two keys -> two exits
console.log("\n[3] Tor exit IP per isolation key…");
out.ipA = await sw.evaluate(([url]) => self.anonGet(url, "route-A"), [IP_ECHO]);
out.ipB = await sw.evaluate(([url]) => self.anonGet(url, "route-B"), [IP_ECHO]);
console.log("    key A:", JSON.stringify(out.ipA));
console.log("    key B:", JSON.stringify(out.ipB));
const ipOf = (r) => { try { return JSON.parse(r.text).ip; } catch { return null; } };
const a = out.ipA.ok && ipOf(out.ipA), b = out.ipB.ok && ipOf(out.ipB);
out.differentExits = !!(a && b && a !== b);
console.log("    different exits:", out.differentExits, a && b ? `(${a} vs ${b})` : "");

// 4. MetaMask coexistence
if (MM_PATH) {
  const mmSW = ctx.serviceWorkers().find((w) => w.url().includes("chrome-extension") && !w.url().includes("background.js"));
  out.metamaskSWAlive = !!mmSW;
  console.log("\n[4] MetaMask service worker present:", out.metamaskSWAlive, mmSW ? new URL(mmSW.url()).host : "");
  // our harness still works with MM loaded?
  out.coexistBlock = await sw.evaluate(([url]) => self.anonFetch(url, { jsonrpc: "2.0", id: 9, method: "eth_blockNumber", params: [] }), [BOOT_RPC]);
  console.log("    our fetch still works alongside MM:", out.coexistBlock.ok);
}

console.log("\n=== SUMMARY ===");
console.log(JSON.stringify({
  readyMs: out.ready.readyMs,
  blockOk: out.block?.ok, blockMs: out.block?.ms,
  balanceOk: out.balance?.ok, balanceMs: out.balance?.ms,
  differentExits: out.differentExits,
  metamask: MM_PATH ? { swAlive: out.metamaskSWAlive, ourFetchOk: out.coexistBlock?.ok } : "not tested (set MM_PATH)",
}, null, 2));

await ctx.close();
