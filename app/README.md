# Veil desktop app

The friendly app everyone installs. It **runs the privacy engine** (the helper),
**shows status**, and **guides the browser-extension install**. The in-page work
is done by the separate browser extension; this app covers what an extension
can't reach - the wallet's own traffic and local tools like `cast` - and exposes
a local RPC at `127.0.0.1:18545`.

```
app/
├─ ui/                 vanilla HTML/CSS/JS dashboard (no build step)
│  ├─ index.html       views: Status · Setup (onboarding) · Settings
│  ├─ app.css          dark theme, tokens copied from site/index.html
│  └─ app.js           polls the helper's control API every 2s
├─ src-tauri/          the native shell (Rust + system webview)
│  ├─ src/main.rs      spawns + supervises the helper, kills it on exit
│  ├─ tauri.conf.json  window + points frontendDist at ../ui
│  ├─ Cargo.toml
│  ├─ build.rs
│  └─ icons/icon.png
├─ ui-preview.png          headless screenshot - Status view
└─ ui-preview-setup.png    headless screenshot - Setup/onboarding view
```

## Two ways to run

### 1. UI only (no compile) - fastest to test

The UI works as a plain page against a running helper, so you can see the whole
dashboard without building Tauri.

```sh
# terminal 1 - start the helper (passthrough; EF tor-js gateway is down)
cd helper
HELPER_SPECIFIER=0x4fd77be300f31c5fe6ab266d35d27750a3478d27 \
HELPER_GATEWAYS='[]' \
HELPER_ACCOUNTS='Main=0x28c6c06298d514db089934071355e5743bf21d60,Trading=0xd8da6bf26964af9d7eed9e03e53415d37aa96045' \
node helper.mjs

# terminal 2 - open the UI in any browser
open "file://$PWD/../app/ui/index.html"      # macOS
# or point it at a non-default helper:
#   .../index.html?api=http://127.0.0.1:18545
```

The page polls `GET /__veil/status` and renders Protection state, the
accounts→routes table, the wallet/local-RPC tiles, and the live pairing flow.

### 2. Full Tauri app - the shipped experience

The Rust shell spawns the helper for you and loads the UI in a native window.

```sh
# one-time: install the Tauri CLI
cargo install tauri-cli --version '^2'

cd app/src-tauri

# dev (hot window; spawns `node ../../helper/helper.mjs` on launch):
cargo tauri dev

# release build + bundle (.app / .dmg on macOS):
cargo tauri build
# or just compile the binary without bundling:
cargo build --release
# run it directly:
./target/release/veil-app
```

Requirements: Rust (tested 1.91), Node on `PATH` (the shell runs `node`), and the
helper's deps installed once (`cd helper && pnpm install` - already done here).
macOS uses the system WKWebView, so no extra system webview packages are needed.

## How the app wires things together

- **Spawn + supervise.** On launch `main.rs` runs `node <repo>/helper/helper.mjs`
  with the **passthrough** env (`HELPER_SPECIFIER=0x4fd77be3…`, `HELPER_GATEWAYS=[]`)
  because the EF tor-js gateway is currently down. Swap those two env values for
  the real tor-js specifier + gateways to route over Tor. Override the helper
  path with `VEIL_HELPER=/abs/path/helper.mjs`.
- **Kill on exit.** The child handle is kept in Tauri state and killed on
  `RunEvent::Exit`, so no `node`/Chromium is left running.
- **Read-only status.** The UI only ever does `GET /__veil/health` and
  `GET /__veil/status` on `127.0.0.1:18545`. It never mutates the engine.
- **Extension pairing.** The Setup view shows a live two-step pair: *Privacy
  engine* reflects real helper health; *Browser extension* is confirmed by the
  user ("I've added the extension") or auto-advances shortly after the engine is
  ready in this demo. There is **no real extension↔helper handshake in this
  build** - a production build would flip the extension step on a
  token-authenticated ping to the helper (see the SECURITY NOTE in `helper.mjs`).

## Packaging note (not done here)

`cargo tauri build` bundles the UI, but the **helper is not yet bundled**. To
ship, add the helper (and a Node runtime, or a packaged helper) as a Tauri
sidecar/resource and resolve it next to the app binary instead of via
`CARGO_MANIFEST_DIR`. The `VEIL_HELPER` override is the seam for that.

## Honest about privacy

Everything in `docs/prd.md §8` holds: providers still see the addresses queried,
wallets' own multi-account APIs still link accounts, and the Tor gateway sees
that Tor is in use. Under **passthrough** there is **no privacy at all** - the
UI says so plainly (amber "Passthrough · no privacy"). There is never a silent
fallback to a direct connection: while the engine is booting or broken, JSON-RPC
POSTs fail visibly (HTTP 503).
