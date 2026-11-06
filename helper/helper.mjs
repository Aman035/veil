// Unlink desktop helper (phase 2 skeleton) — requirement D3.
//
// Exposes a localhost JSON-RPC endpoint (default http://127.0.0.1:18545) that
// routes every request through the EF anon-rpc browser harness running tor-js
// inside a headless Chromium. Per-account isolation keys are chosen with the
// validated routing heuristic (src/shared/routing.ts, evidence.md E9), request
// ids are blinded before they leave, and restored on the way back.
//
// Why a browser engine: the EF Node harness can't run tor-js (QuickJS has no
// WebAssembly — evidence.md E5 / PRD D1). The proven path (E5) is the EF
// browser harness in a hidden Chromium, which is what this launches.
//
// Config (env vars, all optional):
//   HELPER_SPECIFIER   on-chain worker specifier   (default: tor-js)
//   HELPER_GATEWAYS    JSON array of gateways      (default: EF tor-js demo)
//   HELPER_BOOT_RPC    bootstrap RPC for the one specifier read
//   HELPER_UPSTREAM    target RPC requests are forwarded to
//   HELPER_HOST        listen host                 (default: 127.0.0.1)
//   HELPER_PORT        listen port                 (default: 18545)
//   HELPER_ACCOUNTS    comma-separated addresses to seed as known accounts
//                      (a wallet-oracle analog; default: none — learn from reads)
//   HELPER_READY_TIMEOUT_MS  fail if the harness isn't ready in time
//                      (default: 90000; the boot path itself has no timeout)
//
// No silent direct fallback: if the harness isn't ready or a forward fails, the
// request fails visibly. Nothing is ever sent outside the harness.
import { chromium } from "playwright";
import esbuild from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomInt } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROUTING = join(HERE, "..", "src", "shared", "routing.ts");

// --- config -----------------------------------------------------------------
const TOR_JS = "0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e";
const TOR_JS_GATEWAYS = ["152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ"];
const cfg = {
  specifier: process.env.HELPER_SPECIFIER || TOR_JS,
  gateways: process.env.HELPER_GATEWAYS ? JSON.parse(process.env.HELPER_GATEWAYS) : TOR_JS_GATEWAYS,
  bootRpc: process.env.HELPER_BOOT_RPC || "https://ethereum-rpc.publicnode.com",
  upstream: process.env.HELPER_UPSTREAM || "https://ethereum-rpc.publicnode.com",
  host: process.env.HELPER_HOST || "127.0.0.1",
  port: Number(process.env.HELPER_PORT || 18545),
  seedAccounts: (process.env.HELPER_ACCOUNTS || "").split(",").map((s) => s.trim()).filter(Boolean),
  readyTimeoutMs: Number(process.env.HELPER_READY_TIMEOUT_MS || 90000),
};

// "tor" when real gateways are configured, "passthrough" when the plumbing runs
// without privacy (empty gateways / passthrough specifier).
const networkLabel = cfg.gateways.length ? "tor" : "passthrough";

const log = (...a) => console.log("[helper]", ...a);

// --- routing heuristic: single source of truth is src/shared/routing.ts ------
// Bundled to JS at startup (never edited/copied) so the helper reuses exactly
// the account-mapping logic validated in evidence.md E9.
async function loadRouting() {
  const out = join(HERE, ".gen", "routing.mjs");
  await esbuild.build({
    entryPoints: [SRC_ROUTING],
    outfile: out,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "warning",
  });
  return import(pathToFileURL(out).href + "?t=" + Date.now());
}

// --- page bundle: browser side of the harness --------------------------------
async function buildPage() {
  await esbuild.build({
    entryPoints: [join(HERE, "page-entry.mjs")],
    outfile: join(HERE, "www", "page.js"),
    bundle: true,
    platform: "browser",
    target: "es2022",
    format: "esm",
    logLevel: "warning",
    define: {
      __HELPER_SPECIFIER__: JSON.stringify(cfg.specifier),
      __HELPER_GATEWAYS__: JSON.stringify(cfg.gateways),
      __HELPER_BOOT_RPC__: JSON.stringify(cfg.bootRpc),
    },
  });
}

