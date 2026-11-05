// Capture real dapp JSON-RPC traffic, each dapp "connected" as a DISTINCT
// public address, so the heuristic can be scored for false/missed account links.
// We never sign anything; the fake wallet only answers read methods + accounts.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

// Distinct, on-chain-active addresses (so dapps actually query them).
const DAPPS = [
  { url: "https://app.aave.com",      addr: "0x28c6c06298d514db089934071355e5743bf21d60" },
  { url: "https://app.ens.domains",   addr: "0x21a31ee1afc51d94c2efccaa2092ad1028285549" },
  { url: "https://app.morpho.org",    addr: "0xdfd5293d8e347dfe59e90efd55b2956a1343963d" },
  { url: "https://app.uniswap.org",   addr: "0x56eddb7aa87536c09ccc2793473599fd21a8b17f" },
  { url: "https://stake.lido.fi",     addr: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045" },
  { url: "https://app.compound.finance", addr: "0xab5801a7d398351b8be11c439e05c5b3259aec9b" },
];

const fakeWallet = (addr) => {
  const RPC = "https://ethereum-rpc.publicnode.com";
  const listeners = {};
  const provider = {
    isMetaMask: true,
    _metamask: { isUnlocked: async () => true },
    on(e, f) { (listeners[e] ??= []).push(f); return provider; },
    removeListener() { return provider; },
    async request({ method, params }) {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [addr];
      if (method === "eth_chainId") return "0x1";
      if (method === "net_version") return "1";
      if (method === "wallet_requestPermissions" || method === "wallet_getPermissions") return [{ parentCapability: "eth_accounts" }];
      if (method.startsWith("wallet_") || method.startsWith("personal_") || method.startsWith("eth_sign")) throw Object.assign(new Error("rejected"), { code: 4001 });
      const r = await window.__origFetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const j = await r.json(); if (j.error) throw j.error; return j.result;
    },
  };
  window.__origFetch = window.fetch.bind(window);
  Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
  const info = { uuid: "9b1c0a8e-1111-4c1e-9a1e-000000000001", name: "MetaMask", icon: "data:image/svg+xml,<svg/>", rdns: "io.metamask" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
};

const browser = await chromium.launch({ channel: "chromium", headless: true });
const captured = [];
for (const { url, addr } of DAPPS) {
  // Real browser session: no UA/header spoofing (CLAUDE.md rule). Dapps that
  // block the default automation UA are simply recorded as blocked.
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(fakeWallet, addr);
  let n = 0;
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    const body = req.postData() ?? "";
    if (!body.includes('"jsonrpc"')) return;
    if (req.url().startsWith("https://ethereum-rpc.publicnode.com")) return; // our wallet's own forwarder
    let calls;
    try { const j = JSON.parse(body); calls = (Array.isArray(j) ? j : [j]).map((c) => ({ method: c.method, params: c.params })); } catch { return; }
    captured.push({ dapp: url, connectedAddr: addr.toLowerCase(), host: new URL(req.url()).host, calls });
    n++;
  });
  let note = "ok";
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);
    for (const label of [/^connect( wallet)?$/i, /connect wallet/i, /^connect$/i]) {
      const b = page.getByRole("button", { name: label }).first();
      if (await b.isVisible().catch(() => false)) { await b.click({ timeout: 3000 }).catch(() => {}); break; }
    }
    await page.waitForTimeout(2500);
    for (const label of [/metamask/i, /browser wallet/i, /injected/i]) {
      const o = page.getByText(label).first();
      if (await o.isVisible().catch(() => false)) { await o.click({ timeout: 3000 }).catch(() => {}); break; }
    }
    await page.waitForTimeout(16000);
  } catch (e) { note = "load failed: " + e.message.split("\n")[0].slice(0, 80); }
  console.log(JSON.stringify({ dapp: url, connectedAddr: addr, jsonRpcRequests: n, note }));
  await ctx.close();
}
await browser.close();
writeFileSync(here + "captured.json", JSON.stringify(captured, null, 2));
console.log("\ntotal JSON-RPC requests captured:", captured.length, "-> captured.json");
