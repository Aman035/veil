# Unlink desktop helper (phase 2 skeleton)

Protects the wallet's own traffic and local tools (Foundry `cast`, scripts) by
exposing a **localhost JSON-RPC endpoint** that routes every request through the
EF anon-rpc browser harness running **tor-js**, with **one Tor circuit per
account**. This is PRD §7.2 (D1–D4). Only the localhost JSON-RPC endpoint (D3)
and the embedded harness (D1) are implemented here; the `chrome.proxy` target
(D2) and HTTPS handling (D4) are designed below, not yet built.

## Why a browser engine (D1)

The EF **Node** harness can't run tor-js: its QuickJS sandbox has no
WebAssembly (evidence.md E5). The proven path is the EF **browser** harness
(`@anon-rpc/browser-harness`, MIT) inside a headless Chromium driven by
Playwright (Apache-2.0). `helper.mjs` launches that Chromium, loads a page that
constructs an `AnonRpcWorker`, and calls its anonymized `fetch` from Node via
`page.evaluate`. Real `cast` worked over this path in E5 (and again here).

## Run

```sh
pnpm install          # inside helper/ only (never at the repo root)
pnpm start            # node helper.mjs  -> http://127.0.0.1:18545
pnpm test             # node test.mjs — starts helper, runs cast, tears down
```

Then point any tool at it:

```sh
cast block-number --rpc-url http://127.0.0.1:18545
```

Ctrl-C (SIGINT) / SIGTERM shuts down the JSON-RPC server, the asset server and
Chromium cleanly.

### Configuration (env vars)

| Var | Default | Notes |
|---|---|---|
| `HELPER_SPECIFIER` | tor-js `0x700dA3…659e` | on-chain worker specifier |
| `HELPER_GATEWAYS` | EF tor-js demo gateway (JSON array) | `[]` = passthrough |
| `HELPER_BOOT_RPC` | `https://ethereum-rpc.publicnode.com` | one specifier read |
| `HELPER_UPSTREAM` | `https://ethereum-rpc.publicnode.com` | where requests are forwarded |
| `HELPER_HOST` / `HELPER_PORT` | `127.0.0.1` / `18545` | listen address |
| `HELPER_ACCOUNTS` | *(none)* | comma-separated addresses to seed as known (wallet-oracle analog) |
| `HELPER_READY_TIMEOUT_MS` | `90000` | fail visibly if boot hangs (the boot path itself has no timeout) |

> **The EF demo gateway (`152.236.3.22:12298`) is currently down**, so real
> tor-js boot hangs indefinitely. Tests run with the **passthrough** specifier
> (`0x4fd77be3…`, gateways `[]`): plain `fetch`, no privacy, but it exercises
> all the plumbing (id blinding, per-account keying, forward + restore)
> deterministically. tor-js itself is proven in evidence.md E5/E8.

## Architecture

```
cast / wallet RPC                     headless Chromium (Playwright)
      │  POST JSON-RPC                 ┌───────────────────────────────┐
      ▼                                │ page: AnonRpcWorker (tor-js)  │
127.0.0.1:18545 ──(1)observe accounts  │  window.anonFetch(url,body,k) │
  helper.mjs    ──(2)routeKeyForBody ──┼─ page.evaluate ──► worker.fetch│──► upstream RPC
                ──(3)blind ids         │        (null-origin iframe,    │    (over Tor,
                ◄── restore ids ───────┼─────── hash-pinned worker)     │     circuit per key)
                                       └───────────────────────────────┘
```

Per incoming JSON-RPC request, `helper.mjs`:

1. **learns accounts** — `KnownAccounts.observe()` picks up the user's address
   from `eth_getBalance` / `eth_getTransactionCount` params (ignoring the zero
   address);
2. **picks the isolation key** — `routeKeyForBody()` returns `acct:<addr>` when
   a known account is mentioned (including inside `eth_call` **calldata**),
   `neutral` otherwise, `mixed:…` for ambiguous multi-account calls;
3. **blinds the JSON-RPC id** — replaces the caller's id (viem uses one global
   counter) with a fresh random id, restores the original on the response;
4. **forwards** the body through the harness anon-fetch under that key and
   returns the result.

The routing logic is **not duplicated**: it is bundled at startup straight from
the single source of truth `src/shared/routing.ts` (validated in evidence.md
E9) into `helper/.gen/routing.mjs`.

### Isolation-key approach

One key per account, so one account's traffic shares a Tor circuit/exit and two
accounts never do (PRD §5.2). The address is matched only against **known** user
addresses, so shared infrastructure appearing in calldata (a router, a token)
can't create a false link (E9: 0 false links). This also sidesteps the E5 bug
where `eth_call` was mis-keyed to the zero address — the `from` field is often
`0x0`, but the real account is inside the calldata and that is what we match.

