// Page side of the desktop-helper test: the EF browser harness running tor-js, exposed to the host.
import { AnonRpcWorker } from "@anon-rpc/browser-harness";
const BOOT_RPC = "https://ethereum-rpc.publicnode.com";
const rpcProvider = { request: async ({ method, params }) => {
  const r = await fetch(BOOT_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result; } };
const t0 = performance.now();
const worker = new AnonRpcWorker({ address: "0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e",
  config: { gateways: ["152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ"] }, preExisting: { rpcProvider } });
window.__ready = worker.ready.then(() => Math.round(performance.now() - t0));
window.anonFetch = async (url, body, isolationKey) => {
  const r = await worker.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, anonOptions: { isolationKey } });
  return r.text();
};
