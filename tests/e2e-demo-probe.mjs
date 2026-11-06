// Probe: does the REAL extension intercept a PAGE's fetch (not the service
// worker) and route a JSON-RPC POST over Tor, per account? Uses a public
// IP-echo (httpbin) so the page can read back the exit IP the server saw.
//   direct GET  -> your real IP (not routed)
//   POST jsonrpc[addrA] -> Tor exit A ; POST jsonrpc[addrB] -> Tor exit B
import { chromium } from "playwright";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const dist = here + "../dist";
const ECHO = "https://ipinfo.io/json"; // returns { ip: <caller ip> }
const A = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045"; // vitalik
const B = "0xab5801a7d398351b8be11c439e05c5b3259aec9b"; // another

const PAGE = `<!doctype html><meta charset=utf8><body><script>
  const ECHO='${ECHO}';
  const rpc=(addr)=>fetch(ECHO,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getBalance',params:[addr,'latest']})})
    .then(r=>r.json()).then(j=>j.ip).catch(e=>'ERR:'+e);
  (async()=>{
    const direct = await fetch(ECHO).then(r=>r.json()).then(j=>j.ip).catch(e=>'ERR:'+e);
    const a = await rpc('${A}');
    const b = await rpc('${B}');
    window.__r = { direct, a, b }; window.__done = true;
  })();
</script>`;
const srv = createServer((_q, res) => { res.setHeader("content-type", "text/html"); res.end(PAGE); }).listen(0);
const origin = `http://127.0.0.1:${srv.address().port}`;

const ctx = await chromium.launchPersistentContext("", {
  channel: "chromium", headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let sw = ctx.serviceWorkers().find((w) => w.url().includes("background.js"));
for (let i = 0; i < 60 && !sw; i++) { await sleep(250); sw = ctx.serviceWorkers().find((w) => w.url().includes("background.js")); }

const page = await ctx.newPage();
await page.goto(origin, { waitUntil: "domcontentloaded" });
let r = null;
for (let i = 0; i < 160 && !r; i++) { await sleep(500); r = await page.evaluate(() => (window.__done ? window.__r : null)).catch(() => null); }

console.log("=== result ===");
console.log(JSON.stringify(r, null, 2));
const ok = r && r.direct && r.a && r.b && !String(r.a).startsWith("ERR") && !String(r.b).startsWith("ERR")
  && r.a !== r.direct && r.b !== r.direct && r.a !== r.b;
console.log("\ndirect (your real IP):", r?.direct);
console.log("via Veil, account A  :", r?.a);
console.log("via Veil, account B  :", r?.b);
console.log("\nrouted, hidden, and per-account distinct:", ok ? "YES" : "NO");
await ctx.close();
srv.close();
process.exit(ok ? 0 : 1);
