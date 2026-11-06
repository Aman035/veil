// One command for a live demo: starts the local IP echo and a Cloudflare quick
// tunnel (trycloudflare, no account), then prints the exact demo URL to open.
// The tunnel URL is ephemeral, which is why the page takes it via ?echo=.
// Needs: cloudflared (brew install cloudflared) and the Veil gateway running.
//   node demo-echo/serve-local.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 8799);
const SITE = process.env.SITE || "https://aman035.github.io/veil/demo.html";

const echo = spawn("node", [here + "echo-server.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "inherit" });
const cf = spawn("cloudflared", ["tunnel", "--url", "http://localhost:" + PORT], { stdio: ["ignore", "pipe", "pipe"] });

let printed = false;
const scan = (b) => {
  const m = b.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m && !printed) {
    printed = true;
    console.log("\n  Tunnel : " + m[0]);
    console.log("  OPEN   : " + SITE + "?echo=" + encodeURIComponent(m[0]));
    console.log("\n  Check the gateway is up (pgrep -fl tor-js-gateway, else ~/veil-gateway)");
    console.log("  and Veil is on. Ctrl-C here to stop the tunnel.\n");
  }
};
cf.stdout.on("data", scan); cf.stderr.on("data", scan);

const bye = () => { try { echo.kill(); } catch {} try { cf.kill(); } catch {} process.exit(0); };
process.on("SIGINT", bye); process.on("SIGTERM", bye);
cf.on("exit", (c) => { console.error("cloudflared exited (" + c + ")"); bye(); });
