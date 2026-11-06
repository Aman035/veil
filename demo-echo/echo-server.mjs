// Demo echo + thin RPC proxy. It reports the IP it was reached from (your real
// IP on a direct read, a Tor exit when Veil routed the read) AND forwards the
// JSON-RPC call to a real Ethereum provider, so the demo shows real data over a
// real RPC while still revealing the exit IP. No logs, no state.
import { createServer } from "node:http";
const PORT = Number(process.env.PORT || 8799);
const UPSTREAM = process.env.UPSTREAM || "https://ethereum-rpc.publicnode.com";
const UPSTREAM_NAME = process.env.UPSTREAM_NAME || "publicnode";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "cache-control": "no-store",
  "content-type": "application/json",
};
const ipOf = (req) =>
  req.headers["cf-connecting-ip"] ||
  (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
  req.socket.remoteAddress || "";

createServer(async (req, res) => {
  const ip = ipOf(req);
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
  if (req.method === "POST") {
    let body = "";
    for await (const c of req) body += c;
    let upstream = {};
    try {
      const r = await fetch(UPSTREAM, { method: "POST", headers: { "content-type": "application/json" }, body });
      upstream = await r.json();
    } catch { /* leave upstream empty; the IP is still reported */ }
    res.writeHead(200, CORS);
    // ip/origin: the IP we saw. result: the real RPC answer. provider: who served it.
    return res.end(JSON.stringify({ ip, origin: ip, provider: UPSTREAM_NAME, ...upstream }));
  }
  res.writeHead(200, CORS);
  res.end(JSON.stringify({ ip, origin: ip, provider: UPSTREAM_NAME }));
}).listen(PORT, () => console.log(`echo+proxy on http://localhost:${PORT} -> ${UPSTREAM_NAME}`));
