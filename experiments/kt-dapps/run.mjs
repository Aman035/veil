// For each dapp: inject a fake EIP-1193 wallet (EIP-6963 + window.ethereum) that is "connected"
// as a public address, then count JSON-RPC traffic: direct from the page vs through the wallet.
import { chromium } from "/Users/amangupta/Desktop/Personal_Projects/pro_mum/research/experiments/u4-anon-rpc-transport/node_modules/playwright/index.mjs";
const ADDR = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
const DAPPS = (process.argv[2] ?? "").split(",");
const fakeWallet = (addr) => {
  const calls = (window.__walletCalls = []);
  const RPC = "https://ethereum-rpc.publicnode.com";
  const listeners = {};
  const provider = {
    isMetaMask: true,
    _metamask: { isUnlocked: async () => true },
    on(e, f) { (listeners[e] ??= []).push(f); return provider; },
    removeListener() { return provider; },
    async request({ method, params }) {
      calls.push(method);
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
  window.ethereum = provider;
  const info = { uuid: "9b1c0a8e-1111-4c1e-9a1e-000000000001", name: "MetaMask", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "io.metamask" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
};
const browser = await chromium.launch();
const results = [];
const captured = {};
for (const url of DAPPS) {
  const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(fakeWallet, ADDR);
  const direct = []; // JSON-RPC requests sent by the page itself (not by our fake wallet's forwarder)
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    const body = req.postData() ?? "";
    if (!body.includes('"jsonrpc"')) return;
    if (req.url().startsWith("https://ethereum-rpc.publicnode.com")) return; // our wallet's own forwarding
    let methods = [];
    try { const j = JSON.parse(body); methods = (Array.isArray(j) ? j : [j]).map((c) => c.method); } catch {}
    direct.push({ host: new URL(req.url()).host, methods, mentionsAddr: body.toLowerCase().includes(ADDR.slice(2)) });
    const h = req.headers();
    const host = new URL(req.url()).host;
    if (!captured[host]) captured[host] = { dapp: url, url: req.url(), body, headers: Object.fromEntries(Object.entries(h).filter(([k]) => !k.startsWith(":") && !["content-length", "cookie"].includes(k))) };
  });
  let note = "";
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(8000);
    // Try to connect: click a "Connect" button, then a MetaMask / browser-wallet option.
    for (const label of [/^connect( wallet)?$/i, /connect wallet/i, /^connect$/i]) {
      const b = page.getByRole("button", { name: label }).first();
      if (await b.isVisible().catch(() => false)) { await b.click({ timeout: 3000 }).catch(() => {}); break; }
    }
    await page.waitForTimeout(2500);
    for (const label of [/metamask/i, /browser wallet/i, /injected/i]) {
      const o = page.getByText(label).first();
      if (await o.isVisible().catch(() => false)) { await o.click({ timeout: 3000 }).catch(() => {}); break; }
    }
    await page.waitForTimeout(15000);
  } catch (e) { note = "load failed: " + e.message.split("\n")[0]; }
  const walletCalls = await page.evaluate(() => window.__walletCalls ?? []).catch(() => []);
  const connected = walletCalls.includes("eth_requestAccounts") || walletCalls.includes("eth_accounts");
  const directCalls = direct.reduce((s, d) => s + d.methods.length, 0);
  const hosts = [...new Set(direct.map((d) => d.host))];
  const directWithAddr = direct.filter((d) => d.mentionsAddr).length;
  const walletReads = walletCalls.filter((m) => !/accounts|chainId|net_version|wallet_|personal_|eth_sign/.test(m)).length;
  results.push({ url, connected, directCalls, directWithAddr, walletReads, hosts, note });
  console.log(JSON.stringify({ url, connected, directCalls, directRequestsNamingUser: directWithAddr, readsThroughWallet: walletReads, directHosts: hosts.slice(0, 5), note }));
  await ctx.close();
}
await browser.close();
(await import("node:fs")).writeFileSync(new URL("./captured.json", import.meta.url), JSON.stringify(captured, null, 2));
