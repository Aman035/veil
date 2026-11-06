import type { GlobalStats, TabStats, SitePolicy } from "../shared/protocol";

const app = document.getElementById("app")!;
const toggle = document.getElementById("toggle")!;
const statusSection = document.querySelector(".status")!;
const statusText = document.getElementById("statusText")!;
const statusSub = document.getElementById("statusSub")!;
const tabOrigin = document.getElementById("tabOrigin")!;
const tabProtected = document.getElementById("tabProtected")!;
const tabRoutes = document.getElementById("tabRoutes")!;
const tabReroute = document.getElementById("tabReroute")!;
const tabBlocked = document.getElementById("tabBlocked")!;
const tabDirect = document.getElementById("tabDirect")!;
const policySeg = document.getElementById("policySeg")!;
const todayReq = document.getElementById("todayReq")!;
const todaySites = document.getElementById("todaySites")!;
const walletRow = document.getElementById("walletRow")!;
const walletState = document.getElementById("walletState")!;
const advanced = document.querySelector(".advanced") as HTMLElement;
const routeWallet = document.getElementById("routeWallet") as HTMLButtonElement;
const routeWalletNote = document.getElementById("routeWalletNote")!;
const bootFill = document.getElementById("bootFill")!;
const bootStep = document.getElementById("bootStep")!;

let activeTabId = -1;
let activeOrigin: string | null = null;
let currentPolicy: SitePolicy = "ask";
let connectingSince = 0;

