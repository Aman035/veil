// Runtime gateway swap: the build ships the (down) EF demo gateway, but the
// options page points Veil at a reachable gateway and it reconnects, no rebuild.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const dist = here + "../dist";
const LOCAL_GW = "127.0.0.1:12298:uEiCM0JdH8pOR9u5FCwstM3bLo1LiK8IngxS0IPmOUvcRxQ";

const ctx = await chromium.launchPersistentContext("", {
  channel: "chromium", headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let sw = ctx.serviceWorkers().find((w) => w.url().includes("background.js"));
for (let i = 0; i < 40 && !sw; i++) { await sleep(250); sw = ctx.serviceWorkers().find((w) => w.url().includes("background.js")); }
const extId = new URL(sw.url()).host;

// Open the options page, add the local gateway, save.
const opt = await ctx.newPage();
await opt.goto(`chrome-extension://${extId}/options/options.html`, { waitUntil: "domcontentloaded" });
await opt.fill("#gateways", LOCAL_GW);
await opt.click("#save");
console.log("saved local gateway via options UI");

// The background watches storage and force-reboots the worker. Wait for connect.
let status = "";
for (let i = 0; i < 90; i++) {
  status = await opt.textContent("#status").catch(() => "");
  if (/Connected/i.test(status)) break;
  await sleep(1000);
}
console.log("options status:", JSON.stringify(status));

// Confirm storage holds the override and the harness is really ready.
const st = await sw.evaluate(() => chrome.storage.local.get(["netGateways"]));
const harnessReady = /Connected/i.test(status);
console.log("stored netGateways:", JSON.stringify(st.netGateways));

// Reset to default and confirm it goes back to trying the (down) default.
await opt.click("#reset");
await sleep(1500);
const afterReset = await sw.evaluate(() => chrome.storage.local.get(["netGateways"]));
console.log("after reset netGateways:", JSON.stringify(afterReset.netGateways));

console.log("\nPASS:", harnessReady && JSON.stringify(st.netGateways) === JSON.stringify([LOCAL_GW]) && (afterReset.netGateways == null || afterReset.netGateways.length === 0) ? "YES" : "NO");
await ctx.close();
process.exit(harnessReady ? 0 : 1);
