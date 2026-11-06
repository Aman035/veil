#!/usr/bin/env node
// Start and monitor the local tor-js gateway that Veil routes through.
//
//   node tools/gateway.mjs            start if needed, then show live status (Ctrl-C to stop watching; gateway keeps running)
//   node tools/gateway.mjs status     print status once and exit
//   node tools/gateway.mjs start      start if needed, print status, exit
//   node tools/gateway.mjs stop       stop the gateway
//
// The gateway binary is expected at ~/veil-gateway (a copy of ethereum/tor-js's
// tor-js-gateway). It reuses its key in ~/Library/Application Support, so its
// certhash is stable across restarts.
import { execSync, spawn } from "node:child_process";
import { existsSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = 12298;
const LOG = join(homedir(), ".veil-gateway.log");
const CANDIDATES = [join(homedir(), "veil-gateway"), join(process.cwd(), "target/release/tor-js-gateway")];
const BIN = CANDIDATES.find(existsSync);

const C = { gray: "\x1b[90m", green: "\x1b[32m", red: "\x1b[31m", amber: "\x1b[33m", bold: "\x1b[1m", reset: "\x1b[0m" };
const sh = (c) => { try { return execSync(c, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } };
const pids = () => sh(`pgrep -f 'veil-gateway|tor-js-gateway'`).split("\n").filter(Boolean);
const listening = () => sh(`lsof -nP -iUDP:${PORT}`) !== "";
const certhash = () => { try { return (readFileSync(LOG, "utf8").match(/uEi[A-Za-z0-9_-]+/g) || []).slice(-1)[0] || ""; } catch { return ""; } };

function status() {
  const up = pids().length > 0 && listening();
  const ch = certhash();
  const dot = up ? `${C.green}●${C.reset}` : `${C.red}○${C.reset}`;
  let line = `${dot} gateway ${up ? `${C.green}UP${C.reset}` : `${C.red}DOWN${C.reset}`}  ${C.gray}127.0.0.1:${PORT}${C.reset}`;
  if (up && ch) line += `  ${C.gray}certhash ${ch.slice(0, 10)}…${C.reset}`;
  return { up, ch, line };
}

async function waitUp(timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (status().up) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function start() {
  if (!BIN) {
    console.error(`${C.red}No gateway binary found.${C.reset} Expected ~/veil-gateway. Build ethereum/tor-js's tor-js-gateway and copy it there (see README).`);
    process.exit(1);
  }
  if (status().up) return;
  console.log(`${C.gray}starting gateway, waiting for Tor to sync…${C.reset}`);
  const fd = openSync(LOG, "a");
  const child = spawn(BIN, [], { detached: true, stdio: ["ignore", fd, fd] });
  child.unref();
}

function stop() {
  const ps = pids();
  if (!ps.length) { console.log("gateway was not running"); return; }
  sh(`kill ${ps.join(" ")}`);
  console.log("gateway stopped");
}

const cmd = process.argv[2] || "watch";

if (cmd === "status") {
  const s = status();
  console.log(s.line);
  if (s.up && s.ch) console.log(`${C.bold}Network settings line:${C.reset} 127.0.0.1:${PORT}:${s.ch}`);
  process.exit(s.up ? 0 : 1);
} else if (cmd === "stop") {
  stop();
} else {
  // start (if needed) then show status
  start();
  const ok = await waitUp();
  const s = status();
  console.log(s.line);
  if (s.up && s.ch) console.log(`${C.bold}Paste into Veil popup -> Network settings:${C.reset}\n  127.0.0.1:${PORT}:${s.ch}`);
  if (!ok) { console.error(`${C.amber}gateway did not come up within 60s; check ${LOG}${C.reset}`); process.exit(1); }
  if (cmd === "start") process.exit(0);
  // watch mode: reprint status every 5s so the terminal always shows it
  console.log(`${C.gray}watching (Ctrl-C to stop; gateway keeps running)…${C.reset}`);
  setInterval(() => {
    const now = new Date().toLocaleTimeString();
    process.stdout.write(`\r${status().line}  ${C.gray}${now}${C.reset}   `);
  }, 5000);
}
