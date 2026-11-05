// BOUNDED real tor-js boot check against the EF demo gateway.
//
// Reuses the already-built MV3 extension at experiments/kt-ext-harness/ext
// (service worker exposes self.anonReady() -> {ok, readyMs}). The upstream
// run.mjs has NO timeout, so if the gateway is down it hangs forever. Here we
// race the boot against a hard BOOT_TIMEOUT_MS and report success+ms or timeout.
//
// Playwright is resolved from the kt-ext-harness install (we do not install it
// here). Chromium binary: whatever that project already downloaded (chromium-1248).
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = fileURLToPath(new URL(".", import.meta.url));
const harnessDir = here + "../kt-ext-harness/";
const extDir = harnessDir + "ext";

// Load playwright from the sibling project's node_modules.
const require = createRequire(harnessDir + "package.json");
const { chromium } = require("playwright");

const BOOT_TIMEOUT_MS = Number(process.env.BOOT_TIMEOUT_MS || 75000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

function race(promise, ms, label) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, timedOut: true, waitedMs: ms, label }), ms);
    timer.unref?.();
  });
  return Promise.race([promise.then((v) => { clearTimeout(timer); return v; }), timeout]);
}

const ctx = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});

function findSW() {
  return ctx.serviceWorkers().find((w) => w.url().includes("background.js"));
}
let sw = findSW();
for (let i = 0; i < 60 && !sw; i++) { await sleep(250); sw = findSW(); }
if (!sw) {
  console.log(JSON.stringify({ ts: now(), result: "FAIL", reason: "service worker never appeared" }));
  await ctx.close();
  process.exit(1);
}

console.log(JSON.stringify({ ts: now(), event: "sw-ready", url: sw.url(), timeoutMs: BOOT_TIMEOUT_MS }));

// self.anonReady() awaits worker.ready (harness + tor-js boot over the gateway).
const bootPromise = sw.evaluate(() => self.anonReady());
const outcome = await race(bootPromise, BOOT_TIMEOUT_MS, "worker.ready");

if (outcome.timedOut) {
  console.log(JSON.stringify({ ts: now(), result: "TIMEOUT", waitedMs: outcome.waitedMs,
    meaning: "tor-js boot did not reach ready within the bound; gateway unreachable/too slow" }));
} else if (outcome.ok) {
  console.log(JSON.stringify({ ts: now(), result: "SUCCESS", readyMs: outcome.readyMs }));
  // Optional sanity read over the circuit.
  try {
    const block = await race(
      sw.evaluate((url) => self.anonFetch(url, { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
        "https://ethereum-rpc.publicnode.com"),
      30000, "eth_blockNumber");
    console.log(JSON.stringify({ ts: now(), event: "rpc", block }));
  } catch (e) {
    console.log(JSON.stringify({ ts: now(), event: "rpc-error", error: String(e).slice(0, 160) }));
  }
} else {
  console.log(JSON.stringify({ ts: now(), result: "REJECTED", readyMs: outcome.readyMs, error: outcome.error }));
}

await ctx.close();
// Force exit: Playwright/WebRTC can keep handles open.
process.exit(0);
