// In-page "allow direct?" dialog (PRD §5.3 "ask", §6.3 "never silent").
//
// Rendered by the ISOLATED-world content script into a Shadow DOM host so the
// page's own CSS can't touch it. No native alert()/confirm() (those are
// forbidden - they'd break extension messaging). Keyboard-accessible, dark and
// on-brand (palette mirrors popup.css). Resolves to the user's choice.

import type { SitePolicy } from "./protocol";

const HOST_ID = "__veil_policy_host__";

// Palette lifted from popup.css so the dialog matches the popup exactly.
const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .scrim {
    position: fixed; inset: 0; z-index: 2147483647;
    display: flex; align-items: center; justify-content: center;
    background: rgba(3, 6, 11, 0.62);
    backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    animation: fade .16s ease;
  }
  @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
  @keyframes rise { from { opacity: 0; transform: translateY(8px) scale(.98) } to { opacity: 1; transform: none } }
  .card {
    width: 360px; max-width: calc(100vw - 32px);
    background: #161b22; color: #e6edf3;
    border: 1px solid #262d38; border-radius: 14px;
    box-shadow: 0 18px 50px rgba(0,0,0,.55);
    padding: 18px 18px 16px;
    animation: rise .18s cubic-bezier(.2,.8,.3,1);
  }
  .head { display: flex; align-items: center; gap: 9px; margin-bottom: 11px; }
  .mark {
    width: 18px; height: 18px; border-radius: 6px; flex: none;
    background: radial-gradient(circle at 30% 30%, #e8a13a, #7a5a1f);
    box-shadow: 0 0 10px 1px rgba(232,161,58,.30);
  }
  .brand { font-size: 13px; font-weight: 650; letter-spacing: .2px; }
  .tag { margin-left: auto; font-size: 10.5px; text-transform: uppercase; letter-spacing: .6px; color: #8b97a7; }
  .title { font-size: 14.5px; font-weight: 620; line-height: 1.4; margin: 0 0 7px; }
  .title b { color: #fff; }
  .body { font-size: 12.5px; line-height: 1.5; color: #8b97a7; margin: 0 0 15px; }
  .body .warn { color: #e8a13a; font-weight: 600; }
  .row { display: flex; flex-direction: column; gap: 8px; }
  button {
    font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
    border-radius: 10px; padding: 10px 12px; width: 100%;
    border: 1px solid #2d3340; background: #1b222c; color: #e6edf3;
    transition: background .15s ease, border-color .15s ease, transform .05s ease;
  }
  button:hover { background: #222a35; }
  button:active { transform: translateY(1px); }
  button:focus-visible { outline: 2px solid #39d98a; outline-offset: 2px; }
  button.direct { background: #2a2113; border-color: #7a5a1f; color: #f0c988; }
  button.direct:hover { background: #342817; }
  button.direct:focus-visible { outline-color: #e8a13a; }
  .keep { color: #e6edf3; }
  .note { margin: 12px 1px 0; font-size: 11px; color: #5c6775; line-height: 1.45; }
`;

/**
 * Show the dialog for a dapp whose provider blocks anonymous access and whose
 * request can't be safely re-routed. Resolves once the user chooses.
 * A single dialog is shared if several requests block at once.
 */
let pending: Promise<SitePolicy> | null = null;

export function showPolicyDialog(dappHost: string): Promise<SitePolicy> {
  if (pending) return pending;
  if (typeof document === "undefined" || !document.documentElement) {
    return Promise.resolve("block"); // no DOM to ask in -> fail closed
  }

  pending = new Promise<SitePolicy>((resolve) => {
    // Remove any stale host from a previous run.
    document.getElementById(HOST_ID)?.remove();

    const host = document.createElement("div");
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = CSS;

    const scrim = document.createElement("div");
    scrim.className = "scrim";
    scrim.setAttribute("role", "dialog");
    scrim.setAttribute("aria-modal", "true");
    scrim.setAttribute("aria-labelledby", "ul-title");
    scrim.setAttribute("aria-describedby", "ul-body");

    scrim.innerHTML = `
      <div class="card" part="card">
        <div class="head">
          <span class="mark" aria-hidden="true"></span>
          <span class="brand">Veil</span>
          <span class="tag">Privacy choice</span>
        </div>
        <p class="title" id="ul-title"><b>${escapeHtml(dappHost)}</b>'s data provider blocks anonymous access.</p>
        <p class="body" id="ul-body">
          We can't route this request privately and can't safely re-route it.
          You can allow a <span class="warn">direct (non-private)</span> connection for this
          site, which reveals your IP to its provider - or keep it blocked.
        </p>
        <div class="row">
          <button class="keep" data-choice="block" type="button">Keep blocked</button>
          <button class="direct" data-choice="allow-direct" type="button">Allow direct for this site</button>
        </div>
        <p class="note">We remember your choice for ${escapeHtml(dappHost)}. Change it anytime in the Veil popup.</p>
      </div>
    `;

    root.append(style, scrim);
    document.documentElement.appendChild(host);

    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("button"));
    const keep = buttons.find((b) => b.dataset.choice === "block")!;

    let done = false;
    function finish(choice: SitePolicy) {
      if (done) return;
      done = true;
      cleanup();
      resolve(choice);
    }
    function cleanup() {
      document.removeEventListener("keydown", onKey, true);
      host.remove();
      pending = null;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); finish("block"); return; }
      if (e.key === "Tab") {
        // simple focus trap across the two buttons
        const first = buttons[0], last = buttons[buttons.length - 1];
        const active = root.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      }
    }

    for (const b of buttons) {
      b.addEventListener("click", () => finish(b.dataset.choice as SitePolicy));
    }
    // Clicking the scrim background keeps it blocked (safe default).
    scrim.addEventListener("mousedown", (e) => { if (e.target === scrim) finish("block"); });

    document.addEventListener("keydown", onKey, true);
    // Focus the safe option first.
    requestAnimationFrame(() => keep.focus());
  });

  return pending;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
