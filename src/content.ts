// ISOLATED-world content script (document_start). The only side that can reach
// chrome.runtime. Relays page RPC to the background and pushes state back.
import { TAG, type PageToContent, type ContentToPage, type RpcResponse, type StateResponse } from "./shared/protocol";
import { showPolicyDialog } from "./shared/dialog";

const origin = location.origin;

function toPage(msg: ContentToPage) { window.postMessage(msg, origin === "null" ? "*" : origin); }

async function pushState() {
  try {
    const s: StateResponse = await chrome.runtime.sendMessage({ type: "get-state", origin });
    toPage({ tag: TAG, dir: "c2p", kind: "state", enabled: s.enabled, isProtected: s.isProtected });
  } catch { /* background asleep; it will answer the hello retry */ }
}

window.addEventListener("message", async (ev: MessageEvent) => {
  if (ev.source !== window) return;
  const d = ev.data as PageToContent;
  if (!d || d.tag !== TAG || d.dir !== "p2c") return;

  if (d.kind === "hello") { pushState(); return; }

  if (d.kind === "accounts") {
    try { await chrome.runtime.sendMessage({ type: "accounts", accounts: d.accounts, origin }); } catch {}
    return;
  }

  if (d.kind === "rpc") {
    let res: RpcResponse;
    try {
      res = await chrome.runtime.sendMessage({ type: "rpc", url: d.url, body: d.body, origin });
      // Non-reroutable block, site policy is "ask": ask the user, in-page, once.
      if (res && res.needsPolicy) {
        const choice = await showPolicyDialog(location.host);
        try { await chrome.runtime.sendMessage({ type: "set-policy", origin, policy: choice }); } catch {}
        // Re-run the request now that a policy is stored (fail closed / allow-direct).
        res = await chrome.runtime.sendMessage({ type: "rpc", url: d.url, body: d.body, origin });
      }
    } catch (e) {
      res = { ok: false, error: "unlink: background unavailable" };
    }
    toPage({ tag: TAG, dir: "c2p", kind: "rpc-result", id: d.id, ok: res.ok, status: res.status, body: res.body, error: res.error, allowDirect: res.allowDirect });
  }
});

// Background broadcasts when the toggle or site policy changes.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "state-changed") pushState();
});

pushState();
