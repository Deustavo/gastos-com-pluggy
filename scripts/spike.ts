// Fase 0: valida se os dados do Inter (conta + cartão) chegam completos via MeuPluggy.
// Imprime um resumo e salva o JSON bruto em data/raw/ (só leitura do seu usuário)
// para desenharmos o schema do banco local a partir de dados reais.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PluggyClient, type PluggyTransaction } from "../src/providers/pluggy/client.ts";

// Open Finance entrega até 12 meses de histórico.
const HISTORY_DAYS = 365;
const RAW_DIR = "data/raw";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Variável ${name} não definida. Copie .env.example para .env e preencha.`);
    process.exit(1);
  }
  return value;
}

function pct(part: number, total: number): string {
  return total === 0 ? "-" : `${Math.round((part / total) * 100)}%`;
}

function countBy<T>(items: T[], key: (item: T) => string | null | undefined): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item) ?? "(vazio)";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, n]) => `${k}=${n}`)
    .join(", ");
}

function maskNumber(n?: string): string {
  return n ? `••••${n.slice(-4)}` : "-";
}

async function saveRaw(path: string, data: unknown): Promise<void> {
  const file = join(RAW_DIR, path);
  await mkdir(join(file, ".."), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function summarizeTransactions(txs: PluggyTransaction[], isCredit: boolean): void {
  if (txs.length === 0) {
    console.log("      nenhuma transação no período");
    return;
  }
  const dates = txs.map((t) => t.date).sort();
  console.log(`      ${txs.length} transações, de ${dates[0]?.slice(0, 10)} a ${dates.at(-1)?.slice(0, 10)}`);
  console.log(`      status: ${countBy(txs, (t) => t.status)}`);
  console.log(`      type: ${countBy(txs, (t) => t.type)}`);
  console.log(`      operationType: ${countBy(txs, (t) => t.operationType)}`);
  console.log(`      com providerId (chave estável p/ dedupe): ${pct(txs.filter((t) => t.providerId).length, txs.length)}`);
  console.log(`      com category: ${pct(txs.filter((t) => t.category).length, txs.length)}`);
  if (isCredit) {
    const withBill = txs.filter((t) => t.creditCardMetadata?.billId).length;
    const installments = txs.filter((t) => (t.creditCardMetadata?.totalInstallments ?? 1) > 1).length;
    console.log(`      com billId: ${pct(withBill, txs.length)} | parceladas: ${installments}`);
  }
  console.log("      amostra:");
  for (const t of txs.slice(-5)) {
    console.log(`        ${t.date.slice(0, 10)}  ${t.amount.toFixed(2).padStart(10)}  ${t.description}  [${t.category ?? "-"}]`);
  }
}

async function main(): Promise<void> {
  const client = new PluggyClient(requireEnv("PLUGGY_CLIENT_ID"), requireEnv("PLUGGY_CLIENT_SECRET"));
  const itemIds = requireEnv("PLUGGY_ITEM_IDS").split(",").map((s) => s.trim()).filter(Boolean);
  const dateFrom = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000);

  for (const itemId of itemIds) {
    const item = await client.getItem(itemId);
    await saveRaw(`${itemId}/item.json`, item);

    console.log(`\n=== Item ${itemId}`);
    console.log(`  conector: ${item.connector?.name} (isOpenFinance=${item.connector?.isOpenFinance})`);
    console.log(`  status: ${item.status} / ${item.executionStatus}${item.error ? ` erro=${item.error.code}` : ""}`);
    console.log(`  última atualização: ${item.lastUpdatedAt ?? "-"}`);
    console.log(`  autorização expira em: ${item.consentExpiresAt ?? "-"}`);
    console.log(`  produtos: ${item.products?.join(", ") ?? "-"}`);

    const accounts = await client.listAccounts(itemId);
    await saveRaw(`${itemId}/accounts.json`, accounts);

    for (const account of accounts) {
      const isCredit = account.type === "CREDIT";
      console.log(`\n  -- ${account.type}/${account.subtype}: ${account.marketingName ?? account.name} ${maskNumber(account.number)}`);
      console.log(`      saldo: ${account.balance} ${account.currencyCode}`);

      const txs: PluggyTransaction[] = [];
      for await (const t of client.listTransactions(account.id, { dateFrom })) txs.push(t);
      await saveRaw(`${itemId}/transactions-${account.id}.json`, txs);
      summarizeTransactions(txs, isCredit);

      if (isCredit) {
        const bills = await client.listBills(account.id);
        await saveRaw(`${itemId}/bills-${account.id}.json`, bills);
        console.log(`      faturas: ${bills.length}`);
        for (const b of bills.slice(-3)) {
          console.log(`        vence ${b.dueDate.slice(0, 10)}  total ${b.totalAmount} ${b.totalAmountCurrencyCode}`);
        }
      }
    }
  }

  console.log(`\nJSON bruto salvo em ${RAW_DIR}/ (contém dados financeiros, não compartilhe).`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
