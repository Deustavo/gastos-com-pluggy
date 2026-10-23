import { test } from "node:test";
import assert from "node:assert/strict";
import type { TransactionRow } from "../src/api/contract.ts";
import { buildExpensesTxt } from "../web/src/exportTxt.ts";

// Transações sintéticas
let nextId = 1;
const tx = (patch: Partial<TransactionRow>): TransactionRow => ({
  id: nextId++,
  fingerprint: `fp${nextId}`,
  accountId: 1,
  accountLabel: "Cartão ••••0000",
  bank: null,
  localDate: "2026-10-05",
  description: "LOJA TESTE",
  amountCents: -1000,
  kind: "expense",
  status: "POSTED",
  category: "Compras",
  categorySource: "provider",
  ruleId: null,
  providerCategory: "Compras",
  overridden: false,
  ignored: false,
  note: null,
  installment: null,
  nature: "variable",
  natureSource: "default",
  autoNature: "variable",
  ...patch,
});

const norm = (s: string) => s.replace(/ /g, " ");

test("buildExpensesTxt soma gasto − estorno e deixa ignoradas, pendentes e não-gastos fora do total", () => {
  const rows = [
    tx({ amountCents: -5000, category: "Mercado", nature: "fixed" }),
    tx({ amountCents: -2000, category: "Compras" }),
    tx({ amountCents: 500, kind: "refund", category: "Compras", description: "ESTORNO TESTE" }),
    tx({ amountCents: -9900, ignored: true, description: "IGNORADA" }),
    tx({ amountCents: -300, status: "PENDING", description: "PENDENTE" }),
    tx({ amountCents: 100000, kind: "income", description: "SALARIO" }),
    tx({ amountCents: -40000, kind: "card_payment", description: "PAGTO FATURA" }),
  ];
  const txt = norm(buildExpensesTxt("2026-10", rows, "23/10/2026 10:00"));

  assert.match(txt, /^Gastos de Outubro de 2026\n/);
  assert.match(txt, /Total: +R\$ 65,00 +\(3 lançamentos\)/);
  assert.match(txt, /Fixo: +R\$ 50,00/);
  assert.match(txt, /Variável: +R\$ 15,00/);
  assert.match(txt, /A confirmar \(fora do total\): R\$ 3,00/);
  assert.match(txt, /Mercado +R\$ 50,00\nCompras +R\$ 15,00/);
  assert.match(txt, /ESTORNO TESTE.*-R\$ 5,00.*\[Variável, estorno\]/);
  for (const absent of ["IGNORADA", "SALARIO", "PAGTO FATURA"]) assert.ok(!txt.includes(absent), absent);
  assert.match(txt, /A CONFIRMAR\n\n.*PENDENTE/);
});

test("buildExpensesTxt com mês sem gastos", () => {
  const txt = buildExpensesTxt("2026-01", [], "01/02/2026 00:00");
  assert.match(norm(txt), /Total: +R\$ 0,00 +\(0 lançamentos\)/);
  assert.ok(!txt.includes("A CONFIRMAR"));
});
