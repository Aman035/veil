// End-to-end test for the desktop helper (D3).
//
// Starts helper.mjs as a child process with the PASSTHROUGH specifier (the EF
// tor-js demo gateway is currently down, so real tor-js boot would hang — see
// PRD §11 / evidence.md E11). Passthrough exercises the whole plumbing
// deterministically: id blinding, per-account isolation keying, forward
// through the harness, response restore. Then it runs real Foundry `cast`
// against http://127.0.0.1:18545, asserts each returns a plausible value, and
// tears everything down (no leaked Chromium).
import { spawn, execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const RPC = "http://127.0.0.1:18545";
const VITALIK = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

let helper;
function startHelper() {
  return new Promise((resolve, reject) => {
    helper = spawn("node", [join(HERE, "helper.mjs")], {
      env: {
        ...process.env,
        HELPER_SPECIFIER: "0x4fd77be300f31c5fe6ab266d35d27750a3478d27", // passthrough
        HELPER_GATEWAYS: "[]",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const to = setTimeout(() => reject(new Error("helper did not become ready in 90s")), 90_000);
    const onData = (b) => {
      const s = b.toString();
      process.stdout.write(s);
      if (s.includes("private JSON-RPC on")) { clearTimeout(to); resolve(); }
    };
    helper.stdout.on("data", onData);
    helper.stderr.on("data", (b) => process.stderr.write(b.toString()));
    helper.on("exit", (c) => { clearTimeout(to); reject(new Error(`helper exited early (code ${c})`)); });
  });
}

async function stopHelper() {
  if (!helper || helper.exitCode !== null) return;
  await new Promise((resolve) => {
    helper.removeAllListeners("exit");
    helper.on("exit", resolve);
    helper.kill("SIGTERM");
    setTimeout(() => { try { helper.kill("SIGKILL"); } catch {} resolve(); }, 10_000);
  });
}

async function cast(args) {
  const t = Date.now();
  const { stdout } = await execFileP("cast", [...args, "--rpc-url", RPC], { timeout: 60_000 });
  return { out: stdout.trim(), ms: Date.now() - t };
}

const checks = [];
function check(name, cond, detail) {
  checks.push({ name, pass: !!cond, detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}  ${detail ?? ""}`);
}

async function main() {
  console.log("--- starting helper (passthrough specifier) ---");
  await startHelper();
  console.log("--- running cast against", RPC, "---");

  const bn = await cast(["block-number"]);
  check("cast block-number", /^\d+$/.test(bn.out) && Number(bn.out) > 20_000_000, `block=${bn.out} (${bn.ms}ms)`);

  const bal = await cast(["balance", VITALIK]);
  check("cast balance", /^\d+$/.test(bal.out) && BigInt(bal.out) >= 0n, `wei=${bal.out} (${bal.ms}ms)`);

  const call = await cast(["call", USDC, "balanceOf(address)(uint256)", VITALIK]);
  const usdc = call.out.split(" ")[0];
  check("cast call USDC.balanceOf", /^\d+$/.test(usdc), `usdc=${call.out} (${call.ms}ms)`);

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  return failed.length === 0;
}

let ok = false;
try { ok = await main(); }
catch (e) { console.error("test error:", e.message); }
finally { await stopHelper(); }
process.exit(ok ? 0 : 1);
