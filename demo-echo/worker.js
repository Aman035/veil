// Veil live-demo echo + thin RPC proxy. Deploy as a Cloudflare Worker (free).
// It reports the IP it saw the request from (your real IP on a direct read, a
// Tor exit when Veil routed the read) AND forwards the JSON-RPC call to a real
// Ethereum provider, so the demo shows real data over a real RPC while still
// revealing the exit IP. No logs, no state; never blocks Tor (you own it).
//
// Deploy (dashboard, ~2 min): dash.cloudflare.com -> Workers & Pages -> Create
//   Worker -> paste this -> Deploy -> copy the *.workers.dev URL into site/demo.html.
// Or:  npx wrangler deploy demo-echo/worker.js --name veil-echo
const UPSTREAM = "https://ethereum-rpc.publicnode.com";
const UPSTREAM_NAME = "publicnode";
export default {
  async fetch(request) {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "cache-control": "no-store",
      "content-type": "application/json",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const ip = request.headers.get("CF-Connecting-IP") || "";
    let upstream = {};
    if (request.method === "POST") {
      const body = await request.text();
      try {
        const r = await fetch(UPSTREAM, { method: "POST", headers: { "content-type": "application/json" }, body });
        upstream = await r.json();
      } catch { /* IP is still reported */ }
    }
    const out = JSON.stringify({ ip, origin: ip, provider: UPSTREAM_NAME, ...upstream });
    return new Response(out, { headers: cors });
  },
};
