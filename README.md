# Unlink

**Private by default for the wallets and dapps you already use.**

Unlink routes your crypto traffic through Tor with **one route per account**, so the
providers your wallet and dapps talk to can't see your IP or tell your accounts
apart — and it **re-routes around providers that block Tor**, so your apps keep
working. Built on the Ethereum Foundation's [anon-rpc](https://github.com/ethereum/anon-rpc)
and [tor-js](https://github.com/ethereum/tor-js).

🔗 **Site:** https://aman035.github.io/unlink/

> Status: in active development.

## What's here

| Path | What it is |
|------|------------|
| [`src/`](src/) | The browser extension (Chrome / Brave, MV3) — makes dapp reads private, one route per account, with re-routing and a per-site policy. |
| [`helper/`](helper/) | The desktop helper — a localhost RPC endpoint that routes the wallet's own traffic and local tools (`cast`, scripts) through the same engine. |
| [`app/`](app/) | The desktop app (Tauri) — a friendly UI that runs the helper and pairs with the extension. |
| [`site/`](site/) | The landing site (published to GitHub Pages). |

## How it works

- **One route per account.** Each account gets its own Tor circuit and exit, so a
  provider sees unrelated strangers instead of one person.
- **Re-routes around blocks.** When a provider refuses Tor, standard reads are
  re-sent through a Tor-friendly provider on the same chain — only after a real
  block, never blindly.
- **Never silently direct.** If a read can't be made private, Unlink asks you,
  per site, before any direct connection.

## What it hides — and what it doesn't

Hidden from providers: **your IP**, and **that your accounts belong together** (for
RPC traffic). Still visible: **which addresses you look up** (that needs PIR, a
separate problem), your wallet's own multi-account APIs, and that you use Tor.

## License

MIT or Apache-2.0.
