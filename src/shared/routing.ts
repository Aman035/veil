// Account-mapping heuristic - validated in Phase 0 KT#3 (evidence.md E9).
// Assigns each JSON-RPC request to a routing key so one account's traffic
// shares a Tor circuit and two accounts never do.

const ZERO = "0000000000000000000000000000000000000000";
export const NEUTRAL = "neutral";

export type RpcCall = { method?: string; params?: unknown[] };

/** Lowercase 40-hex, no 0x; null if not an address. */
export function norm(addr: unknown): string | null {
  if (typeof addr !== "string") return null;
  const h = addr.toLowerCase().replace(/^0x/, "");
  return /^[0-9a-f]{40}$/.test(h) ? h : null;
}

/** Addresses the extension can learn from a read (balance/nonce name the user). */
export function learnableAddresses(call: RpcCall): string[] {
  const out: string[] = [];
  const p = call.params ?? [];
  if (call.method === "eth_getBalance" || call.method === "eth_getTransactionCount") {
    const a = norm(p[0]);
    if (a && a !== ZERO) out.push(a);
  }
  return out;
}

/** Which known accounts are mentioned by this request (params + eth_call calldata). */
export function accountsMentioned(call: RpcCall, known: Set<string>): string[] {
  if (known.size === 0) return [];
  const hay = JSON.stringify(call.params ?? []).toLowerCase();
  const hit = new Set<string>();
  for (const a of known) if (a !== ZERO && hay.includes(a)) hit.add(a);
  return [...hit];
}

/** Routing key for a single call. */
export function routeKey(call: RpcCall, known: Set<string>): string {
  const hit = accountsMentioned(call, known);
  if (hit.length === 0) return NEUTRAL;
  if (hit.length === 1) return "acct:" + hit[0];
  return "mixed:" + hit.sort().join(","); // ambiguous -> dedicated route, never reuse one account's
}

/** Pick one routing key for a whole request body (single or batch). */
export function routeKeyForBody(body: unknown, known: Set<string>): string {
  const calls: RpcCall[] = Array.isArray(body) ? (body as RpcCall[]) : [body as RpcCall];
  const keys = new Set(calls.map((c) => routeKey(c, known)));
  // A batch that touches one account -> that account; mixed/neutral collapse sensibly.
  const nonNeutral = [...keys].filter((k) => k !== NEUTRAL);
  if (nonNeutral.length === 0) return NEUTRAL;
  if (nonNeutral.length === 1) return nonNeutral[0];
  return "mixed:" + nonNeutral.map((k) => k.replace(/^acct:/, "")).sort().join(",");
}

/** Stateful account set: seeded from the wallet, grown from observed reads. */
export class KnownAccounts {
  readonly set = new Set<string>();
  addMany(addrs: Iterable<unknown>): boolean {
    let changed = false;
    for (const a of addrs) {
      const n = norm(a);
      if (n && n !== ZERO && !this.set.has(n)) { this.set.add(n); changed = true; }
    }
    return changed;
  }
  observe(body: unknown): boolean {
    const calls: RpcCall[] = Array.isArray(body) ? (body as RpcCall[]) : [body as RpcCall];
    let changed = false;
    for (const c of calls) if (this.addMany(learnableAddresses(c))) changed = true;
    return changed;
  }
}
