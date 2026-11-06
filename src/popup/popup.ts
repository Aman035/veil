import type { GlobalStats, TabStats } from "../shared/protocol";

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
const todayReq = document.getElementById("todayReq")!;
const todaySites = document.getElementById("todaySites")!;
const bootFill = document.getElementById("bootFill")!;
const bootStep = document.getElementById("bootStep")!;

let activeTabId = -1;
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
  tabOrigin.textContent = origin ? origin.replace(/^https?:\/\//, "") : "no page";
  tabProtected.textContent = String(t?.protectedCount ?? 0);

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
}

async function refresh() {
  const tab = await getActiveTab();
  activeTabId = tab?.id ?? -1;
  const [g, t] = await Promise.all([
    chrome.runtime.sendMessage({ type: "popup:get" }) as Promise<GlobalStats>,
    activeTabId >= 0 ? (chrome.runtime.sendMessage({ type: "popup:tab-stats", tabId: activeTabId }) as Promise<TabStats | null>) : Promise.resolve(null),
  ]);
  render(g, t, tab?.url);
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

document.getElementById("openSettings")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
document.getElementById("openActivity")?.addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("activity/activity.html") }));

refresh();
setInterval(refresh, 1000);
