# Evidence

Every *(measured)* claim in `prd.md` comes from here. Tests ran 4–6 Nov 2026 on macOS, Chromium (Playwright), a local Tor daemon (SOCKS 9150, `IsolateSOCKSAuth`), and tor-js through the EF browser harness. Scripts are in `experiments/` (throwaway research code, not product code).

## E1. Can an extension see or route another extension's (the wallet's) traffic? (`experiments/kt-ext`)
Extension A posted JSON-RPC every 500 ms; extension B tried three ways:
- `webRequest` observation: **0** of A's requests visible.
- `declarativeNetRequest` redirect: **0** redirected.
- `chrome.proxy` (PAC): **5/5** of A's requests went to B's proxy; 0 direct. Web pages too. (Chrome never proxies loopback, so the test used a non-loopback hostname.)

=> An extension can't read or rewrite the wallet's requests, but can route all of them (by host) to a proxy server, which must be a separate program.

## E2. Do dapps read through the wallet or directly? (`experiments/kt-dapps/run.mjs`)
Fake EIP-1193/EIP-6963 wallet "connected" as 0xd8dA…6045, ~25 s per dapp:

| Dapp | Direct JSON-RPC calls | Naming the user | Through the wallet | Direct host |
|---|---|---|---|---|
| Uniswap | 19 | 0 | 0 | entry-gateway.backend-prod.api.uniswap.org |
| Aave | 3 | 3 | 0 | mainnet.gateway.tenderly.co |
| Compound | 6 | 0 | 0 | node-provider-v3-app.compound.xyz |
| Lido | 21 | 0 | 0 | stake.lido.fi |
| ENS | 126 | 2 | 0 | lb.drpc.live |
| Curve | 0 | 0 | 0 | - |
| Morpho | 4 | 2 | 0 | app.morpho.org |
| Pendle | 0 | 0 | 0 | - |
| 1inch | 237 | 1 | 1 | proxy-app.1inch.com |
| Safe | 1 | 1 | 2 | rpc.safe.global |

Caveats: connect flows only partly completed, so per-user reads are undercounted; REST/GraphQL calls weren't counted.

## E3. Does a page-level fetch/XHR wrapper catch dapp libraries? (`experiments/kt-intercept`)
- Caught: viem, ethers v6, ethers v5, raw XHR.
- Missed: fetch from a Web Worker. WebSocket isn't covered by the wrapper.

## E4. Dapps used over Tor, as-is and with re-routing (`experiments/kt-tor-dapps`)
Whole browser proxied through Tor; fake connected wallet; ~35 s per dapp. "Re-routed" = every JSON-RPC call sent to publicnode over Tor instead.

| Dapp | Over Tor as-is | Re-routed (blind) |
|---|---|---|
| Uniswap | 12/19 | **0/33** (gateway is not a plain mainnet RPC) |
| Aave | **0/16** (Tenderly blocks Tor) | **3/3** |
| Compound | 6/6 | 6/6 |
| Lido | 5/5 | 5/5 |
| ENS | 31/31 | 13/14 |
| Morpho | 3/3 | 3/3 |
| Spark (Alchemy) | 32/32 | 32/32 |
| 1inch, Euler | whole page blocked (bot check) | same |
| Safe | no JSON-RPC without a real session | - |

Earlier direct-vs-Tor replay of captured requests (`replay.mjs`): Lido 3/3 and ENS 3/3 over Tor; Morpho 1/3; Aave's Tenderly gateway 0/3 (403); 1inch 0/3 (challenge page). Uniswap, Compound, Safe, Alchemy and Euler failed directly too in the replay (missing browser auth), so inconclusive there. A re-run with hand-set Origin headers was stopped by a safety check (bot-check circumvention) and not pursued: **test with real browser sessions, never by spoofing headers.**

## E5. Desktop helper (`experiments/kt-helper`)
- The EF Node harness can't run tor-js: its QuickJS sandbox has no WebAssembly, and KPS and storage are throwing stubs. A `socket` capability is proposed, not in the spec (anon-rpc `impl/node-harness/README.md`, Status).
- Working path: the EF browser harness in a hidden Chromium behind a localhost JSON-RPC server. Real Foundry `cast` against http://127.0.0.1:18545:

| Command | Time |
|---|---|
| tor-js ready | 15–19 s |
| `cast block-number` | 1.5 s |
| `cast balance` (two addresses) | 1.6 s, 3.4 s |
| `cast nonce` | 2.6 s |
| `cast call` (USDC balanceOf) | 3.3 s |

- **Bug found:** the `eth_call` was keyed to the zero address (`from: 0x000…`); the real account was inside the calldata.

## E6. MetaMask's own traffic
- MetaMask's source (MetaMask/metamask-extension and MetaMask/core) references 20+ API hosts beyond RPC: accounts, price, token(s), gas, security-alerts, compliance, tx-sentinel, bridge, swap, nft, on-ramp, client-config…
- `accounts.api.cx.metamask.io/v4/multiaccount/balances` takes all accounts in one request.
- Over Tor (3 tries each): client-config, gas, price, token list all 200/200/200. The accounts endpoint returned 400 both directly and over Tor (query format), so inconclusive.

