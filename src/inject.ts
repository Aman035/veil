// MAIN-world interceptor (document_start). Runs in the page's world so it can
// wrap the page's own fetch/XHR and observe window.ethereum. No chrome APIs
// here — it talks to the ISOLATED content script via window.postMessage.
import { TAG, type PageToContent, type ContentToPage } from "./shared/protocol";

(() => {
  if ((window as any).__unlinkInjected) return;
  (window as any).__unlinkInjected = true;

  let state: { enabled: boolean; isProtected: boolean } | null = null;
  let resolveFirstState: (() => void) | null = null;
  const firstState = new Promise<void>((r) => (resolveFirstState = r));

  const pending = new Map<string, (r: ContentToPage & { kind: "rpc-result" }) => void>();
  const rid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

  function post(msg: PageToContent) { window.postMessage(msg, "*"); }

  window.addEventListener("message", (ev: MessageEvent) => {
    if (ev.source !== window) return;
    const d = ev.data as ContentToPage;
    if (!d || d.tag !== TAG || d.dir !== "c2p") return;
    if (d.kind === "state") {
      state = { enabled: d.enabled, isProtected: d.isProtected };
      resolveFirstState?.(); resolveFirstState = null;
    } else if (d.kind === "rpc-result") {
      pending.get(d.id)?.(d); pending.delete(d.id);
    }
  });

  post({ tag: TAG, dir: "p2c", kind: "hello" });

  // Resolve whether to intercept, waiting for the first state if needed so a
  // request at page load never slips out before we know (PRD: nothing leaks
  // while connecting).
  async function shouldIntercept(): Promise<boolean> {
    if (state === null) {
      await Promise.race([firstState, new Promise((r) => setTimeout(r, 1500))]);
    }
    return !!(state && state.enabled && state.isProtected);
  }

  function looksLikeRpc(bodyText: string): boolean {
    if (!bodyText || bodyText.length > 2_000_000) return false;
    if (bodyText.indexOf('"jsonrpc"') === -1 && bodyText.indexOf('"method"') === -1) return false;
    try {
      const j = JSON.parse(bodyText);
      const one = Array.isArray(j) ? j[0] : j;
      return !!one && typeof one.method === "string";
    } catch { return false; }
  }

  function route(url: string, body: unknown): Promise<ContentToPage & { kind: "rpc-result" }> {
    const id = rid();
    return new Promise((resolve) => {
      pending.set(id, resolve);
      post({ tag: TAG, dir: "p2c", kind: "rpc", id, url, body });
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); resolve({ tag: TAG, dir: "c2p", kind: "rpc-result", id, ok: false, error: "unlink: routing timeout" }); }
      }, 45000);
    });
  }

  // --- fetch ---
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    try {
      const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (method === "POST" && /^https?:/i.test(url)) {
        let bodyText = "";
        if (init?.body != null && typeof init.body === "string") bodyText = init.body;
        else if (input instanceof Request) bodyText = await input.clone().text().catch(() => "");
        if (looksLikeRpc(bodyText) && (await shouldIntercept())) {
          const res = await route(url, JSON.parse(bodyText));
          if (res.ok) {
            return new Response(typeof res.body === "string" ? res.body : JSON.stringify(res.body), {
              status: res.status ?? 200,
              headers: { "content-type": "application/json" },
            });
          }
          // User chose "allow direct" for this site: perform the real native
          // request. This is the ONLY sanctioned direct path (PRD §5.3).
          if (res.allowDirect) return nativeFetch(input as any, init);
          // Otherwise fail closed (never silently direct).
          throw new Error(res.error || "unlink: request blocked (not private)");
        }
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("unlink:")) throw e;
      // fall through to native on our own bugs rather than breaking the page
    }
    return nativeFetch(input as any, init);
  };

  // --- XMLHttpRequest ---
  const XHR = window.XMLHttpRequest;
  const open = XHR.prototype.open;
  const send = XHR.prototype.send;
  XHR.prototype.open = function (this: any, m: string, u: string) {
    this.__unlink = { method: String(m).toUpperCase(), url: String(u) };
    return open.apply(this, arguments as any);
  };
  XHR.prototype.send = function (this: any, body?: any) {
    const info = this.__unlink;
    const bodyText = typeof body === "string" ? body : "";
    if (info && info.method === "POST" && /^https?:/i.test(info.url) && looksLikeRpc(bodyText)) {
      const xhr = this;
      shouldIntercept().then((yes) => {
        if (!yes) return send.apply(xhr, [body]);
        route(info.url, JSON.parse(bodyText)).then((res) => {
          // User chose "allow direct" for this site: do the real native send.
          if (!res.ok && res.allowDirect) return send.apply(xhr, [body]);
          const text = res.ok ? (typeof res.body === "string" ? res.body : JSON.stringify(res.body)) : "";
          Object.defineProperty(xhr, "readyState", { value: 4, configurable: true });
          Object.defineProperty(xhr, "status", { value: res.ok ? (res.status ?? 200) : 0, configurable: true });
          Object.defineProperty(xhr, "responseText", { value: text, configurable: true });
          Object.defineProperty(xhr, "response", { value: text, configurable: true });
          xhr.dispatchEvent(new Event("readystatechange"));
          xhr.dispatchEvent(new Event(res.ok ? "load" : "error"));
          xhr.dispatchEvent(new Event("loadend"));
        });
      });
      return;
    }
    return send.apply(this, [body]);
  };

  // --- observe the wallet's accounts (reliable account source) ---
  function wrapProvider(p: any) {
    if (!p || p.__unlinkWrapped || typeof p.request !== "function") return p;
    const orig = p.request.bind(p);
    p.request = async (args: any) => {
      const out = await orig(args);
      try {
        if (args && (args.method === "eth_accounts" || args.method === "eth_requestAccounts") && Array.isArray(out) && out.length) {
          post({ tag: TAG, dir: "p2c", kind: "accounts", accounts: out });
        }
      } catch {}
      return out;
    };
    p.__unlinkWrapped = true;
    return p;
  }
  try {
    let current = (window as any).ethereum;
    if (current) wrapProvider(current);
    Object.defineProperty(window, "ethereum", {
      configurable: true,
      get() { return current; },
      set(v) { current = wrapProvider(v); },
    });
  } catch { /* some wallets lock window.ethereum; accounts still learned from reads */ }
})();
