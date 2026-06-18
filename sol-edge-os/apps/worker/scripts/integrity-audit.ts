/**
 * Nightly database integrity audit. Scans every trade's exit/stop-move
 * history against the locked lifecycle invariants (src/consistency.ts) and
 * reports violations. Read-only against trades/exits/stop-moves — the only
 * writes are audit_logs entries recording that the scan ran and what it found.
 *
 * Run manually: pnpm --filter @sol-edge/worker integrity-audit
 * Actual nightly scheduling depends on the deployment platform (Railway/Fly
 * cron, etc.) — not wired up yet since the worker isn't deployed.
 */
import { getAllTradesWithHistory, writeAudit } from "@sol-edge/db";
import { checkTradeConsistency, toConsistencyTrade, type Violation } from "@sol-edge/analytics";

const ACTOR = "integrity-audit";

async function main() {
  const trades = await getAllTradesWithHistory();
  const allViolations: Violation[] = [];

  for (const trade of trades) {
    const violations = checkTradeConsistency(toConsistencyTrade(trade));
    allViolations.push(...violations);
  }

  console.log(`Scanned ${trades.length} trades.`);
  if (allViolations.length === 0) {
    console.log("No violations found.");
  } else {
    const byTrade = new Map<string, Violation[]>();
    for (const v of allViolations) byTrade.set(v.tradeId, [...(byTrade.get(v.tradeId) ?? []), v]);

    console.log(`Found ${allViolations.length} violations across ${byTrade.size} trades:\n`);
    for (const [tradeId, violations] of byTrade) {
      const byRule = new Map<string, number>();
      for (const v of violations) byRule.set(v.rule, (byRule.get(v.rule) ?? 0) + 1);
      console.log(`  ${tradeId}: ${violations.length} violations`);
      for (const [rule, count] of byRule) console.log(`    - ${rule}: ${count}`);
      console.log(`    example: ${violations[0].detail}`);
    }
  }

  await writeAudit({
    actor: ACTOR,
    action: "INTEGRITY_AUDIT_RUN",
    data: { tradesScanned: trades.length, violationsFound: allViolations.length, tradesWithViolations: new Set(allViolations.map((v) => v.tradeId)).size },
  });

  for (const v of allViolations) {
    await writeAudit({ actor: ACTOR, action: "INTEGRITY_VIOLATION", entity: "trade", entityId: v.tradeId, data: { rule: v.rule, detail: v.detail } });
  }
}

main();
