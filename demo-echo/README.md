# Live-demo IP echo

The live demo page (`site/demo.html`) proves Veil hides your IP by reading back
the IP a server saw. GitHub Pages is static and cannot see a caller's IP, so the
echo has to run off-site. Two ways, pick one.

## Quick, for a live demo (no account)

Needs `cloudflared` (`brew install cloudflared`) and the Veil gateway running.

```bash
node demo-echo/serve-local.mjs
```

It starts the local echo + a Cloudflare quick tunnel and prints a ready URL like
`https://aman035.github.io/veil/demo.html?echo=https://<random>.trycloudflare.com`.
Open it with the Veil extension on. The `?echo=` URL is ephemeral (new each run),
which is why the page takes it as a query param, no redeploy needed.

## Persistent, for a demo you can give anytime

Deploy `worker.js` as a free Cloudflare Worker (it never blocks Tor because you
own it), then set `WORKER` at the top of `site/demo.html`'s script to its URL and
push. See the deploy steps in `worker.js`.

## What the page shows

- **Direct read** (a plain GET, not routed) -> your real IP.
- **Through Veil, account A / B** (JSON-RPC POSTs the extension routes) -> a
  different Tor exit each. Your real IP never appears.

Verify it yourself: `ECHO_URL=<your echo url> node tests/e2e-demo-page.mjs`.
