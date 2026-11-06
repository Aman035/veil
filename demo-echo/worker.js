// Veil live-demo IP echo. Deploy as a Cloudflare Worker (free). It reports the
// IP it saw the request come from: your real IP on a direct read, a Tor exit
// when Veil routed the read. We control it, so it never blocks Tor (unlike many
// public IP services). It holds no logs and needs no state.
//
// Deploy (dashboard, ~2 min):
//   1. dash.cloudflare.com -> Workers & Pages -> Create -> Create Worker
//   2. paste this file, Deploy
//   3. copy the *.workers.dev URL and set ECHO in site/demo.html to it
// Or with wrangler:  npx wrangler deploy demo-echo/worker.js --name veil-echo
export default {
  async fetch(request) {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "cache-control": "no-store",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const ip = request.headers.get("CF-Connecting-IP") || "";
    // ip (plain), result (JSON-RPC shape) and origin (httpbin shape) so any reader works.
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, ip, origin: ip, result: ip });
    return new Response(body, { headers: { "content-type": "application/json", ...cors } });
  },
};
