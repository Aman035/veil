// Records which requests reach the "RPC provider" (18901) and the "proxy" (18902).
import { createServer } from "node:http";
export const hits = { rpc: [], redirected: [], proxy: [] };
export const rpc = createServer((req, res) => {
  if (req.url.startsWith("/redirected-by-B")) hits.redirected.push(req.url); else hits.rpc.push(req.url);
  res.setHeader("access-control-allow-origin", "*"); res.end('{"jsonrpc":"2.0","id":1,"result":"0x0"}');
}).listen(18901);
export const proxy = createServer((req, res) => { hits.proxy.push(req.url); res.end('{"jsonrpc":"2.0","id":1,"result":"0xproxied"}'); }).listen(18902);
