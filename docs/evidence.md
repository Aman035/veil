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
