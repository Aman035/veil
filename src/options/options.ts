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

load();
refreshStatus();
setInterval(refreshStatus, 1500);
