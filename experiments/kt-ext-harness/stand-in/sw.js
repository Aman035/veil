// Stand-in wallet service worker: claims the extension's single offscreen
// document and holds a sandboxed iframe, like MetaMask does.
async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["DOM_PARSER"],
    justification: "coexistence stand-in: hold a sandboxed iframe",
  });
}
ensureOffscreen().catch((e) => console.error("stand-in offscreen failed:", e));

self.standReady = async () => {
  await ensureOffscreen();
  return { ok: true, hasOffscreen: await chrome.offscreen.hasDocument?.() };
};
