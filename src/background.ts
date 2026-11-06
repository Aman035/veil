// Background service worker: owns the anon-rpc harness (tor-js), routes each
// page RPC through it with a per-account isolation key, blinds request ids, and
// keeps the stats the popup shows.
import { AnonRpcWorker } from "@anon-rpc/browser-extension-harness";
import { KnownAccounts, routeKeyForBody, NEUTRAL } from "./shared/routing";
import { classifyEndpoint, torFriendlyFor } from "./shared/providers";
import type { TabStats, GlobalStats, SitePolicy } from "./shared/protocol";

// Network is configurable (PRD §11: swappable gateways / specifiers). Defaults
// to tor-js on mainnet + the EF demo gateway; build with UNLINK_SPECIFIER /
// UNLINK_GATEWAYS to point elsewhere (e.g. the passthrough specifier for tests).
declare const __UNLINK_SPECIFIER__: string;
declare const __UNLINK_GATEWAYS__: string;
const SPECIFIER = __UNLINK_SPECIFIER__;
const GATEWAYS: string[] = JSON.parse(__UNLINK_GATEWAYS__);
const BOOT_RPC = "https://ethereum-rpc.publicnode.com";

// ---- settings ----
async function getEnabled(): Promise<boolean> {
  const r = await chrome.storage.local.get({ enabled: true });
  return !!r.enabled;
}
async function getExcluded(): Promise<string[]> {
  const r = await chrome.storage.local.get({ excluded: [] });
  return r.excluded as string[];
}
async function isProtected(origin: string): Promise<boolean> {
  if (!(await getEnabled())) return false;
  return !(await getExcluded()).includes(origin);
}

// ---- per-site policy (PRD §5.3): origin -> "ask" | "block" | "allow-direct" ----
// Only consulted when a provider blocks anonymous access AND the request can't
// be safely re-routed. Default "ask". "allow-direct" is the only sanctioned
// path to a direct (non-private) connection, and it is per-site and explicit.
async function getPolicies(): Promise<Record<string, SitePolicy>> {
  const r = await chrome.storage.local.get({ sitePolicies: {} });
  return (r.sitePolicies || {}) as Record<string, SitePolicy>;
}
async function getPolicy(origin: string): Promise<SitePolicy> {
  const p = (await getPolicies())[origin];
  return p === "block" || p === "allow-direct" ? p : "ask";
}
async function setPolicy(origin: string, policy: SitePolicy): Promise<void> {
  const all = await getPolicies();
  if (policy === "ask") delete all[origin];
  else all[origin] = policy;
  await chrome.storage.local.set({ sitePolicies: all });
}

// ---- desktop helper detection + pairing (PRD §5.1, §7.2 D2) ----
// The companion desktop helper (a SEPARATE program) serves a health endpoint on
// loopback. We poll it so (a) the popup can show whether the wallet's own
// traffic is covered, and (b) the chrome.proxy target (D2) is only ever armed
// when the helper is actually present. Absence = any error/timeout = "not
// installed". The background SW is allowed to fetch loopback via <all_urls>.
const HELPER_HEALTH = "http://127.0.0.1:18545/__unlink/health";
let helperConnected = false;
let helperInfo: { network?: string; harness?: string } = {};

async function pollHelper(): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1500); // short timeout -> snappy "absent"
  try {
    const res = await fetch(HELPER_HEALTH, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error("status " + res.status);
    const j: any = await res.json();
    helperConnected = j && j.ok === true;
    helperInfo = helperConnected ? { network: j.network, harness: j.harness } : {};
  } catch {
    helperConnected = false;
    helperInfo = {};
  } finally {
    clearTimeout(t);
  }
  await applyProxy(); // helper presence changes whether D2 may be armed
  return helperConnected;
}

// ---- D2: chrome.proxy target for the wallet's own traffic (opt-in, safe) ----
// Status: WIRED, pending the helper's proxy endpoint.
//
// When routeWalletTraffic (default FALSE) is on AND the helper is present, we
// set a PAC script that routes a curated list of wallet + crypto API hosts to
// the helper's local proxy, and DIRECT for everything else. When off or the
// helper is absent, we CLEAR the proxy so nothing is ever silently misrouted.
//
// CRITICAL (evidence.md E1): Chrome NEVER proxies loopback addresses. A loopback
// PROXY target would be ignored and the request would fall back to DIRECT — a
// "direct but thinks it's private" path, which CLAUDE.md forbids. So the proxy
// is armed ONLY when the target is a real NON-loopback host. The placeholder
// below is loopback, so D2 stays wired-but-inert until the desktop helper ships
// its real non-loopback proxy endpoint (separate track); replace HELPER_PROXY
// then and HELPER_PROXY_READY flips true automatically.
const HELPER_PROXY_HOST = "127.0.0.1"; // PLACEHOLDER — needs the helper's NON-loopback proxy host
const HELPER_PROXY_PORT = 18546;       // PLACEHOLDER — the helper's proxy port
const HELPER_PROXY = `PROXY ${HELPER_PROXY_HOST}:${HELPER_PROXY_PORT}`;
function isLoopback(h: string): boolean {
  return h === "localhost" || h === "::1" || h === "127.0.0.1" || h.startsWith("127.");
}
const HELPER_PROXY_READY = !isLoopback(HELPER_PROXY_HOST);

