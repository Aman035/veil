// Tiny IP echo for the live demo. Reports the IP it was reached from:
// Cloudflare sets CF-Connecting-IP at its edge, so behind a trycloudflare
// tunnel this is your real IP on a direct read and the Tor exit when Veil
// routed the read. No logs, no state. Pairs with serve-local.mjs.
import { createServer } from "node:http";
const PORT = Number(process.env.PORT || 8799);
createServer((req, res) => {
  const ip =
    req.headers["cf-connecting-ip"] ||
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "";
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "cache-control": "no-store",
    "content-type": "application/json",
  };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  res.writeHead(200, cors);
  res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, ip, origin: ip, result: ip }));
}).listen(PORT, () => console.log("echo on http://localhost:" + PORT));
