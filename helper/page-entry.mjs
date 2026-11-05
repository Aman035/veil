// Browser side of the desktop helper.
//
// Runs inside the headless Chromium that helper.mjs launches. It constructs an
// EF anon-rpc browser harness (@anon-rpc/browser-harness, MIT) with the
// configured specifier + gateways, and a preExisting rpcProvider that forwards
// the one specifier read to a bootstrap RPC. It then hands Node two things via
// window globals: a promise that resolves when tor-js is ready, and an
// anonymized fetch.
//
// This mirrors the proven approach in experiments/kt-helper/helper-page.mjs.
// The EF *Node* harness cannot run tor-js (QuickJS has no WebAssembly; see
// evidence.md E5), so the harness must run inside a real browser engine.
//
// __HELPER_*__ identifiers are replaced at bundle time by helper.mjs (esbuild
// `define`), so the specifier/gateways/bootstrap RPC are configurable.
import { AnonRpcWorker } from "@anon-rpc/browser-harness";

const SPECIFIER = __HELPER_SPECIFIER__;
const GATEWAYS = __HELPER_GATEWAYS__; // string[] (empty for the passthrough specifier)
const BOOT_RPC = __HELPER_BOOT_RPC__;

// Bootstrap provider: trusted for exactly one read (the specifier's workerHash).
// This breaks the "need the chain to reach the chain" dependency (SPEC §4).
const rpcProvider = {
  request: async ({ method, params }) => {
    const r = await fetch(BOOT_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.result;
  },
};

const t0 = performance.now();
const worker = new AnonRpcWorker({
  address: SPECIFIER,
  config: { gateways: GATEWAYS },
  preExisting: { rpcProvider },
});

// Node awaits this to know boot finished (and how long it took).
window.__anonReady = worker.ready.then(() => Math.round(performance.now() - t0));

// Node calls this once per JSON-RPC request. `body` is the already-blinded
// JSON-RPC body string; `isolationKey` is the per-account route key chosen on
// the Node side. Over tor-js each distinct key gets its own circuit/exit; over
// passthrough the key is carried but has no privacy effect.
window.anonFetch = async (url, body, isolationKey) => {
  const r = await worker.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    anonOptions: { isolationKey },
  });
  return { status: r.status, text: await r.text() };
};