// Curated wallet + crypto API hosts to route through the helper when armed.
// Short and hardcoded on purpose (no remote config, PRD E8). "*.host" matches
// any subdomain of host.
const WALLET_PROXY_HOSTS = [
  "accounts.api.cx.metamask.io",
  "*.api.cx.metamask.io",
  "*.infura.io",
  "mainnet.gateway.tenderly.co",
  "cloudflare-eth.com",
  "rpc.ankr.com",
  "eth.llamarpc.com",
];

function buildPac(): string {
  const hosts = JSON.stringify(WALLET_PROXY_HOSTS);
  const proxy = JSON.stringify(HELPER_PROXY);
  return `function FindProxyForURL(url, host) {
  var hosts = ${hosts};
  for (var i = 0; i < hosts.length; i++) {
    var h = hosts[i];
    if (h.charAt(0) === "*") {
      var suf = h.slice(1);
      if (host.length > suf.length && host.slice(host.length - suf.length) === suf) return ${proxy};
    } else if (host === h) {
      return ${proxy};
    }
  }
  return "DIRECT";
}`;
}

async function getRouteWalletTraffic(): Promise<boolean> {
  const r = await chrome.storage.local.get({ routeWalletTraffic: false });
  return !!r.routeWalletTraffic;
}
function walletProxyActive(route: boolean): boolean {
  return route && helperConnected && HELPER_PROXY_READY;
}
async function applyProxy(): Promise<void> {
  if (!chrome.proxy?.settings) return; // API unavailable (missing permission/policy)
  const armed = walletProxyActive(await getRouteWalletTraffic());
  try {
    if (armed) {
      await chrome.proxy.settings.set({
        scope: "regular",
        // mandatory: on PAC failure do NOT silently fall back to direct.
        value: { mode: "pac_script", pacScript: { data: buildPac(), mandatory: true } },
      });
    } else {
      // off / helper absent / endpoint not yet real: CLEAR -> no silent misroute.
      await chrome.proxy.settings.clear({ scope: "regular" });
    }
  } catch { /* policy-controlled proxy or transient error: leave settings as-is */ }
}

// Pair on boot, then keep checking. applyProxy() in pollHelper also CLEARS any
// stale proxy left from a previous session until the helper + endpoint are real.
pollHelper();
setInterval(() => { pollHelper(); }, 10000);

// ---- keep the MV3 service worker alive during boot / in-flight work ----
// Without this Chrome suspends the idle SW (~30s) mid-boot and the tor-js boot
// (~20-28s) never completes. An extension API call every 20s resets the timer.
let activeWork = 0;
let keepTimer: ReturnType<typeof setInterval> | null = null;
function keepAlive(on: boolean) {
  if (on) {
    activeWork++;
    if (!keepTimer) keepTimer = setInterval(() => { try { chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError); } catch {} }, 20000);
  } else {
    activeWork = Math.max(0, activeWork - 1);
    if (activeWork === 0 && keepTimer) { clearInterval(keepTimer); keepTimer = null; }
  }
}

