// Unlink desktop app — dashboard logic.
//
// Works two ways with no build step:
//   1. Inside the Tauri window (the Rust shell spawns the helper, then loads this).
//   2. Opened as a plain page (file://.../app/ui/index.html) against a helper you
//      started yourself — handy for testing without compiling Tauri.
//
// It only ever READS the helper's local control API:
//   GET http://127.0.0.1:18545/__unlink/health
//   GET http://127.0.0.1:18545/__unlink/status
// (Override the base with ?api=http://host:port for testing.)

const API = new URLSearchParams(location.search).get("api") || "http://127.0.0.1:18545";
const POLL_MS = 2000;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---- local UI state (per-viewer convenience only; wrapped for file:// safety) ----
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

let protectionOn = lsGet("unlink.protection", "1") === "1";
let extPaired = lsGet("unlink.extPaired", "0") === "1";
let engineReadySeen = false;

// ---- view switching ----
$$(".snav li").forEach((li) => {
  li.addEventListener("click", () => {
    const v = li.dataset.view;
    $$(".snav li").forEach((x) => x.classList.toggle("on", x === li));
    $$(".view").forEach((s) => s.classList.toggle("on", s.dataset.view === v));
  });
});

// ---- toggles (local/intent only — no mutation route exists; a real one would
//      need a token-gated POST to the helper, per its SECURITY NOTE) ----
function wireSwitch(el, get, set) {
  if (!el) return;
  const apply = () => el.classList.toggle("off", !get());
  const toggle = () => { set(!get()); apply(); };
  el.addEventListener("click", toggle);
  el.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); } });
  apply();
}
wireSwitch($("#protSwitch"),
  () => protectionOn,
  (v) => { protectionOn = v; lsSet("unlink.protection", v ? "1" : "0"); renderFrom(lastStatus); });
wireSwitch($("#loginSwitch"), () => false, () => {}); // placeholder (coming soon)

$("#addBtn")?.addEventListener("click", () => {
  // In a shipped app this opens the Chrome Web Store listing. In the plain-page
  // preview there's nowhere to navigate, so just surface the pairing path.
  $("#extStep").textContent = "Opening the Chrome Web Store…";
});
$("#pairedBtn")?.addEventListener("click", () => { extPaired = true; lsSet("unlink.extPaired", "1"); renderPairing(); });

