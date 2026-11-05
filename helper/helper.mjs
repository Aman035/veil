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
  if (known.addMany(cfg.seedAccounts)) log("seeded known accounts:", [...known.set]);

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
  log("launching headless Chromium (channel chromium)…");
  browser = await chromium.launch({ channel: "chromium", headless: true });
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") log("page error:", m.text()); });
  await page.goto(`http://127.0.0.1:${assetPort}/helper.html`);

  log("booting anon-rpc harness…");
  const readyMs = await Promise.race([
    page.evaluate(() => window.__anonReady),
    new Promise((_, rej) => setTimeout(() => rej(new Error("harness not ready within timeout")), cfg.readyTimeoutMs)),
  ]).catch((e) => { throw new Error(`harness boot failed: ${e.message}`); });
  log(`harness ready in ${readyMs} ms`);

  // The localhost JSON-RPC endpoint (D3).
  rpcServer = createServer((req, res) => {
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch { res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })); return; }

      // 1) learn accounts from this request (balance/nonce name the user)
      known.observe(parsed);
      // 2) pick the per-account isolation key (ignores the zero address; finds
      //    the user's address inside eth_call calldata) — E9 heuristic.
      const key = routing.routeKeyForBody(parsed, known.set);
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
        res.writeHead(status || 200, { "content-type": "application/json" }).end(outText);
      } catch (e) {
        // Fail visibly — never fall back to a direct connection.
        reqLog.push({ method: Array.isArray(parsed) ? "batch" : parsed?.method, key, error: String(e), ms: Date.now() - t });
        log("request failed:", String(e));
        res.writeHead(502, { "content-type": "application/json" })
          .end(JSON.stringify({ jsonrpc: "2.0", id: Array.isArray(parsed) ? null : parsed?.id ?? null, error: { code: -32603, message: String(e) } }));
      }
    });
  });
  await new Promise((r) => rpcServer.listen(cfg.port, cfg.host, r));
  log(`private JSON-RPC on http://${cfg.host}:${cfg.port}`);
  log("ready — point cast/wallets at the endpoint above. Ctrl-C to stop.");
}

main().catch((e) => { console.error("[helper] fatal:", e); shutdown(1); });
