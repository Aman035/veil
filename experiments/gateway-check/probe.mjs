// Reachability probe for the EF demo tor-js gateway (a KPS address).
//
// Gateway KPS address: 152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ
// KPS in a browser harness dials over WebRTC; WebRTC data channels run DTLS
// over UDP (ICE host candidate) or, as a fallback, ICE-TCP. So a *closed* TCP
// port is suggestive but NOT definitive — the listener may be UDP-only. We
// therefore probe TCP (definitive when OPEN), and UDP (best-effort: a reply or
// ICMP-unreachable is informative; silence is inconclusive). publicnode is the
// control: if it is reachable and the gateway is not, the network path is fine.
import net from "node:net";
import dgram from "node:dgram";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

const GW_HOST = "152.236.3.22";
const GW_PORT = 12298;
const CONTROL_URL = "https://ethereum-rpc.publicnode.com";

function tcpProbe(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = new net.Socket();
    let done = false;
    const finish = (state, detail) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch {}
      resolve({ state, ms: Date.now() - t0, detail });
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish("open"));
    sock.once("timeout", () => finish("filtered/timeout", "no SYN-ACK within " + timeoutMs + "ms"));
    sock.once("error", (e) => finish(e.code === "ECONNREFUSED" ? "closed" : "error", e.code || String(e)));
    sock.connect(port, host);
  });
}

// Best-effort UDP: send a STUN binding request to the gateway ip:port. A valid
// listener may reply or stay silent; the OS may surface ICMP port-unreachable
// as an ECONNREFUSED on recv. Silence is inconclusive for UDP.
function udpProbe(host, port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = dgram.createSocket("udp4");
    let done = false;
    const finish = (state, detail) => {
      if (done) return;
      done = true;
      try { sock.close(); } catch {}
      resolve({ state, ms: Date.now() - t0, detail });
    };
    // Minimal STUN Binding Request (RFC 5389): type 0x0001, len 0, magic cookie, 12-byte txid.
    const msg = Buffer.alloc(20);
    msg.writeUInt16BE(0x0001, 0);
    msg.writeUInt16BE(0x0000, 2);
    msg.writeUInt32BE(0x2112a442, 4);
    for (let i = 8; i < 20; i++) msg[i] = Math.floor(Math.random() * 256);
    sock.once("error", (e) => finish(e.code === "ECONNREFUSED" ? "closed(icmp-unreach)" : "error", e.code || String(e)));
    sock.once("message", (m) => finish("reply", "got " + m.length + " bytes"));
    const timer = setTimeout(() => finish("no-reply(inconclusive)", "silent " + timeoutMs + "ms"), timeoutMs);
    timer.unref?.();
    sock.send(msg, port, host, (e) => { if (e) finish("senderror", e.code || String(e)); });
  });
}

async function controlProbe() {
  const t0 = Date.now();
  try {
    const { stdout } = await pexec("curl", [
      "-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "10",
      "-X", "POST", "-H", "content-type: application/json",
      "--data", '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}',
      CONTROL_URL,
    ]);
    return { state: "ok", httpCode: stdout.trim(), ms: Date.now() - t0 };
  } catch (e) {
    return { state: "fail", ms: Date.now() - t0, detail: String(e).slice(0, 120) };
  }
}

async function oneRound() {
  const ts = new Date().toISOString();
  const [tcp, udp, control] = await Promise.all([
    tcpProbe(GW_HOST, GW_PORT),
    udpProbe(GW_HOST, GW_PORT),
    controlProbe(),
  ]);
  const line = JSON.stringify({ ts, gatewayTcp: tcp, gatewayUdp: udp, control });
  console.log(line);
  return line;
}

const ROUNDS = Number(process.env.ROUNDS || 1);
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 90000);
for (let i = 0; i < ROUNDS; i++) {
  await oneRound();
  if (i < ROUNDS - 1) await new Promise((r) => setTimeout(r, INTERVAL_MS));
}
