let n = 0;
async function tick() {
  try {
    await fetch("http://rpc.example.test:18901/rpc?from=extA&n=" + (n++), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: n, method: "eth_getBalance", params: ["0xabc", "latest"] }) });
  } catch (e) {}
  setTimeout(tick, 500);
}
tick();
