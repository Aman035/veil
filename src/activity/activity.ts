// Live activity view: streams the reads Veil routes, as demo-visible proof that
// a real app's own reads go over Tor, per account. Polls the background's feed.
type Entry = { id: number; ts: number; origin: string; method: string; route: string; state: string };

const $ = (id: string) => document.getElementById(id)!;
const listEl = $("list");
const countEl = $("count");
const emptyEl = $("empty");

const STATE: Record<string, [string, string]> = {
  tor: ["over Tor", "ok"],
  rerouted: ["re-routed over Tor", "ok"],
  blocked: ["blocked, kept private", "warn"],
  direct: ["direct, you allowed it", "warn"],
  paused: ["paused, not sent", "warn"],
};
const host = (o: string) => { try { return new URL(o).host; } catch { return o; } };
const route = (r: string) => {
  if (r.startsWith("acct:")) { const a = r.slice(5).replace(/^0x/, ""); return "account 0x" + a.slice(0, 4) + "…"; }
  if (r === "neutral") return "shared";
  if (r.startsWith("mixed")) return "mixed";
  return r;
};
const time = (ts: number) => new Date(ts).toLocaleTimeString();

let lastId = 0;
let tor = 0;

// Per-route Tor exit, probed by the extension over each account's circuit.
const routesEl = $("routes");
const routes = new Map<string, string | null>();
function labelFor(key: string): string {
  if (key.startsWith("acct:")) { const a = key.slice(5).replace(/^0x/, ""); return "account 0x" + a.slice(0, 4) + "…"; }
  if (key === "neutral") return "shared circuit";
  if (key.startsWith("mixed")) return "mixed";
  return key;
}
function renderRoutes() {
  routesEl.innerHTML = "";
  for (const [key, ip] of routes) {
    const chip = document.createElement("div"); chip.className = "chip";
    chip.innerHTML = `<span class="who">${labelFor(key)}</span><span class="arrow">→</span>` +
      `<span class="exit${ip ? "" : " pending"}">${ip ? "Tor exit " + ip : "finding exit…"}</span>`;
    routesEl.appendChild(chip);
  }
}
async function probeRoutes() {
  const keys = [...routes.keys()];
  if (!keys.length) return;
  let res: { exits?: Record<string, string | null> } | undefined;
  try { res = await chrome.runtime.sendMessage({ type: "veil:exits", keys }); } catch { return; }
  const ex = res?.exits ?? {};
  let changed = false;
  for (const k of keys) if (ex[k] && routes.get(k) !== ex[k]) { routes.set(k, ex[k]); changed = true; }
  if (changed) renderRoutes();
}

async function poll() {
  let res: { activity?: Entry[] } | undefined;
  try { res = await chrome.runtime.sendMessage({ type: "veil:activity" }); } catch { return; }
  const act = (res?.activity ?? []).filter((e) => e.id > lastId);
  for (const e of act) {
    lastId = Math.max(lastId, e.id);
    if (e.state === "tor" || e.state === "rerouted") {
      tor++;
      if (!routes.has(e.route)) { routes.set(e.route, null); renderRoutes(); probeRoutes(); }
    }
    const [label, cls] = STATE[e.state] ?? [e.state, ""];
    const row = document.createElement("div");
    row.className = "row " + cls;
    row.innerHTML =
      `<span class="t">${time(e.ts)}</span>` +
      `<span class="app">${host(e.origin)}</span>` +
      `<span class="m">${e.method}</span>` +
      `<span class="r">${route(e.route)}</span>` +
      `<span class="s">${label}</span>`;
    listEl.prepend(row);
    requestAnimationFrame(() => row.classList.add("in"));
  }
  if (act.length) emptyEl.style.display = "none";
  countEl.textContent = String(tor);
  while (listEl.children.length > 120) listEl.lastChild?.remove();
}

poll();
setInterval(poll, 700);
setInterval(probeRoutes, 5000);