Without a wallet oracle the helper learns accounts from balance/nonce reads
(E9's weaker "learned" mode), which is why a standalone `cast call` with an
address only in calldata keys to `neutral` until that address has been seen in
a balance/nonce query. A wallet integration (or `HELPER_ACCOUNTS`) seeds the
known set up front so the very first call is keyed correctly.

### No silent direct fallback

If the harness isn't ready within `HELPER_READY_TIMEOUT_MS`, or a forward
fails, the request fails visibly (HTTP 502 / JSON-RPC error). Nothing is ever
sent outside the harness (CLAUDE.md, PRD G4).

---

## D2 — `chrome.proxy` target (design only, not implemented)

**Goal:** also protect the wallet extension's own traffic, which the Unlink
browser extension cannot read or rewrite (`webRequest`/DNR see nothing of
another extension's requests — evidence.md E1), but *can* route by host.

**Plan:**

- The extension sets a PAC script via `chrome.proxy` that sends **wallet RPC
  and crypto API hosts** (MetaMask's RPC + its 20+ API hosts — E6; Rabby;
  common public RPCs) to a local proxy the helper runs, and everything else
  `DIRECT`. E1 measured `chrome.proxy` successfully routing another extension's
  requests 5/5.
- **Chrome never proxies loopback addresses** (E1), so the proxy must listen on
  a **non-loopback** address (e.g. a link-local/LAN IP or a `.local` host the
  helper binds), not `127.0.0.1`. The PAC returns `PROXY <that host>:<port>`.
- The proxy is an **HTTP CONNECT** proxy inside the helper. For each CONNECT it
  decides per host (see D4) whether to tunnel as-is or to terminate and
  per-account split, then sends the bytes through the same `AnonRpcWorker`
  anon-fetch, reusing the routing + id-blinding above for anything it can parse
  as JSON-RPC.
- The extension shows the user exactly which hosts are proxied vs direct; no
  host is proxied silently and none falls back to direct silently.

## D4 — HTTPS handling (design only, not implemented)

The helper gets raw TLS bytes on CONNECT, not JSON-RPC. Two tiers, chosen by
host:

1. **Tunnel as-is (default for non-RPC hosts).** Forward the encrypted stream
   through anon-fetch/Tor without decrypting. This **hides the IP** from the
   destination (the main win for wallet API hosts like price, gas, token,
   security-alerts — E6) but gives **no per-account splitting**, because the
   bodies can't be read. All of that host's traffic shares one route. Honest
   framing per PRD §8: IP hidden, linkage via the provider's own multi-account
   APIs (e.g. MetaMask's `multiaccount/balances`) **not** hidden.
   - Note: anon-rpc exposes only `fetch` (HTTP), not raw sockets/WebSocket
     (background.md). True opaque TCP tunneling may require either a tor-js
     capability that passes a byte stream, or running a local SOCKS/Tor path
     for CONNECT while keeping JSON-RPC on the harness. This is the main open
     technical question for D4 and must be measured before claiming it works.

2. **Terminate + per-account split (only where bodies can be read).** For known
   single-chain JSON-RPC hosts we control the trust story for, the helper can
   terminate TLS **locally** (a locally-generated CA the user installs, MITM of
   *our own* forwarded traffic only — never of third-party sites the user
   didn't opt in to), read the JSON-RPC body, apply the same per-account
   routing + id blinding + fallback-after-block as the extension (PRD §5.3),
   and re-originate the request over Tor. Per-account splitting happens **only**
   here, where request bodies are visible. Fallback re-routing stays
   block-triggered and limited to known single-chain endpoints (E4: blind
   reroute broke Uniswap 0/33; reroute-after-block fixed Aave 0/16 → 3/3).

No header or Origin spoofing anywhere: real sessions only (CLAUDE.md). A host
that blocks Tor and can't be re-routed surfaces a per-site choice, never a
silent direct connection.

## Files

| File | What |
|---|---|
| `helper.mjs` | main: launches Chromium, serves the harness page, runs the 127.0.0.1:18545 JSON-RPC server, does routing + id blinding (D1, D3) |
| `page-entry.mjs` | browser side: constructs `AnonRpcWorker`, exposes `anonFetch` + `__anonReady` |
| `www/helper.html` | page loaded in Chromium; imports the esbuild bundle of `page-entry.mjs` |
| `test.mjs` | starts the helper (passthrough), runs real `cast`, asserts, tears down |
| `package.json` | `@anon-rpc/browser-harness` (MIT), `playwright` (Apache-2.0), `esbuild` (MIT) |

Generated at startup (gitignored): `.gen/routing.mjs` (bundle of
`src/shared/routing.ts`), `www/page.js` (bundle of `page-entry.mjs`).