// ---- tiny helpers ----
const trunc = (a) => (a && a.length > 12 ? a.slice(0, 6) + "…" + a.slice(-4) : a || "—");
function avatar(addr) {
  let h = 0; for (const c of (addr || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = h % 360, b = (a + 70) % 360, c = (a + 200) % 360;
  return `conic-gradient(from ${a}deg, hsl(${a} 70% 60%), hsl(${b} 70% 58%), hsl(${c} 70% 60%), hsl(${a} 70% 60%))`;
}

// ---- rendering ----
let lastStatus = null;

function setConn(cls, text) {
  const pill = $("#connPill");
  pill.classList.remove("off", "wait");
  if (cls) pill.classList.add(cls);
  $("#connText").textContent = text;
}

function renderPairing() {
  // Engine step reflects real helper health.
  const s = lastStatus;
  const engineIc = $("#engineIc"), engineCard = engineIc.closest(".pcard");
  const extIc = $("#extIc"), extCard = extIc.closest(".pcard");

  if (!s) {
    engineCard.className = "pcard pair err"; engineIc.innerHTML = '<span class="cross">!</span>';
    $("#engineStep").textContent = "Not running — start the helper";
  } else if (s.harness === "ready") {
    engineCard.className = "pcard pair done"; engineIc.innerHTML = '<span class="check">✓</span>';
    $("#engineStep").textContent = `Connected · ${s.network}`;
  } else if (s.harness === "error") {
    engineCard.className = "pcard pair err"; engineIc.innerHTML = '<span class="cross">!</span>';
    $("#engineStep").textContent = "Engine error";
  } else {
    engineCard.className = "pcard pair"; engineIc.innerHTML = '<span class="spin"></span>';
    $("#engineStep").textContent = "Starting the privacy engine…";
  }

  // Extension step. There is no real extension↔helper handshake in this build,
  // so pairing is confirmed either by the user ("I've added the extension") or,
  // for the demo, auto-advanced shortly after the engine is ready. A production
  // build would flip this on a token-authenticated ping from the extension.
  if (extPaired) {
    extCard.className = "pcard pair done"; extIc.innerHTML = '<span class="check">✓</span>';
    $("#extStep").textContent = "Paired";
    $("#extFoot").textContent = "Paired · protecting this browser";
  } else {
    extCard.className = "pcard pair"; extIc.innerHTML = '<span class="spin"></span>';
    $("#extStep").textContent = "Waiting for the extension…";
    $("#extFoot").textContent = "Not paired yet";
  }
}

function renderFrom(s) {
  lastStatus = s;

  if (!s) {
    setConn("off", "Engine not running");
    renderPairing();
    return;
  }

  // titlebar connection pill
  if (s.harness === "ready") {
    setConn(s.network === "tor" ? null : "wait",
      s.network === "tor" ? "Tor connected" : "Passthrough (no privacy)");
  } else if (s.harness === "error") {
    setConn("off", "Engine error");
  } else {
    setConn("wait", "Connecting…");
  }

  // status-view header pill + copy
  const statePill = $("#statePill"), stateText = $("#stateText");
  const ready = s.harness === "ready";
  if (!protectionOn) {
    statePill.className = "state off"; stateText.textContent = "Protection off";
    $("#protHead").textContent = "Protection off";
    $("#protSub").textContent = "Turn protection on in Setup to route traffic through the engine.";
    $("#walletState").textContent = "not protected";
  } else if (ready && s.network === "tor") {
    statePill.className = "state"; stateText.textContent = "Private · Tor";
    $("#protHead").textContent = "Protection on";
    $("#protSub").textContent = "Your wallet, dapps and local tools leave through Tor — one route per account.";
    $("#walletState").textContent = "protected";
  } else if (ready) {
    statePill.className = "state off"; stateText.textContent = "Passthrough · no privacy";
    $("#protHead").textContent = "Protection on (passthrough)";
    $("#protSub").textContent = "Plumbing is live but the gateway is down — traffic is NOT private. Tests only.";
    $("#walletState").textContent = "passthrough";
  } else {
    statePill.className = "state off"; stateText.textContent = s.harness === "error" ? "Engine error" : "Starting…";
    $("#protHead").textContent = "Starting the engine…";
    $("#protSub").textContent = "The privacy engine is booting. No request leaves until it's ready.";
    $("#walletState").textContent = "booting";
  }

  // accounts table
  const rows = $("#acctRows");
  const accts = s.accounts || [];
  if (accts.length === 0) {
    rows.innerHTML = '<div class="empty">No account traffic yet. Point a wallet or <span class="mono">cast</span> at the local RPC, or seed accounts via <span class="mono">HELPER_ACCOUNTS</span>.</div>';
  } else {
    rows.innerHTML = accts.map((a) => `
      <div class="ar">
        <div class="nm">
          <span class="av" style="background:${avatar(a.address)}"></span>
          <div class="n"><div class="nn">${esc(a.label)}</div><div class="ad">${esc(trunc(a.address))}</div></div>
        </div>
        <div class="route" title="${esc(a.routeKey)} → ${esc(a.exitIp || "—")}">${esc(shortKey(a.routeKey))} <span class="ex">→ ${esc(a.exitIp || "—")}</span></div>
        <div class="ok">${esc(a.status || "private")}</div>
      </div>`).join("");
  }

  // tiles
  $("#todayReq").textContent = s.todayRequests ?? 0;
  $("#todaySites").textContent = s.sites ?? 0;
  try { $("#upstreamHost").textContent = new URL(s.upstream).host; } catch { $("#upstreamHost").textContent = s.upstream || "—"; }

  // settings
  $("#setNetwork").textContent = s.network || "—";
  $("#setApi").textContent = API.replace(/^https?:\/\//, "");

  // demo auto-pair once the engine is ready (see note in renderPairing)
  if (s.harness === "ready" && !engineReadySeen) {
    engineReadySeen = true;
    if (!extPaired) setTimeout(() => { extPaired = true; lsSet("unlink.extPaired", "1"); renderPairing(); }, 1500);
  }
  renderPairing();
}

const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const shortKey = (k) => (k && k.startsWith("acct:") ? "acct:" + k.slice(5, 11) : k || "neutral");

// ---- polling ----
async function poll() {
  try {
    const r = await fetch(API + "/__unlink/status", { cache: "no-store" });
    renderFrom(await r.json());
  } catch {
    renderFrom(null);
  }
}
poll();
setInterval(poll, POLL_MS);
