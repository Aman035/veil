# tor-js gateway notes — making the real-Tor demo not depend on one EF endpoint

Written 2026-11-06 (probe timestamps below are UTC). Scope: the EF demo tor-js
gateway is unreachable again; this records what a gateway is, whether we can
run our own, and the most reliable path to a live demo over **real** Tor.

Scripts: `experiments/gateway-check/` (`probe.mjs` reachability, `boot-check.mjs`
a **bounded** real boot of the built kt-ext-harness extension). Research sources:
the local `anon-rpc` clone at `/Users/amangupta/Desktop/Personal_Projects/pro_mum/research/repos/anon-rpc`
(`docs/integrate-network.md`, `SPEC.md` §4/§10, `adopters.json5`), and the
`ethereum/tor-js` + `ethereum/kps` repos (fetched, not cloned locally).

---

## (a) Current status of the EF demo gateway

Gateway under test (from `docs/background.md`, `adopters.json5`):
`152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ`

**Verdict: DOWN / unreachable right now.** Not a transient blip across the
window probed — every real boot attempt timed out, and TCP never came up. The
control endpoint (`ethereum-rpc.publicnode.com`) stayed healthy throughout, so
this is the gateway, not our network path.

### Bounded real-boot checks (`boot-check.mjs`, 75 s hard timeout)

The definitive test: boot the real built extension (`kt-ext-harness/ext`, the
one that reached ready in ~20–28 s this morning, E8) and race `worker.ready`
against a 75 s bound.

| Attempt (UTC) | Result |
|---|---|
| 2026-11-05T20:13:59Z → 20:15:14Z | **TIMEOUT** at 75 000 ms — no ready |
| 2026-11-05T20:16:41Z → 20:17:56Z | **TIMEOUT** at 75 000 ms — no ready |

It never succeeded. (Compare E8 earlier the same day: ready in 20–28 s when the
gateway was up. The boot path itself is unchanged and proven; only the gateway
differs.)

### Reachability probes (`probe.mjs`)

KPS runs on **one UDP port** (WebRTC in the browser, QUIC native — KPS SPEC §5),
so a closed/filtered **TCP** port is suggestive, not definitive — the listener
could be UDP-only. The probe therefore does TCP (definitive when OPEN), a
best-effort UDP STUN ping (a reply or ICMP-unreachable is informative; silence
is inconclusive), and a `publicnode` control each round.

7 rounds over ~8 minutes (`ROUNDS=7 INTERVAL_MS=75000`):

| Round (UTC) | Gateway TCP :12298 | Gateway UDP :12298 | Control (publicnode) |
|---|---|---|---|
| 20:13:35Z | filtered/timeout (5.0 s) | silent (inconclusive) | 200 (181 ms) |
| 20:14:55Z | filtered/timeout (5.0 s) | silent (inconclusive) | 200 (336 ms) |
| 20:16:15Z | filtered/timeout (5.0 s) | silent (inconclusive) | 200 (254 ms) |
| 20:17:35Z | filtered/timeout (5.0 s) | silent (inconclusive) | 200 (237 ms) |
| 20:18:55Z | filtered/timeout (5.0 s) | silent (inconclusive) | 200 (399 ms) |
| 20:20:15Z | filtered/timeout (5.0 s) | silent (inconclusive) | 200 (662 ms) |
| 20:21:35Z | filtered/timeout (5.0 s) | silent (inconclusive) | 200 (369 ms) |

Every round identical: gateway TCP never answered, gateway UDP silent, control
200. No recovery in the window.

Reading it: TCP to `152.236.3.22:12298` never opened (timed out / filtered);
UDP was silent (inconclusive on its own); the control stayed 200. The UDP
silence alone would not prove the gateway down — but the two **real boot
timeouts** do: the WebRTC/KPS dial that actually matters never completed.

This is PRD §11's "EF demo gateway (tor-js) goes away" row, live — the same
condition E11 hit when it fell back to the passthrough specifier.

---

## (b) What a "gateway" is, and the address format

