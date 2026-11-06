// Network settings: override the gateway (and specifier) at runtime. Writes to
// chrome.storage.local; background.ts watches those keys and reboots the worker.
import type { GlobalStats } from "../shared/protocol";

declare const __VEIL_SPECIFIER__: string;
declare const __VEIL_GATEWAYS__: string;
const DEF_SPEC = __VEIL_SPECIFIER__;
const DEF_GW: string[] = JSON.parse(__VEIL_GATEWAYS__);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const gwEl = $<HTMLTextAreaElement>("gateways");
const specEl = $<HTMLInputElement>("specifier");
const noteEl = $<HTMLElement>("note");
const statusEl = $<HTMLElement>("status");
const segEl = $<HTMLElement>("policySeg");
const pnoteEl = $<HTMLElement>("pnote");

specEl.placeholder = DEF_SPEC;
gwEl.placeholder = DEF_GW.join("\n") || "(none)";

async function load() {
  const { netSpecifier, netGateways } = await chrome.storage.local.get(["netSpecifier", "netGateways"]);
  if (typeof netSpecifier === "string") specEl.value = netSpecifier;
  if (Array.isArray(netGateways)) gwEl.value = netGateways.join("\n");
}

const STATUS: Record<string, [string, string]> = {
  ready: ["Connected, private over Tor", "ok"],
  booting: ["Connecting…", ""],
  error: ["Not connected, gateway unreachable?", "warn"],
  idle: ["Idle", ""],
};
async function refreshStatus() {
  try {
    const g = (await chrome.runtime.sendMessage({ type: "popup:get" })) as GlobalStats;
    if (!g?.enabled) { statusEl.textContent = "Protection is off"; statusEl.className = "status"; return; }
    const [text, cls] = STATUS[g.harness] ?? [g.harness, ""];
    statusEl.textContent = g.harness === "ready" && g.harnessMs ? `${text} (in ${(g.harnessMs / 1000).toFixed(0)}s)` : text;
    statusEl.className = "status " + cls;
  } catch { statusEl.textContent = "—"; statusEl.className = "status"; }
}

$("save").addEventListener("click", async () => {
  const spec = specEl.value.trim();
  const gws = gwEl.value.split("\n").map((s) => s.trim()).filter(Boolean);
  await chrome.storage.local.set({ netSpecifier: spec, netGateways: gws });
  noteEl.textContent = gws.length ? "Saved. Reconnecting to the new gateway…" : "Saved. Using the default gateway…";
});

$("reset").addEventListener("click", async () => {
  await chrome.storage.local.remove(["netSpecifier", "netGateways"]);
  specEl.value = ""; gwEl.value = "";
  noteEl.textContent = "Reset to the default gateway. Reconnecting…";
});

// Default blocking policy: what Veil does when a provider blocks Tor and the read
// can't be safely re-routed. Per-site overrides are set from the in-page dialog.
const POLICY_NOTE: Record<string, string> = {
  ask: "Veil asks you, per site, before any direct connection.",
  block: "Blocked reads stay blocked. Nothing is ever sent in the clear.",
  "allow-direct": "Blocked reads fall back to a direct, non-private connection, exposing your IP to that provider.",
};
function renderPolicy(p: string) {
  for (const b of segEl.querySelectorAll<HTMLButtonElement>(".seg-btn")) {
    b.setAttribute("aria-checked", b.dataset.policy === p ? "true" : "false");
  }
  pnoteEl.textContent = POLICY_NOTE[p] ?? "";
}
async function loadPolicy() {
  const { defaultPolicy } = await chrome.storage.local.get({ defaultPolicy: "ask" });
  renderPolicy((defaultPolicy as string) || "ask");
}
segEl.addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".seg-btn");
  if (!btn) return;
  const p = btn.dataset.policy!;
  renderPolicy(p);
  await chrome.storage.local.set({ defaultPolicy: p });
});

load();
loadPolicy();
refreshStatus();
setInterval(refreshStatus, 1500);
