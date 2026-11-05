// Test A: each dapp used entirely over Tor (browser proxied through Tor, like Tor Browser).
// Test B: same, but standard JSON-RPC calls re-routed to a Tor-serving provider (what our extension would do).
import { chromium } from "/Users/amangupta/Desktop/Personal_Projects/pro_mum/research/experiments/u4-anon-rpc-transport/node_modules/playwright/index.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const run = promisify(execFile);
const MODE = process.argv[2]; // "tor" | "reroute"
const DAPPS = process.argv[3].split(",");
const ADDR = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
const FRIENDLY = "https://ethereum-rpc.publicnode.com"; // served Tor 12/12 in our measurement
async function viaTor(body) {
  const args = ["-sS", "--max-time", "40", "--socks5-hostname", "127.0.0.1:9150", "--proxy-user", `u${randomBytes(6).toString("hex")}:x`,
    "-H", "content-type: application/json", "--data-binary", body, FRIENDLY];
  const { stdout } = await run("curl", args, { maxBuffer: 1 << 22 });
  return stdout;
}
const fakeWallet = (addr) => {
  const listeners = {};
  const provider = {
    isMetaMask: true, _metamask: { isUnlocked: async () => true },
    on(e, f) { (listeners[e] ??= []).push(f); return provider; }, removeListener() { return provider; },
    async request({ method }) {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [addr];
      if (method === "eth_chainId") return "0x1";
      if (method === "net_version") return "1";
      if (method === "wallet_getPermissions" || method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts" }];
      throw Object.assign(new Error("unsupported in test wallet"), { code: 4200 });
    },
  };
  window.ethereum = provider;
  const info = { uuid: "9b1c0a8e-1111-4c1e-9a1e-000000000001", name: "MetaMask", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "io.metamask" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce); announce();
};
const browser = await chromium.launch({ proxy: { server: "socks5://127.0.0.1:9150" } });
const report = [];
for (const url of DAPPS) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(fakeWallet, ADDR);
  const rpc = { total: 0, ok: 0, failed: 0, rerouted: 0, rerouteFailed: 0, hosts: {} };
  if (MODE === "reroute") {
    await page.route("**/*", async (route) => {
      const req = route.request();
      const body = req.postData() ?? "";
      if (req.method() !== "POST" || !body.includes('"jsonrpc"')) return route.continue();
      // Only plain-mainnet JSON-RPC is safe to re-route; we cannot tell other chains from the body alone.
      try {
        const out = await viaTor(body);
        rpc.rerouted++;
        return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: out });
      } catch { rpc.rerouteFailed++; return route.abort(); }
    });
  }
  page.on("requestfinished", async (req) => {
    const body = req.postData() ?? "";
    if (req.method() !== "POST" || !body.includes('"jsonrpc"')) return;
    const host = new URL(req.url()).host;
    const res = await req.response().catch(() => null);
    let good = false;
    try { const j = await res.json(); good = (Array.isArray(j) ? j : [j]).some((r) => r && "result" in r); } catch {}
    rpc.total++; good ? rpc.ok++ : rpc.failed++;
    (rpc.hosts[host] ??= { ok: 0, failed: 0 })[good ? "ok" : "failed"]++;
  });
  page.on("requestfailed", (req) => {
    const body = req.postData() ?? "";
    if (req.method() !== "POST" || !body.includes('"jsonrpc"')) return;
    const host = new URL(req.url()).host;
    rpc.total++; rpc.failed++; (rpc.hosts[host] ??= { ok: 0, failed: 0 }).failed++;
  });
  let loaded = "ok";
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(35000);
  } catch (e) { loaded = "load failed: " + e.message.split("\n")[0].slice(0, 80); }
  const title = await page.title().catch(() => "");
  const blockedPage = /just a moment|attention required|access denied|blocked/i.test(title + " " + (await page.locator("body").innerText().catch(() => "")).slice(0, 400));
  const row = { url, mode: MODE, loaded, blockedPage, ...rpc };
  report.push(row);
  console.log(JSON.stringify(row));
  await ctx.close();
}
await browser.close();
writeFileSync(new URL(`./result-${MODE}.json`, import.meta.url), JSON.stringify(report, null, 2));
