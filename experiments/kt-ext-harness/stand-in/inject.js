// MAIN-world content script: mimics a wallet injecting a provider, to confirm
// two extensions' MAIN-world injections coexist on a page.
(() => {
  try {
    if (!window.ethereum) {
      Object.defineProperty(window, "ethereum", {
        value: { isStandInWallet: true, request: async () => { throw new Error("stand-in only"); } },
        configurable: true,
      });
    }
    window.__standInInjected = true;
  } catch (e) { /* another provider already defined it; fine */ }
})();
