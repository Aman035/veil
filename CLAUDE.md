# Unlink (working name)

A browser extension, then a desktop helper, that makes the wallets and dapps people already use private by default. It routes their crypto traffic through EF anon-rpc (tor-js), with **one route per account** so providers can't link a user's accounts, and **fallback re-routing** so dapps keep working when their providers block Tor.

## Status: PRD under review

**Do not write product code until the user approves `docs/prd.md`.** Until then, help refine the PRD, answer questions, and run kill tests (in `experiments/`). When the user approves, start with Phase 0 in PRD §9.

## Read first
- `docs/prd.md`: problem, solution, diagrams, requirements, phases, open questions. The source of truth.
- `docs/evidence.md`: every measured claim, with how it was measured.
- `docs/background.md`: anon-rpc primer, package names, specifier addresses, ecosystem (what not to duplicate).
- `experiments/`: throwaway kill-test scripts (Playwright). They reference a Playwright install at an absolute path in another project; reinstall locally before re-running. Not product code.

## Rules
- **Measure before claiming.** Never state an unmeasured number as fact; add new measurements to `docs/evidence.md`.
- **Test with real browser sessions. Never spoof headers, forge Origin, or otherwise get around bot checks or access controls.** An attempt to replay requests with hand-set Origin headers was (rightly) blocked as bot-check circumvention. If a provider blocks anonymous traffic, the product re-routes to a provider that serves it; it never disguises traffic.
- **Honest privacy claims.** Providers still see the addresses queried; wallets' own multi-account APIs still link accounts; the Tor gateway sees the user uses Tor. Keep PRD §8 true in all copy.
- **No silent fallback to direct connections.** Ever.
- **Licences:** MIT or Apache-2.0 dependencies only.
- **Commits** (once this is a git repo): Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`), one line, no co-author or attribution trailers. Commit as work progresses.
- **Explain plainly.** The user wants honest, plain-language reports: what was done, what was found, what it means.

## Key technical facts (all measured; see evidence.md)
- Extensions **cannot** see or rewrite other extensions' requests (`webRequest`, DNR), but **can** route them by host with `chrome.proxy` to a proxy server. Chrome never proxies loopback addresses.
- Dapps read mostly **directly from the page**, not through the wallet.
- A MAIN-world fetch/XHR wrapper at `document_start` catches viem, ethers v5/v6 and XHR; it misses Web Worker fetches and WebSockets.
- Over Tor: Aave's provider (Tenderly) blocks it (0/16); Uniswap's gateway works partly (12/19); Compound, Lido, ENS, Morpho, Spark work. **Blind re-routing breaks Uniswap (0/33); re-routing after a block fixes Aave (3/3).**
- The EF Node harness can't run tor-js (QuickJS has no WebAssembly). The desktop helper must embed a browser engine running the EF browser harness. That path worked with real `cast` at 1.5–3.4 s per command.
- Account mapping must ignore the zero address and find the user's address inside calldata (`cast call` was mis-keyed to 0x0 in testing).
- viem numbers JSON-RPC requests with one global counter: blind ids before sending.
- Nym drops custom headers and ignores isolation keys.

## Environment
macOS; Node 23; pnpm; Foundry (`cast`); Docker; Playwright with Chromium; Homebrew `tor` (SOCKS 9150 with `IsolateSOCKSAuth` was used in tests).
