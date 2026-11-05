// Onboarding page (first run). Explains §8 honestly and carries the single
// protection toggle. Protection is on by default ("private by default"); this
// screen lets the user confirm or turn it off, and marks onboarding complete.

const app = document.getElementById("app")!;
const toggle = document.getElementById("toggle")!;
const toggleTitle = document.getElementById("toggleTitle")!;
const toggleSub = document.getElementById("toggleSub")!;
const footState = document.getElementById("footState")!;

function render(enabled: boolean) {
  app.setAttribute("data-state", enabled ? "on" : "off");
  toggle.setAttribute("aria-checked", enabled ? "true" : "false");
  toggleTitle.textContent = enabled ? "Protection is on" : "Protection is off";
  toggleSub.textContent = enabled
    ? "Dapp reads leave through Tor, one route per account."
    : "Your dapp traffic is not private. Turn it on to protect it.";
  footState.textContent = enabled ? "Protection is on" : "Protection is off";
}

async function init() {
  // Mark onboarding seen; keep whatever enabled state is stored (default on).
  let enabled = true;
  try {
    const r = await chrome.storage.local.get({ enabled: true });
    enabled = !!r.enabled;
    await chrome.storage.local.set({ onboarded: true });
  } catch {}
  render(enabled);
}

toggle.addEventListener("click", async () => {
  const enabled = toggle.getAttribute("aria-checked") !== "true";
  render(enabled);
  try { await chrome.runtime.sendMessage({ type: "popup:toggle", enabled }); } catch {}
});

init();
