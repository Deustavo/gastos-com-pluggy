import type { TransactionRow } from "../../src/api/contract.ts";
import { formatCents, formatDay, formatMonthLong, NATURE_LABEL } from "./format.ts";

// Exporta os gastos do mês em texto puro, com as mesmas regras do resumo:
// gasto = Σ expense − Σ refund, sem ignoradas; PENDING fica fora do total, listado à parte.

const DESC_WIDTH = 40;
const CAT_WIDTH = 22;

// Valor do ponto de vista do gasto: compra positiva, estorno negativo.
const spent = (r: TransactionRow) => -r.amountCents;

function fit(text: string, width: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > width ? `${clean.slice(0, width - 1)}…` : clean.padEnd(width);
}

function line(r: TransactionRow, moneyWidth: number): string {
  const desc = r.installment ? `${r.description} (${r.installment.number}/${r.installment.total})` : r.description;
  const tags = [r.nature ? NATURE_LABEL[r.nature] : null, r.kind === "refund" ? "estorno" : null].filter(Boolean);
  return [
    formatDay(r.localDate),
    fit(desc, DESC_WIDTH),
    fit(r.category, CAT_WIDTH),
    formatCents(spent(r)).padStart(moneyWidth),
    r.accountLabel,
    tags.length ? `[${tags.join(", ")}]` : "",
  ]
    .join("  ")
    .trimEnd();
}

const count = (n: number) => `${n} ${n === 1 ? "lançamento" : "lançamentos"}`;

export function buildExpensesTxt(month: string, rows: TransactionRow[], generatedAt: string): string {
  const expenses = rows
    .filter((r) => (r.kind === "expense" || r.kind === "refund") && !r.ignored)
    .sort((a, b) => a.localDate.localeCompare(b.localDate) || a.id - b.id);
  const posted = expenses.filter((r) => r.status === "POSTED");
  const pending = expenses.filter((r) => r.status === "PENDING");

  const sum = (list: TransactionRow[]) => list.reduce((n, r) => n + spent(r), 0);
  const total = sum(posted);
  const fixed = sum(posted.filter((r) => r.nature === "fixed"));

  const byCategory = new Map<string, number>();
  for (const r of posted) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + spent(r));
  const categories = [...byCategory].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));

  const moneyWidth = Math.max(0, ...[total, ...expenses.map(spent), ...byCategory.values()].map((c) => formatCents(c).length));
  const catWidth = Math.max(0, ...categories.map(([c]) => c.length));

  const out = [
    `Gastos de ${formatMonthLong(month)}`,
    `Gerado em ${generatedAt}`,
    "",
    `Total:     ${formatCents(total)}  (${count(posted.length)})`,
    `Fixo:      ${formatCents(fixed)}`,
    `Variável:  ${formatCents(total - fixed)}`,
  ];
  if (pending.length) out.push(`A confirmar (fora do total): ${formatCents(sum(pending))}  (${count(pending.length)})`);

  out.push("", "POR CATEGORIA", "");
  for (const [c, cents] of categories) out.push(`${c.padEnd(catWidth)}  ${formatCents(cents).padStart(moneyWidth)}`);
  if (!categories.length) out.push("Nenhum gasto confirmado.");

  out.push("", "LANÇAMENTOS", "");
  for (const r of posted) out.push(line(r, moneyWidth));
  if (!posted.length) out.push("Nenhum gasto confirmado.");

  if (pending.length) {
    out.push("", "A CONFIRMAR", "");
    for (const r of pending) out.push(line(r, moneyWidth));
  }

  return `${out.join("\n")}\n`;
}

export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
