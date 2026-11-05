// Account-mapping heuristic (Phase 0 KT#3; graduates to product code).
//
// Goal: assign each JSON-RPC request to a routing key so that one account's
// traffic shares a Tor circuit and two accounts never do.
//
// Rules (PRD §5.2, requirement E3):
//  - The extension KNOWS the user's accounts from the wallet (eth_accounts /
//    EIP-6963). It can also LEARN addresses from balance/nonce queries.
//  - A request maps to an account if a KNOWN account address appears in its
//    params or inside eth_call calldata. We only ever match known addresses,
//    never "extract" one — so shared infra (routers, tokens, spenders) in
//    calldata can't create a false link.
//  - The zero address is ignored (a mis-keyed eth_call `from` is 0x000…; E5).
//  - No known account present -> the shared NEUTRAL route.
//  - Two or more DISTINCT known accounts in one request -> AMBIGUOUS; route to
//    a dedicated "mixed" key, never to either account's key (conservative:
//    "when unsure, use a fresh route", PRD §11).

const ZERO = "0000000000000000000000000000000000000000";

export const NEUTRAL = "neutral";

/** Normalise to lowercase 40-hex with no 0x; null if not an address. */
export function norm(addr) {
  if (typeof addr !== "string") return null;
  const h = addr.toLowerCase().replace(/^0x/, "");
  return /^[0-9a-f]{40}$/.test(h) ? h : null;
}

/** Addresses the extension can LEARN from a read (balance/nonce name the user). */
export function learnableAddresses(call) {
  const out = [];
  const p = call.params || [];
  if (call.method === "eth_getBalance" || call.method === "eth_getTransactionCount") {
    const a = norm(p[0]);
    if (a && a !== ZERO) out.push(a);
  }
  return out;
}

/**
 * Which known accounts are mentioned by this request.
 * Searches the whole stringified params (covers plain address params AND
 * 32-byte left-padded addresses embedded in eth_call calldata).
 */
export function accountsMentioned(call, knownSet) {
  if (knownSet.size === 0) return [];
  const hay = JSON.stringify(call.params ?? []).toLowerCase();
  const hit = new Set();
  for (const a of knownSet) {
    if (a !== ZERO && hay.includes(a)) hit.add(a);
  }
  return [...hit];
}

/** Routing key for a single call, given the known accounts. */
export function routeKey(call, knownSet) {
  const hit = accountsMentioned(call, knownSet);
  if (hit.length === 0) return NEUTRAL;
  if (hit.length === 1) return "acct:" + hit[0];
  return "mixed:" + hit.sort().join(",");
}

/**
 * Stateful router: learns addresses as it goes (optional) on top of any the
 * wallet already told it. Mirrors how the extension would run live.
 */
export function createRouter(walletAccounts = []) {
  const known = new Set();
  for (const a of walletAccounts) { const n = norm(a); if (n && n !== ZERO) known.add(n); }
  return {
    known,
    observe(call) { for (const a of learnableAddresses(call)) known.add(a); },
    route(call) { return routeKey(call, known); },
  };
}
