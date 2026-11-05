// Host side: a localhost JSON-RPC endpoint. Each request goes through tor-js, one isolation key per address.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
const UPSTREAM = "https://ethereum-rpc.publicnode.com";
const types = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm" };
createServer(async (req, res) => {
  try { res.writeHead(200, { "content-type": types[extname(req.url)] ?? "application/octet-stream" }).end(await readFile(join("www", req.url))); }
  catch { res.writeHead(404).end(); }
}).listen(8788);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("http://localhost:8788/helper.html");
const readyMs = await page.evaluate(() => window.__ready);
console.log(`tor-js ready in ${readyMs} ms`);
const keyFor = (body) => {
  const m = body.toLowerCase().match(/0x[0-9a-f]{40}/);
  return m ? "acct-" + m[0] : "shared";
};
const log = [];
createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c)); req.on("end", async () => {
    const key = keyFor(body);
    const t = Date.now();
    try {
      const out = await page.evaluate(([u, b, k]) => window.anonFetch(u, b, k), [UPSTREAM, body, key]);
      log.push({ key, ms: Date.now() - t, method: JSON.parse(body).method });
      res.writeHead(200, { "content-type": "application/json" }).end(out);
    } catch (e) { res.writeHead(502).end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: String(e) } })); }
  });
}).listen(18545, "127.0.0.1", () => console.log("private RPC on http://127.0.0.1:18545"));
process.on("SIGTERM", async () => { console.log(JSON.stringify(log)); await browser.close(); process.exit(0); });