// --- JSON-RPC id blinding ----------------------------------------------------
// viem (and others) number requests with one global counter, which would link
// routes together. Replace every id with a fresh random one before it leaves,
// and restore the caller's original id on the response (CLAUDE.md, E7).
function freshId(used) {
  let id;
  do { id = randomInt(1, 2_147_483_647); } while (used.has(id));
  used.add(id);
  return id;
}
function blind(parsed) {
  const used = new Set();
  if (Array.isArray(parsed)) {
    const map = new Map();
    const blinded = parsed.map((c) => {
      const rid = freshId(used);
      map.set(rid, c?.id);
      return { ...c, id: rid };
    });
    const restore = (resp) =>
      Array.isArray(resp) ? resp.map((r) => (r && map.has(r.id) ? { ...r, id: map.get(r.id) } : r)) : resp;
    return { blinded, restore };
  }
  const orig = parsed?.id;
  const blinded = { ...parsed, id: freshId(used) };
  const restore = (resp) =>
    resp && typeof resp === "object" && !Array.isArray(resp) ? { ...resp, id: orig } : resp;
  return { blinded, restore };
}

// --- control API state (read-only dashboard feed) ----------------------------
// The desktop app reads these over the SAME local server. Everything here is a
// view of traffic the helper has already routed — no new network behaviour.
//
// SECURITY NOTE: /__unlink/health and /__unlink/status are READ-ONLY and safe to
// serve with CORS `*`. Any future MUTATION route (toggle protection, switch
// network, forget an account) MUST require a per-session bearer token — a web
// page on any origin can reach 127.0.0.1, so a mutation must never trust the
// Origin/CORS alone. GET status/health leak only local, non-secret counters.
let harnessState = "booting"; // "booting" | "ready" | "error"
let page = null; // the Chromium page running the harness (set once ready)
const accounts = new Map(); // norm(addr) -> { label, address, routeKey, exitIp, status, requests }
const sitesSet = new Set(); // distinct upstream hosts seen (the helper's "sites")
let todayRequests = 0;
let learnedCount = 0;

const CORS = { "access-control-allow-origin": "*" };
function sendJson(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json", ...CORS }).end(JSON.stringify(obj));
}
// Track, per account seen, its last route key (exitIp stays null under
// passthrough — the harness doesn't surface the exit under tor-js yet either).
function recordAccount(normAddr, key) {
  let a = accounts.get(normAddr);
  if (!a) {
    a = { label: `Account ${++learnedCount}`, address: "0x" + normAddr, routeKey: key, exitIp: null, status: "private", requests: 0 };
    accounts.set(normAddr, a);
  }
  a.routeKey = key;
  a.requests++;
}
function statusBody() {
  return {
    ok: true,
    connected: harnessState === "ready",
    network: networkLabel,
    harness: harnessState,
    accounts: [...accounts.values()].map((a) => ({
      label: a.label, address: a.address, routeKey: a.routeKey, exitIp: a.exitIp ?? null, status: a.status,
    })),
    todayRequests,
    sites: sitesSet.size,
    upstream: cfg.upstream,
  };
}

// --- main --------------------------------------------------------------------
let browser, assetServer, rpcServer;
const reqLog = [];

