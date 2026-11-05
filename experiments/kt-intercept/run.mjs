import { chromium } from "/Users/amangupta/Desktop/Personal_Projects/pro_mum/research/experiments/u4-anon-rpc-transport/node_modules/playwright/index.mjs";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
const serverHits = [];
const srv = createServer((req, res) => {
  if (req.url === "/page.html") { res.setHeader("content-type", "text/html"); return res.end(readFileSync(new URL("./page.html", import.meta.url))); }
  let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
    serverHits.push(req.headers["user-agent"]?.slice(0, 10) + " " + body.slice(0, 40));
    res.setHeader("access-control-allow-origin", "*"); res.setHeader("access-control-allow-headers", "*");
    if (req.method === "OPTIONS") return res.end();
    const j = (() => { try { return JSON.parse(body); } catch { return {}; } })();
    const one = (c) => ({ jsonrpc: "2.0", id: c.id, result: c.method === "eth_chainId" ? "0x1" : "0x10" });
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify(Array.isArray(j) ? j.map(one) : one(j)));
  });
}).listen(18911);
// What a MAIN-world content script at document_start would do: wrap fetch and XHR and record what it catches.
const intercept = () => {
  const caught = (window.__caught = []);
  const of = window.fetch;
  window.fetch = function (input, init) { const url = typeof input === "string" ? input : input.url; if (url.includes("rpc.example.test")) caught.push("fetch " + (init?.body ? String(init.body).slice(0, 30) : "")); return of.apply(this, arguments); };
  const oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, url) { if (String(url).includes("rpc.example.test")) caught.push("xhr"); return oo.apply(this, arguments); };
};
const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP rpc.example.test 127.0.0.1"] });
const page = await browser.newPage();
await page.addInitScript(intercept);
await page.goto("http://rpc.example.test:18911/page.html");
await page.waitForFunction(() => window.__done?.finished, null, { timeout: 60000 }).catch(() => {});
console.log("libraries:", JSON.stringify(await page.evaluate(() => window.__done)));
const caught = await page.evaluate(() => window.__caught);
console.log("caught by the page-level wrapper:", caught.length, JSON.stringify(caught));
console.log("reached the server:", serverHits.length);
await browser.close(); srv.close();
