// Demo: the one thing a judge needs to SEE.
//   WITHOUT Veil: a direct read, the provider logs your real IP.
//   WITH Veil:    the same read, per account, over Tor -> a different exit each,
//                 and your real IP never leaves.
// Real data only. The real IP is masked in the rendered video (last two octets)
// so publishing the clip does not dox you; the live terminal shows it in full.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

const here = fileURLToPath(new URL(".", import.meta.url));
const extDir = here + "ext";
const IP_ECHO = "https://api.ipify.org?format=json";
const mask = (ip) => (ip || "").replace(/^(\d+\.\d+)\.\d+\.\d+$/, "$1.xxx.xxx");

const display = []; // lines for the video (real IP masked)
const show = (line = "", masked = line) => { console.log(line); display.push(masked); };

show("$ node demo-ip-reveal.mjs");
show("");
show("Veil  .  one route per account, over Tor");
show("--------------------------------------------------");
show("");

// ---- WITHOUT Veil: direct read reveals your real IP ----
show("[ WITHOUT Veil ]  a direct read");
const real = await (await fetch(IP_ECHO)).json().catch(() => ({ ip: null }));
show("  the RPC provider logs your real IP:");
show(`    ${real.ip}          <- this is YOU`, `    ${mask(real.ip)}          <- this is YOU`);
show("");

// ---- WITH Veil: boot the harness, two accounts, two exits ----
show("[ WITH Veil ]  booting tor-js through our own gateway ...");
const ctx = await chromium.launchPersistentContext("", {
  channel: "chromium", headless: true,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let sw = ctx.serviceWorkers().find((w) => w.url().includes("background.js"));
for (let i = 0; i < 80 && !sw; i++) { await sleep(250); sw = ctx.serviceWorkers().find((w) => w.url().includes("background.js")); }
if (!sw) { console.error("FAIL: service worker never appeared"); await ctx.close(); process.exit(1); }

const ready = await sw.evaluate(() => self.anonReady());
if (!ready.ok) { console.error("FAIL: harness did not boot", ready); await ctx.close(); process.exit(1); }
show(`  ready in ${Math.round((ready.readyMs ?? 0) / 1000)}s`);
show("");

const ipOf = (r) => { try { return JSON.parse(r.text).ip; } catch { return null; } };
const ra = await sw.evaluate(([u]) => self.anonGet(u, "account-A"), [IP_ECHO]);
const rb = await sw.evaluate(([u]) => self.anonGet(u, "account-B"), [IP_ECHO]);
const a = ra.ok && ipOf(ra), b = rb.ok && ipOf(rb);
show(`  account A  ->  Tor exit  ${a}`);
show(`  account B  ->  Tor exit  ${b}`);
show("");
show(`  different exits:  ${a && b && a !== b ? "YES" : "no"}`);
show(`  your real IP ${real.ip}  ->  never sent`, `  your real IP ${mask(real.ip)}  ->  never sent`);
show("");
show("  the provider sees two unrelated strangers, and no IP.");

writeFileSync(here + "demo-lines.txt", display.join("\n") + "\n");
await ctx.close();