## E7. Earlier measurements reused
- Free public RPCs over Tor (3 rounds, 24 endpoints, 4 Nov 2026): 10 serve Tor, 1 unreliable (Tenderly), 2 need keys, 11 down for everyone.
- tor-js via anon-rpc (2 Nov): requests ~1.4 s; isolation keys give different exits. Nym (4 Nov): works, ~1 s warm, **drops custom headers and ignores isolation keys**.
- viem numbers every JSON-RPC request with one process-wide counter (`viem/utils/rpc/id.ts`), which links requests across routes unless ids are blinded.

## E8. EF extension harness + tor-js inside *our* MV3 extension (Phase 0 KT#1) — 6 Nov 2026 (`experiments/kt-ext-harness`)
A minimal MV3 extension built around `@anon-rpc/browser-extension-harness` 0.4.0: service worker constructs `AnonRpcWorker` with the tor-js specifier `0x700dA3…659e`, EF demo gateway, `publicnode` as the one preExisting provider; offscreen + sandbox static assets (`anon-rpc/0.4.0-73a0ec42/`) copied in by the build. Driven by Playwright 1.64.1 (headless Chromium) via `serviceWorker.evaluate`.

| Check | Result |
|---|---|
| `worker.ready` (harness + tor-js boot, first run) | ✅ 20–28 s across runs |
| `eth_blockNumber` over tor-js | ✅ 2.5–5.3 s, status 200 |
| `eth_getBalance` (vitalik) over tor-js | ✅ 0.9–3.6 s, correct balance |
| Two isolation keys → two Tor exit IPs | ✅ e.g. `171.25.193.78` vs `45.9.168.92`; `185.220.101.98` vs `192.42.116.54` |

=> The whole MVP transport (EF extension harness + tor-js + per-account isolation keys → distinct circuits/exits) works **inside our own extension**, not just the standalone harness. Ready is ~8 s slower than the standalone browser harness (E5: 15–19 s), the offscreen-document hop on first boot.

