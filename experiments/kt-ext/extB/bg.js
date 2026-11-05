const seen = [];
chrome.webRequest.onBeforeRequest.addListener((d) => { seen.push({ url: d.url, initiator: d.initiator || null, tabId: d.tabId }); }, { urls: ["http://rpc.example.test:18901/*"] });
self.getSeen = () => seen;
self.setupDnr = async () => {
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [1], addRules: [{ id: 1, priority: 1,
    action: { type: "redirect", redirect: { url: "http://127.0.0.1:18901/redirected-by-B" } },
    condition: { urlFilter: "127.0.0.1:18901/rpc", resourceTypes: ["xmlhttprequest", "other", "main_frame", "sub_frame", "script", "ping"] } }] });
};
self.clearDnr = async () => chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [1] });
self.setupProxy = () => new Promise((res) => chrome.proxy.settings.set({ value: { mode: "pac_script", pacScript: { data:
  "function FindProxyForURL(url, host) { if (url.indexOf('18901/rpc') >= 0) return 'PROXY 127.0.0.1:18902'; return 'DIRECT'; }" } }, scope: "regular" }, res));