// Honest first-boot progress: the bar eases toward a cap (never claims "done"
// until the worker is actually ready), and the label names the real stage.
function bootLabel(s: number): string {
  if (s < 3) return "starting the private worker";
  if (s < 10) return "building a Tor circuit";
  if (s < 20) return "negotiating a private route";
  return "almost there, the first time is slow";
}
function bootPercent(s: number): number {
  return Math.round(92 * (1 - Math.exp(-s / 8)));
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setState(s: "off" | "on" | "connecting" | "error") { app.setAttribute("data-state", s); }

function render(g: GlobalStats, t: TabStats | null, tabUrl?: string) {
  toggle.setAttribute("aria-checked", g.enabled ? "true" : "false");

  if (!g.enabled) {
    setState("off");
    statusText.textContent = "Off";
    statusSub.textContent = "not private";
    connectingSince = 0;
  } else if (g.harness === "ready") {
    setState("on");
    statusText.textContent = "Private · Tor";
    statusSub.textContent = g.harnessMs ? `ready in ${(g.harnessMs / 1000).toFixed(0)}s` : "";
    connectingSince = 0;
  } else if (g.harness === "error") {
    setState("error");
    statusText.textContent = "Paused: not private";
    statusSub.textContent = "tap to retry";
    connectingSince = 0;
  } else {
    setState("connecting");
    statusText.textContent = "Connecting privately…";
    statusSub.textContent = "~20s the first time";
    if (!connectingSince) connectingSince = Date.now();
    const elapsed = (Date.now() - connectingSince) / 1000;
    bootStep.textContent = bootLabel(elapsed);
    bootFill.style.width = bootPercent(elapsed) + "%";
  }

  // tab card
  let origin = t?.origin;
  if (!origin && tabUrl) { try { origin = new URL(tabUrl).origin; } catch {} }
  activeOrigin = origin ?? null;
  tabOrigin.textContent = origin ? origin.replace(/^https?:\/\//, "") : "no page";
  const protectedCount = t?.protectedCount ?? 0;
  tabProtected.textContent = String(protectedCount);

  const blocked = t?.blocked ?? 0;
  const direct = t?.direct ?? 0;
  tabBlocked.classList.toggle("hidden", blocked === 0);
  tabBlocked.querySelector("b")!.textContent = String(blocked);
  tabDirect.classList.toggle("hidden", direct === 0);
  tabDirect.querySelector("b")!.textContent = String(direct);

  const accountRoutes = (t?.routes ?? []).filter((r) => r.startsWith("acct:")).length;
  const hasNeutral = (t?.routes ?? []).includes("neutral");
  if (!t || t.total === 0) {
    tabRoutes.textContent = g.enabled ? "waiting for activity…" : "protection is off";
  } else if (accountRoutes > 0) {
    tabRoutes.textContent = `${accountRoutes} account${accountRoutes > 1 ? "s" : ""} on ${accountRoutes} separate route${accountRoutes > 1 ? "s" : ""}${hasNeutral ? " · 1 shared" : ""}`;
  } else {
    tabRoutes.textContent = "1 shared route (no account seen yet)";
  }
  tabReroute.classList.toggle("hidden", !(t && t.rerouted > 0));

  todayReq.textContent = String(g.todayRequests);
  todaySites.textContent = String(g.todaySites);

  renderHelper(g);
}

// Live wallet-traffic (desktop helper) state + the opt-in route toggle.
function renderHelper(g: GlobalStats) {
  walletRow.setAttribute("data-helper", g.helperConnected ? "on" : "off");
  walletState.textContent = g.helperConnected
    ? "Wallet traffic: protected · desktop helper"
    : "Wallet traffic: not covered";

  routeWallet.disabled = !g.helperConnected;
  routeWallet.setAttribute("aria-checked", g.routeWalletTraffic ? "true" : "false");
  advanced.setAttribute("data-disabled", g.helperConnected ? "false" : "true");

  // Honest note: never imply protection the proxy isn't actually providing.
  if (!g.helperConnected) {
    routeWalletNote.textContent = "Needs the desktop app to be running.";
  } else if (g.routeWalletTraffic && g.walletProxyActive) {
    routeWalletNote.textContent = "Active - wallet RPC & API hosts go through the helper.";
  } else if (g.routeWalletTraffic && !g.walletProxyActive) {
    routeWalletNote.textContent = "Wired - activates once the desktop app ships its proxy endpoint.";
  } else {
    routeWalletNote.textContent = "Route wallet RPC & API hosts through the helper (experimental).";
  }
}

function renderPolicy() {
  const origin = activeOrigin;
  for (const b of policySeg.querySelectorAll<HTMLButtonElement>(".seg-btn")) {
    const on = !!origin && b.dataset.policy === currentPolicy;
    b.setAttribute("aria-checked", on ? "true" : "false");
    b.disabled = !origin;
  }
  (policySeg.closest(".policy") as HTMLElement).style.opacity = origin ? "1" : ".45";
}

async function refresh() {
  const tab = await getActiveTab();
  activeTabId = tab?.id ?? -1;
  if (tab?.url) { try { activeOrigin = new URL(tab.url).origin; } catch { activeOrigin = null; } }
  const [g, t, pol] = await Promise.all([
    chrome.runtime.sendMessage({ type: "popup:get" }) as Promise<GlobalStats>,
    activeTabId >= 0 ? (chrome.runtime.sendMessage({ type: "popup:tab-stats", tabId: activeTabId }) as Promise<TabStats | null>) : Promise.resolve(null),
    activeOrigin ? (chrome.runtime.sendMessage({ type: "get-policy", origin: activeOrigin }) as Promise<{ policy: SitePolicy }>) : Promise.resolve(null),
  ]);
  if (pol?.policy) currentPolicy = pol.policy;
  render(g, t, tab?.url);
  renderPolicy();
}

toggle.addEventListener("click", async () => {
  const enabled = toggle.getAttribute("aria-checked") !== "true";
  toggle.setAttribute("aria-checked", enabled ? "true" : "false");
  if (enabled) setState("connecting");
  await chrome.runtime.sendMessage({ type: "popup:toggle", enabled });
  refresh();
});

// In the "Paused: not private" error state, the status line retries the harness.
statusSection.addEventListener("click", async () => {
  if (app.getAttribute("data-state") !== "error") return;
  setState("connecting");
  statusText.textContent = "Connecting privately…";
  await chrome.runtime.sendMessage({ type: "popup:retry" });
  refresh();
});

policySeg.addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".seg-btn");
  if (!btn || !activeOrigin || btn.disabled) return;
  currentPolicy = btn.dataset.policy as SitePolicy;
  renderPolicy();
  await chrome.runtime.sendMessage({ type: "set-policy", origin: activeOrigin, policy: currentPolicy });
});

routeWallet.addEventListener("click", async () => {
  if (routeWallet.disabled) return;
  const enabled = routeWallet.getAttribute("aria-checked") !== "true";
  routeWallet.setAttribute("aria-checked", enabled ? "true" : "false");
  await chrome.runtime.sendMessage({ type: "popup:set-route-wallet", enabled });
  refresh();
});

refresh();
setInterval(refresh, 1000);
