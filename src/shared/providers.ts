// Fallback re-routing data (PRD §5.3, evidence E4/E7).
//
// Re-route ONLY after a block, and ONLY for endpoints we know are a single
// standard RPC for one chain. Blind re-routing breaks multichain gateways
// (Uniswap 0/33, E4), so those must never be rerouted — they go to site policy.

// Tor-friendly providers per chainId. publicnode served Tor 12/12 (E7); the
// others are candidates to verify against the measured Tor-friendly set before
// shipping (open question #3: ship the 10 measured-good RPCs, user-extendable).
export const TOR_FRIENDLY: Record<number, string[]> = {
  1: [
    "https://ethereum-rpc.publicnode.com", // measured Tor 12/12
    "https://eth.llamarpc.com",
    "https://rpc.mevblocker.io",
  ],
};

// Hosts that are a single standard RPC for one chain — safe to reroute.
// Keyed by hostname (scheme/port ignored).
const KNOWN_SINGLE_CHAIN: Record<string, number> = {
  "mainnet.gateway.tenderly.co": 1, // Aave's provider; blocks Tor (E4) -> reroute
  "ethereum-rpc.publicnode.com": 1,
  "eth.llamarpc.com": 1,
  "cloudflare-eth.com": 1,
  "eth.drpc.org": 1,
  "mainnet.infura.io": 1,
  "eth-mainnet.g.alchemy.com": 1,
};

// Multichain gateways / custom backends — never blindly reroute (E4).
const NEVER_REROUTE = new Set<string>([
  "entry-gateway.backend-prod.api.uniswap.org",
  "proxy-app.1inch.com",
  "node-provider-v3-app.compound.xyz", // app-specific backend
]);

export type Classification = { chainId: number } | { reroutable: false; reason: "multichain-or-custom" | "unknown" };

export function classifyEndpoint(url: string): Classification {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return { reroutable: false, reason: "unknown" }; }
  if (NEVER_REROUTE.has(host)) return { reroutable: false, reason: "multichain-or-custom" };
  const chainId = KNOWN_SINGLE_CHAIN[host];
  if (chainId) return { chainId };
  return { reroutable: false, reason: "unknown" };
}

export function torFriendlyFor(chainId: number): string[] {
  return TOR_FRIENDLY[chainId] ?? [];
}

/** Allow tests to register a host as a known single-chain endpoint. */
export function __registerKnownHost(host: string, chainId: number) {
  KNOWN_SINGLE_CHAIN[host.toLowerCase()] = chainId;
}
