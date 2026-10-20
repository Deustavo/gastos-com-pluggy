// Fase 1 (`npm run sync`): sincroniza as conexões da Pluggy para data/app.db
// e imprime um resumo só com agregados (nunca descrições, valores ou ids de transação).

import { setupProviders } from "../src/config.ts";
import { openDb } from "../src/db/index.ts";
import { SyncService, type SyncReport } from "../src/sync/sync.ts";

function printReport(r: SyncReport): void {
  console.log(`Sync ${r.startedAt} (janela desde ${r.windowFrom.slice(0, 10)})`);
  for (const c of r.connections) {
    const consent = c.daysToConsentExpiry === undefined ? "-" : `${c.daysToConsentExpiry} dias`;
    console.log(`\n=== Conexão ${c.connectionId} (${c.provider}): ${c.status}, consentimento expira em ${consent}`);
    if (c.error) console.log(`  erro: ${c.error}`);
    for (const a of c.accounts) {
      const kinds = Object.entries(a.byKind).map(([k, n]) => `${k}=${n}`).join(", ") || "-";
      console.log(
        `  -- ${a.type}/${a.subtype} ••••${a.numberLast4 ?? "----"}: ${a.totalTx} transações no banco` +
          ` (${a.fetchedTx} buscadas, ${a.pendingTx} pendentes), ${a.fetchedBills} faturas`,
      );
      console.log(`      kind: ${kinds}`);
    }
  }

  console.log("\n=== Integridade (compras × fatura)");
  if (r.integrity.length === 0) console.log("  nenhuma conta de cartão sincronizada");
  for (const i of r.integrity) {
    console.log(`  conta ${i.accountId}: ok=${i.ok} mismatch=${i.mismatch} out_of_window=${i.outOfWindow}`);
    for (const m of i.mismatches) console.log(`    fatura ${m.billId}: diferença ${m.diffCents} centavos`);
  }

  console.log(`\nOverrides: ${r.overrides.matched} aplicados, ${r.overrides.orphaned} órfãos`);
  console.log(r.alerts.length ? `Alertas:\n${r.alerts.map((a) => `  ! ${a}`).join("\n")}` : "Alertas: nenhum");
}

async function main(): Promise<void> {
  const db = openDb();
  try {
    const report = await new SyncService(db, setupProviders(db)).run();
    printReport(report);
    if (report.connections.some((c) => c.status === "error")) process.exitCode = 1;
  } finally {
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