// ---- harness ----
let worker: AnonRpcWorker | undefined;
let harness: GlobalStats["harness"] = "idle";
let harnessMs: number | undefined;
const rpcProvider = {
  async request({ method, params }: { method: string; params?: unknown[] }) {
    const r = await fetch(BOOT_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.result;
  },
};
function getWorker(): AnonRpcWorker {
  if (!worker) {
    harness = "booting";
    keepAlive(true);
    const t0 = Date.now();
    worker = new AnonRpcWorker({ address: SPECIFIER, config: GATEWAYS.length ? { gateways: GATEWAYS } : {}, preExisting: { rpcProvider } });
    worker.ready.then(
      () => { harness = "ready"; harnessMs = Date.now() - t0; keepAlive(false); },
      () => { harness = "error"; keepAlive(false); },
    );
  }
  return worker;
}
// Boot early when enabled so the first request isn't the one that waits.
getEnabled().then((e) => { if (e) getWorker(); });

// Rebuild the harness after an error (popup "tap to retry"). Only meaningful
// once the previous attempt has settled into "error".
function rebootWorker() {
  if (harness === "booting") return;
  worker = undefined;
  harness = "idle";
  harnessMs = undefined;
  getWorker();
}

// ---- per-origin accounts + per-tab stats ----
const accountsByOrigin = new Map<string, KnownAccounts>();
function knownFor(origin: string): KnownAccounts {
  let k = accountsByOrigin.get(origin);
  if (!k) { k = new KnownAccounts(); accountsByOrigin.set(origin, k); }
  return k;
}
const tabStats = new Map<number, TabStats>();
function statsFor(tabId: number, origin: string): TabStats {
  let s = tabStats.get(tabId);
  if (!s || s.origin !== origin) {
    s = { origin, isProtected: false, total: 0, protectedCount: 0, routes: [], rerouted: 0, blocked: 0, direct: 0 };
    tabStats.set(tabId, s);
  }
  return s;
}
let today = { day: new Date().toDateString(), requests: 0, sites: new Set<string>() };
function bumpToday(origin: string) {
  const d = new Date().toDateString();
  if (d !== today.day) today = { day: d, requests: 0, sites: new Set() };
  today.requests++; today.sites.add(origin);
}

// ---- id blinding (viem uses one global counter; unlink them) ----
function blind(body: any): { sent: any; restore: (resp: any) => any } {
  const rnd = () => Math.floor(Math.random() * 1e9) + 1;
  if (Array.isArray(body)) {
    const map = new Map<any, any>();
    const sent = body.map((c) => { const nid = rnd(); map.set(nid, c.id); return { ...c, id: nid }; });
    return { sent, restore: (resp) => Array.isArray(resp) ? resp.map((r) => ({ ...r, id: map.has(r.id) ? map.get(r.id) : r.id })) : resp };
  }
  const origId = body?.id;
  const nid = rnd();
  return { sent: { ...body, id: nid }, restore: (resp) => (resp && typeof resp === "object" ? { ...resp, id: origId } : resp) };
}

// Send a (blinded) body through the harness to one endpoint; classify the
// outcome. A JSON-RPC-level error is still a valid answer (not a transport
// block); a non-2xx or non-JSON (bot-check) body is a block.
type SendResult = { ok: true; json: unknown } | { ok: false; reason: string };
async function sendVia(target: string, sentBody: unknown, key: string): Promise<SendResult> {
  try {
    const res = await getWorker().fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json" }, // identifying headers intentionally omitted
      body: JSON.stringify(sentBody),
      anonOptions: { isolationKey: key },
    } as RequestInit);
    if (!res.ok) return { ok: false, reason: `status ${res.status}` };
    const text = await res.text();
    try { return { ok: true, json: JSON.parse(text) }; }
    catch { return { ok: false, reason: "non-JSON response (bot check?)" }; }
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message ?? String(e) };
  }
}

// ---- the route ----
async function routeRpc(url: string, body: unknown, origin: string, tabId: number) {
  const known = knownFor(origin);
  known.observe(body); // learn addresses from balance/nonce reads
  const key = routeKeyForBody(body, known.set);
  const { sent, restore } = blind(body);

  const s = statsFor(tabId, origin);
  s.isProtected = true;
  const addRoute = () => { if (!s.routes.includes(key)) s.routes.push(key); };

  // Harness down (not a provider block): fail closed, never go direct, never
  // ask to allow-direct. Matches the popup's "Paused: not private" (PRD §6.3).
  if (harness === "error") {
    return { ok: false, error: "unlink: paused — the anonymizing network is unavailable (not private)", routeKey: key };
  }

  s.total++; bumpToday(origin);

  keepAlive(true);
  try {
    // Attempt 1: the dapp's own endpoint, over Tor.
    const first = await sendVia(url, sent, key);
    if (first.ok) { s.protectedCount++; addRoute(); return { ok: true, status: 200, body: restore(first.json), routeKey: key }; }

    // Blocked. Re-route only for a known single-chain standard RPC (E4/E5).
    const cls = classifyEndpoint(url);
    if ("chainId" in cls) {
      const here = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
      for (const p of torFriendlyFor(cls.chainId)) {
        if (new URL(p).hostname === here) continue;
        const rr = await sendVia(p, sent, key);
        if (rr.ok) { s.rerouted++; s.protectedCount++; addRoute(); return { ok: true, status: 200, body: restore(rr.json), routeKey: key, rerouted: true }; }
      }
      s.blocked++;
      return { ok: false, blocked: true, error: "unlink: provider blocked anonymous access and re-routing failed", routeKey: key };
    }

    // Not safely re-routable (multichain gateway / custom backend) -> site policy.
    const policy = await getPolicy(origin);
    if (policy === "allow-direct") {
      // The user explicitly allowed a direct (non-private) connection for this
      // site. The page performs the real native request itself (inject.ts).
      s.direct++;
      return { ok: false, allowDirect: true, error: "unlink: allowed direct for this site (not private)", routeKey: key };
    }
    if (policy === "block") {
      s.blocked++;
      return { ok: false, blocked: true, error: "unlink: this site's provider blocks anonymous access — kept blocked", routeKey: key };
    }
    // "ask" (default): tell the page to show the one-time dialog; don't count it
    // as blocked yet — the retry after the user's choice records the outcome.
    return { ok: false, blocked: true, needsPolicy: true, error: "unlink: this site's provider blocks anonymous access", routeKey: key };
  } finally {
    keepAlive(false);
  }
}