async function shutdown(code = 0) {
  log("shutting down…");
  try { rpcServer?.close(); } catch {}
  try { assetServer?.close(); } catch {}
  try { await browser?.close(); } catch {}
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function main() {
  const routing = await loadRouting();
  await buildPage();

  const known = new routing.KnownAccounts();
  // HELPER_ACCOUNTS entries may be a bare address or "Label=0xaddr" (additive;
  // plain addresses still work). Seeded accounts show as dashboard rows at once.
  const seedEntries = cfg.seedAccounts.map((e, i) => {
    const eq = e.indexOf("=");
    return eq > 0
      ? { label: e.slice(0, eq).trim(), address: e.slice(eq + 1).trim() }
      : { label: `Account ${i + 1}`, address: e };
  });
  if (known.addMany(seedEntries.map((e) => e.address))) log("seeded known accounts:", [...known.set]);
  for (const e of seedEntries) {
    const n = routing.norm(e.address);
    if (n) accounts.set(n, { label: e.label, address: "0x" + n, routeKey: "acct:" + n, exitIp: null, status: "private", requests: 0 });
  }

  // Serve the harness page to the browser over loopback.
  const types = { ".html": "text/html", ".js": "text/javascript", ".map": "application/json" };
  assetServer = createServer(async (req, res) => {
    const name = (req.url === "/" ? "/helper.html" : req.url).split("?")[0];
    try {
      const buf = await readFile(join(HERE, "www", name));
      res.writeHead(200, { "content-type": types[extname(name)] ?? "application/octet-stream" }).end(buf);
    } catch { res.writeHead(404).end(); }
  });
  const assetPort = await new Promise((r) => assetServer.listen(0, "127.0.0.1", () => r(assetServer.address().port)));

  log(`specifier ${cfg.specifier}`);
  log(`gateways ${JSON.stringify(cfg.gateways)}${cfg.gateways.length === 0 ? "  (passthrough: no privacy, plumbing only)" : ""}`);
  log(`upstream ${cfg.upstream}`);
  // The localhost server (D3). It serves BOTH the JSON-RPC POST at "/" and the
  // read-only control API the desktop app polls. It starts listening BEFORE the
  // harness boots, so the app can show "booting" (and never a silent direct
  // fallback — JSON-RPC POSTs fail visibly with 503 until the harness is ready).
  rpcServer = createServer((req, res) => {
    const path = (req.url || "/").split("?")[0];

    // CORS preflight for the local control API.
    if (req.method === "OPTIONS") {
      res.writeHead(204, { ...CORS, "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" }).end();
      return;
    }
    // Read-only control routes (safe with CORS *; see SECURITY NOTE above).
    if (req.method === "GET" && path === "/__unlink/health") {
      sendJson(res, 200, { ok: true, network: networkLabel, harness: harnessState });
      return;
    }
    if (req.method === "GET" && path === "/__unlink/status") {
      sendJson(res, 200, statusBody());
      return;
    }

    if (req.method !== "POST") { res.writeHead(405, CORS).end(); return; }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch { res.writeHead(400, { "content-type": "application/json", ...CORS }).end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })); return; }

      // No silent direct fallback: while the harness is booting or broken, fail
      // visibly. Nothing is ever sent outside the harness (CLAUDE.md, PRD G4).
      if (harnessState !== "ready" || !page) {
        sendJson(res, 503, { jsonrpc: "2.0", id: Array.isArray(parsed) ? null : parsed?.id ?? null, error: { code: -32000, message: `harness ${harnessState}` } });
        return;
      }

      // 1) learn accounts from this request (balance/nonce name the user)
      known.observe(parsed);
      // 2) pick the per-account isolation key (ignores the zero address; finds
      //    the user's address inside eth_call calldata) — E9 heuristic.
      const key = routing.routeKeyForBody(parsed, known.set);
      // control-API counters: record the account's last route + bump totals
      todayRequests++;
      try { sitesSet.add(new URL(cfg.upstream).host); } catch {}
      if (key.startsWith("acct:")) recordAccount(key.slice(5), key);
      // 3) blind ids before sending
      const { blinded, restore } = blind(parsed);

      const t = Date.now();
      try {
        const { status, text } = await page.evaluate(
          ([u, b, k]) => window.anonFetch(u, b, k),
          [cfg.upstream, JSON.stringify(blinded), key],
        );
        let outText = text;
        try { outText = JSON.stringify(restore(JSON.parse(text))); } catch {}
        const method = Array.isArray(parsed) ? "batch" : parsed?.method;
        reqLog.push({ method, key, status, ms: Date.now() - t });
        log(`${method}  key=${key}  ${status}  ${Date.now() - t}ms`);
        res.writeHead(status || 200, { "content-type": "application/json", ...CORS }).end(outText);
      } catch (e) {
        // Fail visibly — never fall back to a direct connection.
        reqLog.push({ method: Array.isArray(parsed) ? "batch" : parsed?.method, key, error: String(e), ms: Date.now() - t });
        log("request failed:", String(e));
        res.writeHead(502, { "content-type": "application/json", ...CORS })
          .end(JSON.stringify({ jsonrpc: "2.0", id: Array.isArray(parsed) ? null : parsed?.id ?? null, error: { code: -32603, message: String(e) } }));
      }
    });
  });
  await new Promise((r) => rpcServer.listen(cfg.port, cfg.host, r));
  log(`control API on http://${cfg.host}:${cfg.port}/__unlink/health  (and /status)`);
  log(`private JSON-RPC on http://${cfg.host}:${cfg.port}  (harness booting…)`);

  // Now boot the harness. The server already answers health/status as "booting".
  try {
    log("launching headless Chromium (channel chromium)…");
    browser = await chromium.launch({ channel: "chromium", headless: true });
    page = await browser.newPage();
    page.on("console", (m) => { if (m.type() === "error") log("page error:", m.text()); });
    await page.goto(`http://127.0.0.1:${assetPort}/helper.html`);

    log("booting anon-rpc harness…");
    const readyMs = await Promise.race([
      page.evaluate(() => window.__anonReady),
      new Promise((_, rej) => setTimeout(() => rej(new Error("harness not ready within timeout")), cfg.readyTimeoutMs)),
    ]);
    harnessState = "ready";
    log(`harness ready in ${readyMs} ms`);
    log("ready — point cast/wallets at the endpoint above. Ctrl-C to stop.");
  } catch (e) {
    harnessState = "error";
    throw new Error(`harness boot failed: ${e.message}`);
  }
}

main().catch((e) => { console.error("[helper] fatal:", e); shutdown(1); });
