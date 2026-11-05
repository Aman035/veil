// Message shapes shared across worlds.
//
// MAIN world (inject) <-> ISOLATED world (content): window.postMessage, tagged.
// ISOLATED world (content) <-> background: chrome.runtime messaging.

export const TAG = "__unlink__";

// Per-site policy for the case a provider blocks anonymous access and the
// request can't be safely re-routed (PRD §5.3). "ask" is the default.
export type SitePolicy = "ask" | "block" | "allow-direct";

// --- page (inject) -> content ---
export type PageToContent =
  | { tag: typeof TAG; dir: "p2c"; kind: "rpc"; id: string; url: string; body: unknown }
  | { tag: typeof TAG; dir: "p2c"; kind: "accounts"; accounts: string[] }
  | { tag: typeof TAG; dir: "p2c"; kind: "hello" };

// --- content -> page (inject) ---
export type ContentToPage =
  | { tag: typeof TAG; dir: "c2p"; kind: "rpc-result"; id: string; ok: boolean; status?: number; body?: unknown; error?: string; allowDirect?: boolean }
  | { tag: typeof TAG; dir: "c2p"; kind: "state"; enabled: boolean; isProtected: boolean };

// --- content -> background ---
export type ContentToBg =
  | { type: "rpc"; url: string; body: unknown; origin: string }
  | { type: "accounts"; accounts: string[]; origin: string }
  | { type: "get-state"; origin: string }
  | { type: "get-policy"; origin: string }
  | { type: "set-policy"; origin: string; policy: SitePolicy };

// --- background -> content (responses) ---
export type RpcResponse = {
  ok: boolean;
  status?: number;
  body?: unknown;
  error?: string;
  routeKey?: string;
  rerouted?: boolean;
  blocked?: boolean;
  needsPolicy?: boolean; // non-reroutable block, site policy is "ask": show the dialog
  allowDirect?: boolean; // site policy is "allow-direct": the page performs the native request
};
export type StateResponse = { enabled: boolean; isProtected: boolean };

// --- popup <-> background ---
export type PopupToBg =
  | { type: "popup:get" }
  | { type: "popup:toggle"; enabled: boolean }
  | { type: "popup:tab-stats"; tabId: number }
  | { type: "popup:retry" }
  | { type: "get-policy"; origin: string }
  | { type: "set-policy"; origin: string; policy: SitePolicy };

export type TabStats = {
  origin: string;
  isProtected: boolean;
  total: number;
  protectedCount: number;
  routes: string[];       // distinct account routes used
  rerouted: number;
  blocked: number;
  direct: number;
};

export type GlobalStats = {
  enabled: boolean;
  network: "tor";
  harness: "booting" | "ready" | "error" | "idle";
  harnessMs?: number;
  todayRequests: number;
  todaySites: number;
};