// ---- messaging ----
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  const origin = msg?.origin ?? (sender.origin || "");
  const tabId = sender.tab?.id ?? -1;

  if (msg?.type === "get-state") {
    (async () => respond({ enabled: await getEnabled(), isProtected: await isProtected(origin) }))();
    return true;
  }
  if (msg?.type === "accounts") {
    const known = knownFor(origin);
    if (known.addMany(msg.accounts || [])) { /* accounts grew */ }
    respond({ ok: true });
    return true;
  }
  if (msg?.type === "rpc") {
    (async () => {
      if (!(await isProtected(origin))) { respond({ ok: false, error: "unlink: not protected" }); return; }
      respond(await routeRpc(msg.url, msg.body, origin, tabId));
    })();
    return true;
  }

  // popup API
  if (msg?.type === "popup:get") {
    (async () => {
      pollHelper(); // refresh helper state for the next 1s popup refresh (don't block)
      const route = await getRouteWalletTraffic();
      const g: GlobalStats = {
        enabled: await getEnabled(), network: "tor", harness, harnessMs,
        todayRequests: today.requests, todaySites: today.sites.size,
        helperConnected, routeWalletTraffic: route, walletProxyActive: walletProxyActive(route),
      };
      respond(g);
    })();
    return true;
  }
  if (msg?.type === "popup:set-route-wallet") {
    (async () => {
      await chrome.storage.local.set({ routeWalletTraffic: !!msg.enabled });
      await applyProxy();
      respond({ ok: true });
    })();
    return true;
  }
  if (msg?.type === "popup:tab-stats") {
    const s = tabStats.get(msg.tabId);
    respond(s ?? null);
    return true;
  }
  if (msg?.type === "popup:toggle") {
    (async () => {
      await chrome.storage.local.set({ enabled: !!msg.enabled });
      if (msg.enabled) { if (harness === "error") rebootWorker(); else getWorker(); }
      // tell content scripts to re-pull state
      const tabs = await chrome.tabs.query({});
      for (const t of tabs) if (t.id != null) chrome.tabs.sendMessage(t.id, { type: "state-changed" }).catch(() => {});
      respond({ ok: true });
    })();
    return true;
  }
  if (msg?.type === "popup:retry") {
    rebootWorker();
    respond({ ok: true });
    return true;
  }
  if (msg?.type === "get-policy") {
    (async () => respond({ policy: await getPolicy(origin) }))();
    return true;
  }
  if (msg?.type === "set-policy") {
    (async () => { await setPolicy(origin, msg.policy); respond({ ok: true }); })();
    return true;
  }
  return false;
});

// First run: open the onboarding page (what's hidden, what isn't, one toggle).
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") }).catch(() => {});
  }
});

// Small debug surface (handy in devtools and e2e; no page can reach it).
(self as any).__unlink = {
  boot: async () => { const t0 = Date.now(); try { await getWorker().ready; return { ok: true, ms: Date.now() - t0 }; } catch (e) { return { ok: false, ms: Date.now() - t0, error: (e as Error)?.message ?? String(e) }; } },
  harness: () => ({ harness, harnessMs }),
  tab: (id: number) => tabStats.get(id),
  tabs: () => [...tabStats.entries()],
  today: () => ({ ...today, sites: [...today.sites] }),
  accounts: (o: string) => [...(accountsByOrigin.get(o)?.set ?? [])],
  policy: (o: string) => getPolicy(o),
  setPolicy: (o: string, p: SitePolicy) => setPolicy(o, p),
  reboot: () => rebootWorker(),
  // helper / D2 (handy in devtools and e2e)
  helper: () => ({ helperConnected, helperInfo }),
  pokeHelper: () => pollHelper(), // force an immediate poll; resolves to the bool
  proxy: () => ({ ready: HELPER_PROXY_READY, target: HELPER_PROXY }),
  routeWallet: async (on: boolean) => { await chrome.storage.local.set({ routeWalletTraffic: !!on }); await applyProxy(); return getRouteWalletTraffic(); },
};
