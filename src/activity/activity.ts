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

async function poll() {
  let res: { activity?: Entry[] } | undefined;
  try { res = await chrome.runtime.sendMessage({ type: "veil:activity" }); } catch { return; }
  const act = (res?.activity ?? []).filter((e) => e.id > lastId);
  for (const e of act) {
    lastId = Math.max(lastId, e.id);
    if (e.state === "tor" || e.state === "rerouted") tor++;
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
