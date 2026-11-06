// Service worker for the kill-test extension.
// Runs the EF extension harness with the tor-js specifier + EF demo gateway,
// exactly as the product MVP would. Exposes helpers on `self` so the Playwright
// runner can drive it via serviceWorker.evaluate().
import { AnonRpcWorker } from "@anon-rpc/browser-extension-harness";

// From docs/background.md (all on mainnet).
const TOR_SPECIFIER = "0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e";
const GATEWAYS = ["152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ"];
const BOOT_RPC = "https://ethereum-rpc.publicnode.com";

// The one specifier read (§4) is proxied back to this pre-existing provider.
const rpcProvider = {
  async request({ method, params }: { method: string; params?: unknown[] }) {
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

let worker: AnonRpcWorker | undefined;
function getWorker(): AnonRpcWorker {
  if (!worker) {
    worker = new AnonRpcWorker({
      address: TOR_SPECIFIER,
      config: { gateways: GATEWAYS },
      preExisting: { rpcProvider },
    });
  }
  return worker;
}

const g = self as unknown as {
  anonReady: () => Promise<{ ok: boolean; readyMs: number; error?: string }>;
  anonFetch: (url: string, body: unknown, isolationKey?: string) => Promise<unknown>;
  anonGet: (url: string, isolationKey?: string) => Promise<unknown>;
};

// GET through the worker - used to read the Tor exit IP per isolation key,
// proving different keys get different circuits/exits.
g.anonGet = async (url: string, isolationKey?: string) => {
  const w = getWorker();
  await w.ready;
  try {
    const res = await w.fetch(url, {
      method: "GET",
      ...(isolationKey ? { anonOptions: { isolationKey } } : {}),
    } as RequestInit);
    return { ok: true, status: res.status, text: await res.text() };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e) };
  }
};

g.anonReady = async () => {
  const t0 = Date.now();
  try {
    await getWorker().ready;
    return { ok: true, readyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, readyMs: Date.now() - t0, error: (e as Error)?.message ?? String(e) };
  }
};

g.anonFetch = async (url: string, body: unknown, isolationKey?: string) => {
  const w = getWorker();
  await w.ready;
  const t0 = Date.now();
  try {
    const res = await w.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      ...(isolationKey ? { anonOptions: { isolationKey } } : {}),
    } as RequestInit);
    const json = await res.json();
    return { ok: true, ms: Date.now() - t0, status: res.status, json };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: (e as Error)?.message ?? String(e) };
  }
};
