// Replay each captured dapp JSON-RPC request directly and over Tor (fresh circuit per try).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
const run = promisify(execFile);
const captured = JSON.parse(readFileSync(new URL("./captured.json", import.meta.url)));
async function once(c, tor) {
  const args = ["-sS", "-o", "-", "-w", "\n__META__%{http_code} %{time_total}", "--max-time", "45", "-X", "POST", "--data-binary", c.body, c.url];
  for (const [k, v] of Object.entries(c.headers)) args.push("-H", `${k}: ${v}`);
  if (tor) args.unshift("--socks5-hostname", "127.0.0.1:9150", "--proxy-user", `u${randomBytes(6).toString("hex")}:x`);
  let out = "";
  try { ({ stdout: out } = await run("curl", args, { maxBuffer: 1 << 22 })); } catch (e) { out = e.stdout ?? ""; }
  if (!out.includes("__META__")) return { ok: false, why: "no answer", secs: null };
  const i = out.lastIndexOf("__META__");
  const [code, secs] = out.slice(i + 8).trim().split(" ");
  const body = out.slice(0, i);
  let ok = false;
  try { const j = JSON.parse(body); ok = (Array.isArray(j) ? j : [j]).some((r) => r && "result" in r); } catch {}
  const low = body.toLowerCase();
  const why = ok ? "" : low.includes("just a moment") || low.includes("cf-chl") || low.includes("captcha") ? "challenge page" : `HTTP ${code} ${body.slice(0, 50).replace(/\s+/g, " ")}`;
  return { ok, why, secs: Number(secs) };
}
for (const [host, c] of Object.entries(captured)) {
  const d = [], t = [];
  for (let k = 0; k < 3; k++) { d.push(await once(c, false)); t.push(await once(c, true)); }
  const fmt = (xs) => `${xs.filter((x) => x.ok).length}/3` + (xs.some((x) => !x.ok) ? ` (${[...new Set(xs.filter((x) => !x.ok).map((x) => x.why))].join("; ")})` : "");
  const med = (xs) => { const s = xs.filter((x) => x.ok).map((x) => x.secs).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)].toFixed(2) + "s" : "-"; };
  console.log(`${host.padEnd(44)} direct ${fmt(d)} ${med(d)} | tor ${fmt(t)} ${med(t)}`);
}
