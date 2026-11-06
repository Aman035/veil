// Phase 1c: per-site policy for a NON-reroutable blocked provider (a multichain
// gateway - Uniswap-shaped, E4). The provider serves the normal browser request
// but blocks the anonymized one (which strips identifying headers), exactly the
// real condition. We assert:
//   A. policy "block"        -> the page request fails closed (nothing direct).
//   B. policy "allow-direct" -> the page performs the real native request and
//                               succeeds; per-tab `direct` count rises.
//   C. policy "ask" (default)-> the in-page Shadow-DOM dialog is shown; choosing
//                               "Allow direct" persists and resolves the request.
// Driving A/B via stored policy is deterministic; C drives the real dialog UI
// (Playwright pierces the open shadow root) and also yields the screenshot.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const dist = here + "../dist";

// The multichain gateway. It returns a valid JSON-RPC result ONLY to requests
// that carry the browser's own header (the direct path); the anonymized path
// (headers stripped by the extension) gets 403, as Tor exits do in the wild.
const MARKER = "x-veil-browser-session";
const provider = createServer((req, res) => {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "POST,OPTIONS",
  };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  if (req.headers[MARKER]) {
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    return res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x10c3f2b" }));
  }
  res.writeHead(403, { ...cors, "content-type": "text/html" });
  res.end("<html><body>Access denied (anonymous)</body></html>");
}).listen(0);
const bport = provider.address().port;
const PROVIDER_URL = `http://entry-gateway.backend-prod.api.uniswap.org:${bport}/`;

const PAGE = `<!doctype html><meta charset=utf8><title>dapp</title><body><h1>policy test dapp</h1><script>
  (async () => {
    try {
      const r = await fetch('${PROVIDER_URL}', {
        method: 'POST',
        headers: { 'content-type': 'application/json', '${MARKER}': '1' },
        body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'eth_blockNumber', params:[] }),
      });
      window.__r = { ok: true, status: r.status, json: await r.json() };
    } catch (e) {
      window.__r = { ok: false, error: String(e && e.message || e) };
    }
    window.__done = true;
  })();
</script>`;

// Three dapp origins (distinct ports) -> independent policies.
function pageServer() {
  const s = createServer((_q, res) => { res.setHeader("content-type", "text/html"); res.end(PAGE); }).listen(0);
  return { srv: s, origin: `http://127.0.0.1:${s.address().port}` };
}
const A = pageServer(); // block
const B = pageServer(); // allow-direct
const C = pageServer(); // ask (dialog)

const ctx = await chromium.launchPersistentContext("", {
  channel: "chromium", headless: true,
  args: [
    `--disable-extensions-except=${dist}`, `--load-extension=${dist}`,
    `--host-resolver-rules=MAP entry-gateway.backend-prod.api.uniswap.org 127.0.0.1`,
  ],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let sw = ctx.serviceWorkers().find((w) => w.url().includes("background.js"));
for (let i = 0; i < 60 && !sw; i++) { await sleep(250); sw = ctx.serviceWorkers().find((w) => w.url().includes("background.js")); }
if (!sw) { console.error("FAIL: no background service worker"); await ctx.close(); [A, B, C].forEach((p) => p.srv.close()); provider.close(); process.exit(1); }

// Seed policies for A (block) and B (allow-direct); C stays unset (= "ask").
await sw.evaluate(([a, b]) => chrome.storage.local.set({ sitePolicies: { [a]: "block", [b]: "allow-direct" } }), [A.origin, B.origin]);

async function runPage(origin) {
  const page = await ctx.newPage();
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  let r = null;
  for (let i = 0; i < 120 && !r; i++) { await sleep(500); r = await page.evaluate(() => (window.__done ? window.__r : null)).catch(() => null); }
  return { page, r };
}
const tabStatFor = (o) => sw.evaluate(([x]) => self.__veil.tabs().map(([, s]) => s).find((s) => s.origin === x) ?? null, [o]);

// --- A: block ---
const a = await runPage(A.origin);
const aStat = await tabStatFor(A.origin);

// --- B: allow-direct ---
const b = await runPage(B.origin);
const bStat = await tabStatFor(B.origin);

// --- C: ask -> dialog -> Allow direct ---
const cPage = await ctx.newPage();
await cPage.goto(C.origin, { waitUntil: "domcontentloaded" });
// Wait for the Shadow-DOM dialog (Playwright pierces open shadow roots).
const allowBtn = cPage.locator('button:has-text("Allow direct for this site")');
let dialogShown = false;
try { await allowBtn.waitFor({ state: "visible", timeout: 20000 }); dialogShown = true; } catch {}
if (dialogShown) {
  await sleep(500); // let the open animation settle before the screenshot
  await cPage.screenshot({ path: here + "dialog.png" });
  await allowBtn.click();
}
let cr = null;
for (let i = 0; i < 60 && !cr; i++) { await sleep(500); cr = await cPage.evaluate(() => (window.__done ? window.__r : null)).catch(() => null); }
const cPolicy = await sw.evaluate(([x]) => self.__veil.policy(x), [C.origin]);
const cStat = await tabStatFor(C.origin);

// --- onboarding screenshot ---
const onboardUrl = sw.url().replace("background.js", "onboarding/onboarding.html");
const ob = await ctx.newPage();
await ob.goto(onboardUrl, { waitUntil: "domcontentloaded" });
await sleep(500);
await ob.screenshot({ path: here + "onboarding.png", fullPage: true });

console.log("=== A (block) ===", JSON.stringify(a.r), JSON.stringify(aStat));
console.log("=== B (allow-direct) ===", JSON.stringify(b.r), JSON.stringify(bStat));
console.log("=== C (ask/dialog) ===", "shown:", dialogShown, JSON.stringify(cr), "policy:", cPolicy, JSON.stringify(cStat));

const hex = (x) => typeof x === "string" && /^0x[0-9a-f]+$/i.test(x);
const checks = {
  "A: blocked provider failed closed (no direct)": a.r?.ok === false && /blocks anonymous access/i.test(a.r?.error || ""),
  "A: per-tab blocked count >= 1, direct == 0": (aStat?.blocked ?? 0) >= 1 && (aStat?.direct ?? 0) === 0,
  "B: allow-direct let the native request succeed": b.r?.ok === true && hex(b.r?.json?.result),
  "B: per-tab direct count >= 1": (bStat?.direct ?? 0) >= 1,
  "C: in-page dialog was shown": dialogShown,
  "C: choosing Allow direct resolved the request": cr?.ok === true && hex(cr?.json?.result),
  "C: choice persisted as allow-direct for the site": cPolicy === "allow-direct",
  "C: per-tab direct count >= 1": (cStat?.direct ?? 0) >= 1,
};
let pass = true;
console.log("\n=== checks ===");
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"}  ${k}`); if (!v) pass = false; }
console.log("\nscreenshots -> tests/dialog.png, tests/onboarding.png");
console.log(pass ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");

await ctx.close();
[A, B, C].forEach((p) => p.srv.close());
provider.close();
process.exit(pass ? 0 : 1);