Browsers cannot open the raw TCP sockets Tor needs. A tor-js **gateway** is a
**blind KPS relay into the Tor network**: the in-browser tor-js worker dials the
gateway over KPS (WebRTC), and the gateway forwards those byte-streams to real
Tor guard/relay nodes. It terminates nothing and sees no plaintext — circuits
are still built end-to-end inside the browser worker, exits are still real Tor
exits. So **a self-hosted gateway is still a real-Tor demo**; it only replaces
the browser's missing TCP, not Tor itself. (Node/Deno tor-js skips the gateway
entirely and opens TCP directly — not an option for us, we ship a browser
extension.)

**Address format** — a KPS address (KPS SPEC §2–§3, anon-rpc SPEC §10):

```
<ip>:<udp-port>:<certhash>          # IPv4
[<ipv6>]:<udp-port>:<certhash>      # IPv6
```

- `certhash` = `multibase('u') || multihash` — base64url (no padding),
  multihash = `0x12 0x20 || sha256(DER cert)`. It pins the gateway's
  self-signed cert; **no DNS, no CA**. The client connects to exactly this
  string, so the operator must publish it (the gateway prints it at startup).
- The tor-js `gateways` config is an **unordered set**; you may list several for
  redundancy: `{ gateways: ["<a>", "<b>"] }`.
- Fed to the worker as `config: { gateways: [...] }` (anon-rpc §7.1). The field
  is opaque to the harness; schema is tor-js's.

In our code: `src/background.ts` reads `__UNLINK_SPECIFIER__` / `__UNLINK_GATEWAYS__`
at build time (env `UNLINK_SPECIFIER` / `UNLINK_GATEWAYS`), so swapping the
gateway string is a build-config change, no code edit. Note it passes
`config: {}` when the gateway list is empty — fine for the passthrough
specifier, but **an empty gateway list with the tor-js specifier will not work
in a browser** (no TCP, no relay).

---

## (c) Options for a reliable demo

### Option 1 — Self-host a `tor-js-gateway` (feasible here; real Tor)

The gateway is a Rust binary in the tor-js repo at `crates/tor-js-gateway/`.
This machine already has **Rust 1.91.0 / cargo** (the README needs 1.91+) and
Docker, so this is buildable locally today.

Steps (from the gateway README; macOS notes added):

```sh
# 1. Toolchain: Rust 1.91+ (have 1.91.0) and a C toolchain.
#    macOS: `xcode-select --install`; openssl/sqlite via Homebrew if the build asks.
# 2. Get the gateway source (tor-js is NOT cloned locally yet):
git clone https://github.com/ethereum/tor-js
cd tor-js/crates/tor-js-gateway
# 3. Build + install the binary:
cargo install --path .
# 4. First-time setup: writes ~/.config/tor-js-gateway/config.json5 and a KPS key:
tor-js-gateway init
# 5. Run it. It PRINTS its KPS address at startup, e.g.
#    203.0.113.5:12298:uEiAxk...9Qw   <-- this is your gateway string
tor-js-gateway
```

- The certhash is **stable** as long as `~/.local/share/tor-js-gateway/kps.key`
  is kept, so the demo config string stays fixed across restarts.
- The gateway **syncs the Tor directory on first launch**; its data endpoints
  return `503` until that finishes. Start it a few minutes before the demo.
- Config lives at `~/.config/tor-js-gateway/config.json5`:
  `kps_port: 12298`, `advertised_addresses: []`, `tunnel_*` caps, etc.
- **Behind NAT / for a remote browser:** set `advertised_addresses` to the
  public IP and forward **UDP 12298**. For a demo on the same machine/LAN, set
  it to `127.0.0.1` or the LAN IP.
- Run as a service if wanted: `tor-js-gateway install` (systemd user unit on
  Linux; on macOS run it in a terminal / under a launchd/`nohup` wrapper).

