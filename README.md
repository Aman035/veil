<p align="center">
  <img src="assets/banner.svg" alt="Veil - private by default for the wallets and dapps you already use" width="100%">
</p>

<p align="center">
  <b>anon-rpc, adopted by you, not by the app.</b>
  <br/>
  Turn Veil on once and the wallets and dapps you already use get private reads,
  with <b>one route per account</b> over Tor. No waiting for apps to integrate anything.
  <br/><br/>
  Built on the Ethereum Foundation's <a href="https://github.com/ethereum/anon-rpc">anon-rpc</a> and <a href="https://github.com/ethereum/tor-js">tor-js</a>.
  <br/>
  <b>🌐 <a href="https://aman035.github.io/veil/">Live demo</a></b>
</p>

---

## 1. The problem

Wallets and dapps read **straight from the page** to RPC providers (Alchemy, Infura, drpc, their own backends). Every read carries **your IP** and **the addresses you look up**. Because a handful of providers serve many apps, one of them can tie your main, trading and airdrop wallets to **one person**, and to **where you are**, across every dapp you touch. That is how holders get de-anonymised, phished and physically targeted.

The usual fixes don't close it:

- **A VPN** gives all your accounts one IP, so they still look like one person.
- **Tor Browser** isolates per site, not per account, so accounts you use on the same dapp share an exit, and many providers block Tor outright (Aave's provider blocked all 16 of our test reads).
- **Waiting for the app** to adopt anon-rpc leaves you exposed until it does, and only a couple have, all opt-in. You carry the risk while you wait.

<p align="center">
  <img src="assets/the-leak.svg" alt="Three wallets used on Uniswap, Aave and ENS all read from RPC providers that log the same IP, so a provider ties them to one person and one location." width="860">
</p>

## 2. The solution

Veil makes the wallets and dapps you **already use** private, with no change to them. Turn it on once; every read leaves over Tor, on a circuit that belongs to just that account.

<p align="center">
  <img src="assets/one-route-per-account.svg" alt="One route per account: each account's traffic flows through its own Tor circuit to a different exit" width="820">
</p>

- **One route per account.** Each account gets its own Tor circuit and exit (an anon-rpc isolation key), so a provider sees unrelated strangers, not one person.
- **Re-routes around blocks.** When a provider refuses Tor, standard reads are re-sent through a Tor-friendly provider on the same chain, only after a real block, never blindly.
- **Never silently direct.** If a read can't be made private, Veil asks you, per site, before any direct connection.

**What it hides, and what it doesn't:**

| | Hidden from providers | Still visible |
|---|---|---|
| **Your IP** | yes, on every dapp read | the Tor gateway sees that you use Tor, not what for |
| **Accounts linked** | yes, one circuit per account | a wallet's own multi-account API can still link them at the app layer |
| **Addresses you query** | no | providers see them; hiding that needs PIR, a separate problem |

The shipping product is the **browser extension** (Chrome / Brave). A desktop helper gives local tools like `cast` the same per-account reads; routing a wallet's own opaque traffic is on the roadmap (see [Scope](#scope-and-roadmap)).

## 3. How it works

Veil sits between the page and its RPC provider, with no change to the dapp and no new endpoint: it catches the reads the app already makes and carries each one over Tor. The anon-client code runs **hash-pinned and sandboxed** (anon-rpc), with no access to your keys, DOM or cookies.

<p align="center">
  <img src="assets/interception.svg" alt="Veil catches the read, reads the account, and blinds the request id" width="760">
</p>

<p align="center">
  <img src="assets/transport.svg" alt="The anon-rpc harness (a sandboxed, hash-pinned tor-js worker) carries the read over Tor, one circuit per account, to the provider" width="880">
</p>

**The interception.** At `document_start`, before the page's own scripts run, Veil installs a MAIN-world shim that wraps `window.fetch` and `XMLHttpRequest`. Every dapp read goes through one of those, so a single hook covers **viem, ethers v5/v6 and raw XHR** with no per-library work. For each call Veil:

1. parses the JSON-RPC body (anything that isn't a JSON-RPC request passes straight through);
2. finds the account the read is for, from the params or from inside `eth_call` calldata, ignoring the zero address;
3. picks that account's isolation key and **blinds the request id** (viem numbers requests from one global counter, so untouched ids would let a provider stitch the per-account routes back together);
4. relays it (MAIN world → ISOLATED relay → background worker → offscreen anon-rpc worker) and returns the provider's reply unchanged.

**The transport.** The read is handed to [`@anon-rpc/browser-extension-harness`](https://www.npmjs.com/package/@anon-rpc/browser-extension-harness): a **null-origin, sandboxed iframe** running **tor-js**, a full Tor client in WebAssembly. The worker is fetched at runtime but **hash-pinned on-chain** and verified before it runs. It builds a circuit through a **blind KPS gateway** that relays only encrypted bytes, never your traffic or destination, and reaches the provider from a Tor exit unique to that account.

Three rules hold for every request:

1. **One route per account**, with the id blinded so a counter can't re-link routes.
2. **Re-route only after a real block**, and only for known single-chain RPCs, so a multichain gateway is never blindly broken.
3. **Never silently direct** - any read that can't be made private surfaces a per-site choice.

We intentionally **don't hide which addresses you look up** (that needs PIR, a separate problem). It's a stated trade-off, not a gap.

<details>
<summary><b>See the full read path on a real app (ENS), with and without Veil</b></summary>

<br/>

<p align="center">
  <img src="assets/ens-flow.svg" alt="The full read path on ENS. Without Veil, drpc logs your IP and every address and links your accounts to one person. With Veil, each account's read is routed on its own Tor circuit, so the provider sees a different exit per account and no IP; it still sees the addresses queried. Measured: ENS 13 of 14 reads over Tor." width="880">
</p>

ENS reads through an independent provider (drpc) that also serves many other dapps, so it's a clean example of the cross-dapp linkage Veil breaks. The diagram stays honest about the limit: the provider still sees the addresses you query; only your IP and the link between your accounts are removed.

</details>

### Scope and roadmap

Today Veil makes **dapp reads** private per account (the main leak, since dapps read straight from the page) and gives **local tools** (`cast`, scripts) the same reads through the helper. With protection on, essentially all of a page's JSON-RPC reads leave through anon-rpc.

The deliberate next step is a **wallet's own opaque HTTPS traffic**, for example MetaMask fetching balances and prices from its backends. An extension can't see another extension's requests, so Veil's in-page shim never sees them. Covering that means routing by host through `chrome.proxy`, which needs a raw-stream path (an upstream `CONNECT` the harness doesn't expose yet, or a local Tor tunnel that hides the IP but can't split per account). The `chrome.proxy` hook is built but stays **inert** until one lands, and nothing is ever sent in the clear in the meantime.

## 4. CROPS

_Censorship-resistant, Open-source, Private, Secure._

- **C - Censorship resistant.** No Veil server sits in the path. The extension, helper and gateway are all things you run; the gateway is **self-hostable and swappable** and the Tor-friendly provider list is user-editable, so if any of them refuses you, point at another in one config line. The worker is hash-pinned on-chain, so no host can swap in different code.
- **O - Open source.** **MIT.** Everything builds and runs from this repo alone (`pnpm install && node build.mjs`); no hidden service required.
- **P - Private.** Providers see the addresses you query but **not your IP**, and **can't link your accounts** (one circuit each). The gateway relays only encrypted bytes. No analytics, no telemetry, no accounts. Honest limits are in the table above.
- **S - Secure.** Veil **never touches your keys** - it routes reads only; your wallet signs. The anon-client runs in a null-origin sandboxed iframe with no access to keys, DOM or cookies. Settings stay on your device.

## 5. Project structure and local setup

```
veil/
├── src/        browser extension (Chrome / Brave, MV3)
├── helper/     desktop helper (localhost RPC routed through the harness)
├── app/        desktop app (Tauri) that runs the helper and pairs the extension
└── site/       landing site (published to GitHub Pages)
```

Prereqs: Node 18+ and `pnpm`. The desktop app also needs Rust + Tauri; the real-Tor demo needs a tor-js gateway.

```bash
# Browser extension (to actually route, build with a network - see below)
pnpm install
node build.mjs                 # -> dist/  (load unpacked at chrome://extensions)

# Desktop helper (private localhost RPC for cast / scripts)
cd helper && pnpm install && node helper.mjs      # serves http://127.0.0.1:18545

# Desktop app (optional): spawns the helper, shows status, pairs the extension
cd app/src-tauri && cargo tauri dev
```

**Point Veil at a gateway (no rebuild).** The gateway is a runtime setting: install the extension, run a gateway, and paste its address into **Settings → Network**. To run a self-hosted gateway, build [`tor-js-gateway`](https://github.com/ethereum/tor-js) once, copy the binary to `~/veil-gateway`, then:

```bash
node tools/gateway.mjs          # start it, show live status, print the line to paste
node tools/gateway.mjs status   # check UP / DOWN anytime
```

It prints a line like `127.0.0.1:12298:<certhash>`; paste that into **Settings → Network → Gateways → Save**. The default build points at the EF public demo gateway, which is often down, so a fresh install may sit on "Connecting privately…" until you set your own. Veil never falls back to a direct connection silently.

**Bake a network at build time (optional).**

```bash
# real Tor via your gateway:
VEIL_SPECIFIER=0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e \
VEIL_GATEWAYS='["127.0.0.1:12298:<your-gateway-certhash>"]' node build.mjs

# or the passthrough specifier (no Tor, not private) for a deterministic plumbing demo:
VEIL_SPECIFIER=0x4fd77be300f31c5fe6ab266d35d27750a3478d27 VEIL_GATEWAYS='[]' node build.mjs
```

For a live demo, build with your gateway running and lead with an app that serves Tor (Lido, ENS, Compound) so the per-account flow is clean; Aave is the re-route beat, since its provider blocks Tor.

## License

[MIT](LICENSE). Built on the Ethereum Foundation's
[anon-rpc](https://github.com/ethereum/anon-rpc) and [tor-js](https://github.com/ethereum/tor-js).