**Coexistence:** loaded alongside a MetaMask-shaped **stand-in** (our own code: its own offscreen document + sandboxed iframe + MAIN-world `window.ethereum`). Both service workers booted; our harness still reached ready (20.5 s) and fetched; different exits held. => Two offscreen-using MV3 extensions coexist (the offscreen-doc singleton is per-extension; sandboxed iframes don't collide). **Not yet tested against the real MetaMask binary** — the sandbox blocked launching Chromium with downloaded third-party extension code; architectural risk cleared via the stand-in, MetaMask-specific run pending approval.

## E9. Account-mapping heuristic vs real dapp traffic (Phase 0 KT#3) — 6 Nov 2026 (`experiments/kt-account-map`)
Captured 63 JSON-RPC requests (82 calls after expanding batches) from 6 dapps browsed in **real** Chromium sessions (no UA/header spoofing), each "connected" (read-only fake wallet) as a **distinct** active public address. Scored the heuristic (`heuristic.mjs`, a product-candidate module) for false/missed links.

- **Wallet-oracle mode** (the real product condition — extension knows the user's accounts from the wallet): **0 false links, 0 missed**, 9 calls keyed to the right account, 73 account-agnostic calls to the neutral route. Correct on all 82.
- **8 of 9** account-naming hits had the address embedded in **eth_call calldata** (32-byte left-padded), not a plain param — the hardest case and the one a naive "extract an address" mapper would mis-key to a router/token. The heuristic matches only known user addresses, so shared infra in calldata can't create a link; validated empirically.
- **Learned-only mode** (no wallet oracle; learn addresses from balance/nonce reads): discovered 0 of 6 — because the automated connect flow only partially completes, so dapps didn't issue `eth_getBalance`/`eth_getTransactionCount` for the user. => Learning from reads is a weak fallback; the extension must take accounts from the wallet (always available via `eth_accounts`/EIP-6963).

Caveats: account-naming sample is modest (9/82) for the same reason E2 undercounts — headless connect flows are partial. The critical property (no false links, calldata matching) is shown on real traffic; the miss *rate* needs a fully connected session (real wallet, currently sandbox-blocked) to measure well.

## E11. Extension MVP Phase 1a — interception → per-account routing → harness → response (6 Nov 2026) (`src/`, `tests/e2e.mjs`)
The real built extension (`dist/`) loaded in Chromium, a page issuing three `fetch` JSON-RPC calls. All e2e checks pass:
- Page's `fetch` intercepted (MAIN-world wrapper) and answered from the harness; 3/3 protected, 0 direct.
- Connected account learned from the wrapped `window.ethereum` (`eth_accounts`); a second account learned from an `eth_getBalance` param.
- **Three distinct routes assigned**: `acct:28c6…`, `neutral` (eth_blockNumber), `acct:d8da…` — one route per account + neutral for account-agnostic reads.
- JSON-RPC ids blinded and restored (page saw its original 101/102/103).
- Popup renders live status + today counts.

**Run with the passthrough specifier** (`0x4fd77be3…`, no gateway) because **the EF demo gateway `152.236.3.22:12298` is currently unreachable** (TCP closed; publicnode fine at 200/0.3 s) — PRD §11's "demo gateway goes away" risk, live. The tor-js transport itself is proven in E8 (earlier the same day, gateway up). Passthrough validates the whole extension pipeline deterministically; real-Tor re-confirmation is pending gateway availability. Specifier/gateways are build-configurable (`UNLINK_SPECIFIER` / `UNLINK_GATEWAYS`).

**Phase 1b — fallback re-routing after a block** (`tests/e2e-fallback.mjs`): a known single-chain provider (Tenderly mainnet) returning 403 was re-routed to a Tor-friendly provider and succeeded (id preserved); a multichain gateway (Uniswap) returning 403 stayed blocked and failed closed, never blindly rerouted. Stats: `rerouted:1, blocked:1`. Matches E4 (reroute fixes Aave-shaped providers, never breaks Uniswap-shaped gateways).

## E10. Chrome Web Store remote-code policy (Phase 0 KT#4) — 6 Nov 2026
Confirmed against Chrome's current "Improving security in Manifest V3" guidance (developer.chrome.com): MV3 bans remotely hosted code ("all of your extension's logic must be part of the extension package"), **but** "Remotely hosted code is supported in sandboxed iframes" — with the caveat it "does not work if the code requires access to the embedding page's DOM." anon-rpc's §6 worker runs at a null origin with no DOM access, so it lands in the carve-out by construction; the on-chain hash-pin (§4) is a stronger integrity claim than bundling. The `content_security_policy.sandbox` key carries no new extension-page restrictions, so our relaxed sandbox CSP is allowed. **Firefox/AMO has no equivalent carve-out** — expect manual review (the isolation + hash-pin is the argument), or ship the bundle inside. Re-confirm before store submission; policy moves faster than specs.

## E12. Extension MVP Phase 1c + 1d — per-site policy, dialog, onboarding (6 Nov 2026) (`src/`, `tests/e2e-policy.mjs`)
Built on passthrough; all three extension e2e suites green (22 checks total): `e2e.mjs` 9/9, `e2e-fallback.mjs` 5/5, `e2e-policy.mjs` 8/8.
- **Per-site policy** (`origin → ask|block|allow-direct`, default ask) consulted only when a provider blocks and the request can't be safely re-routed. `allow-direct` is the *only* sanctioned direct (non-private) path and is an explicit, stored, per-site user choice; the harness-down state fails closed (never direct, never offers allow-direct). Verified: policy `block` → fails closed (`blocked≥1, direct==0`); `allow-direct` → native request succeeds (`direct≥1`); `ask` → the real Shadow-DOM dialog is shown and driven, the choice persists.
- **In-page dialog** is a Shadow-DOM overlay (page CSS can't interfere), keyboard-accessible, safe option ("Keep blocked") focused, no native `alert/confirm`. Honest copy about what "direct" reveals. Screenshot `tests/dialog.png`.
- **Onboarding** (opens on install) renders the §8 hidden/visible honesty table, a one-line "how it works", and one protection toggle. Screenshot `tests/onboarding.png`. `enabled` defaults to true ("private by default").

## E13. Desktop helper Phase 2 — localhost RPC through the harness (6 Nov 2026) (`helper/`)
`node helper/helper.mjs` launches headless Chromium running `@anon-rpc/browser-harness` and serves JSON-RPC on `127.0.0.1:18545`, per-request picking the isolation key via the shared routing module, blinding ids, forwarding through the harness. **Real `cast`, 3/3 pass** (passthrough specifier, gateway down): `block-number` 26351021 (445 ms), `balance` (351 ms), USDC `balanceOf` via `eth_call` 39192124 (998 ms). Isolation keys correct — `eth_call` keyed to the account found **inside the calldata**, not the zero address (the E5 bug is avoided). D1 (embedded browser harness) + D3 (localhost RPC with per-account routing) implemented; D2 (chrome.proxy target) + D4 (HTTPS tunneling) are design-only in `helper/README.md`; D4's raw-TCP-over-`fetch` limit is the main open question.

## E14. tor-js gateway outage + self-host path (6 Nov 2026) (`docs/gateway-notes.md`, `experiments/gateway-check/`)
The EF demo gateway `152.236.3.22:12298` is **down, not transient**: a bounded real-boot check timed out at 75 s twice (E8 reached ready in 20–28 s this morning on the same code), and 7 reachability rounds over ~8 min all failed while publicnode stayed 200. **Fix: self-host the gateway** — it's a Rust binary (`crates/tor-js-gateway/` in `ethereum/tor-js`; this machine has Rust 1.91 + cargo + Docker). It bridges browser→Tor, so a self-hosted gateway is still real Tor. No drop-in alternative gateway exists. Recommendation: self-host for the demo, list the EF gateway as a redundant second entry, keep passthrough as the labeled not-private deterministic path. Empty `UNLINK_GATEWAYS` with the tor-js specifier hangs the boot (today's failure); only passthrough works with no gateway.