Then point the extension at it and **re-run `boot-check.mjs` against the new
string** to confirm WebRTC reaches it before relying on it in the demo. (One
unverified assumption: a browser dialing a `127.0.0.1:12298` KPS host candidate
over WebRTC — the bounded boot-check is exactly how to prove it in minutes; if
loopback misbehaves, use the LAN IP in `advertised_addresses`.)

Cost: one `git clone` + `cargo install` (minutes to build), plus a few minutes
of Tor directory sync. Payoff: a gateway we control, reproducible, not subject
to the EF endpoint vanishing mid-demo.

### Option 2 — Wait for the EF demo gateway to recover

Zero effort, but it is explicitly "limited capacity, may disappear at any time"
and is down now. Acceptable **only** as a fallback, and only if a `boot-check.mjs`
run passes within minutes of the demo. Do not stake a live demo on it.

### Option 3 — Nym (second network, different bootstrap)

Nym (`0x3aCD9742…60eD0`) does not use the tor-js gateway, so it is unaffected by
this outage. **But** Nym drops custom headers and **ignores isolation keys**
(evidence E7, PRD §12.4) — so it **cannot show per-account routes**, which is
the whole point of the product. Usable to show "traffic leaves via a mixnet IP,"
not the per-account-unlinkability story. Not a substitute for the tor-js demo.
18 MB bundle, few-second bootstrap.

### Option 4 — Passthrough specifier (not Tor)

`0x4fd77be3…` with no gateway validates the extension pipeline deterministically
(what E11 already used). **Not real Tor** — keep as the pipeline demo only, not
the privacy demo.

### Not viable

- **Node tor-js (direct TCP, no gateway):** works without a gateway, but we ship
  a browser extension; the browser transport is the thing being demoed.
- **No public bootstrap mirror** is documented, so "browser, no gateway, use a
  `bootstrap.zip.zst` snapshot" still requires running our own gateway to
  produce that snapshot — no shortcut around hosting something.
- No **other** EF-published or community gateway address exists anywhere I
  checked (tor-js README, anon-rpc adopters page/`adopters.json5`, KPS repo, the
  live demo). Privacy Pools and Kiwi News both ship tor-js but name no gateway —
  users supply their own. So there is no second address to just swap in.

---

## (d) Recommendation (ranked)

1. **Self-host a `tor-js-gateway` for the demo (Option 1).** Only reliable
   real-Tor path we fully control. Toolchain is already present; build it, grab
   the printed `ip:12298:certhash`, verify with `boot-check.mjs`, and list it in
   `UNLINK_GATEWAYS`. Do this ahead of the demo and leave it running (directory
   sync warmed).
2. **List the EF demo gateway alongside ours** in the `gateways` set (unordered)
   so if it recovers it adds redundancy — but never as the only entry.
3. **Keep passthrough (Option 4) as the deterministic fallback** for the pipeline
   demo if Tor transport is unavailable at showtime — clearly labelled as not
   private (never silent; PRD rule).
4. Nym (Option 3) only if we want to additionally show a second network; it
   can't carry the per-account-route story.

Re-confirm reachability with `boot-check.mjs` shortly before any demo; the EF
endpoint has now failed twice (E11 and today).

---

## (e) Config strings to use

Specifier (unchanged, mainnet tor-js):
```
0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e
```

Gateways — replace the EF string with your self-hosted one (printed at gateway
startup), optionally keeping the EF demo one as a second, unordered entry:
```jsonc
// UNLINK_GATEWAYS (JSON array of KPS strings)
["<YOUR_HOST_IP>:12298:<YOUR_CERTHASH>",
 "152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ"]
```

Build the extension with:
```sh
UNLINK_SPECIFIER=0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e \
UNLINK_GATEWAYS='["<YOUR_HOST_IP>:12298:<YOUR_CERTHASH>"]' \
<build command>
```
(For the kt-ext-harness kill-test, the gateway is hardcoded in
`experiments/kt-ext-harness/background.ts` line 9 — edit there and rebuild to
test a new gateway.)

Do **not** ship an empty `UNLINK_GATEWAYS` with the tor-js specifier: in a
browser that means no relay and the boot hangs (exactly the failure above).
