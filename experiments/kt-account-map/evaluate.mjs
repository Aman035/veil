// Score the account-mapping heuristic against captured.json.
//
// Ground truth: each request was generated in a tab connected as exactly one
// address (`connectedAddr`). So a request's correct account is its connectedAddr.
//
// We run the heuristic two ways:
//   WALLET-ORACLE: router is told all the connected addresses up front (as the
//     extension learns them from each tab's wallet connection). This is the
//     real product condition.
//   LEARNED-ONLY: router starts blank and only learns from balance/nonce reads
//     in the stream (no wallet oracle) — a lower bound.
//
// Metrics:
//   false link  = a request keyed to a single account X whose ground-truth
//                 connected account is Y != X  (cross-account linkage: the bug
//                 the PRD fears). Also counts any "mixed" key spanning accounts.
//   missed link = request mentions its own connected account in the body but
//                 was routed NEUTRAL (privacy still holds via neutral, but it
//                 shares the neutral route with unrelated traffic).
//   correct     = keyed to its own account, or neutral when its account is not
//                 named in the body at all.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRouter, accountsMentioned, norm, NEUTRAL } from "./heuristic.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const data = JSON.parse(readFileSync(here + "captured.json", "utf8"));

// Flatten to one row per JSON-RPC call (batches expand).
const rows = [];
for (const req of data) for (const call of req.calls) rows.push({ gt: norm(req.connectedAddr), dapp: req.dapp, host: req.host, call });
const allAccounts = [...new Set(rows.map((r) => r.gt).filter(Boolean))];

function score(label, knownForRow) {
  let falseLink = 0, missed = 0, correct = 0, neutral = 0, single = 0, mixed = 0;
  const examples = { falseLink: [], missed: [] };
  for (const r of rows) {
    const known = knownForRow(r);
    const key = (() => {
      const hit = accountsMentioned(r.call, known);
      if (hit.length === 0) return NEUTRAL;
      if (hit.length === 1) return "acct:" + hit[0];
      return "mixed:" + hit.sort().join(",");
    })();

    if (key === NEUTRAL) {
      neutral++;
      // does the body actually name its own account? then it's a miss.
      if (known.has(r.gt) && accountsMentioned(r.call, new Set([r.gt])).length) {
        missed++; if (examples.missed.length < 4) examples.missed.push({ dapp: r.dapp, method: r.call.method });
      } else correct++;
    } else if (key.startsWith("acct:")) {
      single++;
      const keyed = key.slice(5);
      if (keyed === r.gt) correct++;
      else { falseLink++; if (examples.falseLink.length < 4) examples.falseLink.push({ dapp: r.dapp, method: r.call.method, keyed, gt: r.gt }); }
    } else {
      mixed++;
      // a mixed key spans >1 account; if it spans an account other than gt it's a cross-link
      const spans = key.slice(6).split(",");
      if (spans.some((a) => a !== r.gt)) { falseLink++; if (examples.falseLink.length < 4) examples.falseLink.push({ dapp: r.dapp, method: r.call.method, keyed: key, gt: r.gt }); }
      else correct++;
    }
  }
  return { label, total: rows.length, correct, neutral, single, mixed, missed, falseLink, examples };
}

console.log("captured requests (calls):", rows.length, "| distinct connected accounts:", allAccounts.length);
console.log("per dapp:", JSON.stringify(data.reduce((m, r) => ((m[r.dapp] = (m[r.dapp] || 0) + r.calls.length), m), {}), null, 0));

// WALLET-ORACLE: all connected accounts known from the start.
const oracle = new Set(allAccounts);
const r1 = score("wallet-oracle", () => oracle);

// LEARNED-ONLY: learn per-dapp stream from balance/nonce; known grows as the
// router sees reads. We approximate by learning across the whole stream.
const learner = createRouter([]);
for (const r of rows) learner.observe(r.call);
const r2 = score("learned-only", () => learner.known);

for (const r of [r1, r2]) {
  console.log(`\n=== ${r.label} ===`);
  console.log(JSON.stringify({ total: r.total, correct: r.correct, falseLink: r.falseLink, missed: r.missed, neutral: r.neutral, single: r.single, mixed: r.mixed }, null, 2));
  if (r.examples.falseLink.length) console.log("false-link examples:", JSON.stringify(r.examples.falseLink));
  if (r.examples.missed.length) console.log("missed examples:", JSON.stringify(r.examples.missed));
}
console.log("\nlearned addresses (learned-only mode):", learner.known.size, "of", allAccounts.length, "connected accounts");
