// Contrato HTTP entre a API local (Hono) e o dashboard (React).
// Só tipos: o front importa com `import type`, sem puxar código do servidor.
// Valores em centavos; meses em "YYYY-MM" e dias em "YYYY-MM-DD" (America/Sao_Paulo).

import type { Nature } from "../categorize/nature.ts";
import type { Kind } from "../sync/classify.ts";
import type { SyncReport } from "../sync/sync.ts";

export type { Kind, Nature, SyncReport };

// Regras de "gasto" usadas em todo o dashboard:
// gasto = Σ expense (OUT) − Σ refund (IN), ignorando linhas com ignored = true.
// card_payment e transfer nunca entram. PENDING fica fora dos totais e aparece à parte.

// GET /api/summary?month=YYYY-MM (padrão: mês atual)
export interface SummaryResponse {
  month: string;
  expenseCents: number;
  fixedExpenseCents: number; // parte do gasto marcada como fixa; o resto (expenseCents − fixed) é variável
  incomeCents: number;
  pendingExpenseCents: number; // gasto PENDING do mês ("a confirmar")
  pendingCount: number;
  byCategory: { category: string; expenseCents: number }[]; // desc; refund abate da própria categoria
  monthly: { month: string; expenseCents: number; incomeCents: number }[]; // jan–dez do ano de `month`, asc, meses sem dado = 0
}

export type Bank = "nubank" | "inter";

// GET /api/transactions?month=&category=&account=&status=&kind=
// month obrigatório; os outros filtros são opcionais (account = id numérico; status = POSTED|PENDING).
export interface TransactionRow {
  id: number;
  fingerprint: string;
  accountId: number;
  accountLabel: string; // ex.: "Cartão ••••1234"
  bank: Bank | null; // banco da conexão (o cartão herda o da conta); null se não reconhecido
  localDate: string;
  description: string;
  amountCents: number; // assinado do ponto de vista do dono: OUT negativo, IN positivo
  kind: Kind;
  status: "POSTED" | "PENDING";
  category: string; // efetiva (override > regra > fornecedor em pt-BR); "Sem categoria" se vazia
  categorySource: CategorySource;
  ruleId: number | null; // regra que casou (mesmo quando um override a sobrepõe)
  providerCategory: string | null; // categoria do fornecedor já traduzida para pt-BR
  overridden: boolean; // tem categoria própria
  ignored: boolean;
  note: string | null;
  installment: { number: number; total: number } | null;
  // Fixo/variável: só para expense e refund (null nos outros kinds)
  nature: Nature | null;
  natureSource: NatureSource | null;
  autoNature: Nature | null; // o que valeria sem a marcação manual
}
export interface TransactionsResponse {
  items: TransactionRow[]; // local_date desc
}

// GET /api/categories → categorias efetivas distintas, ordem alfabética
export interface CategoriesResponse {
  categories: string[];
}

// GET /api/connections
export interface ConnectionHealth {
  id: number;
  provider: string;
  nickname: string | null;
  providerStatus: string | null; // último status do fornecedor (ex.: UPDATED)
  lastUpdatedAt: string | null; // última atualização do fornecedor (ISO)
  consentExpiresAt: string | null; // ISO
  daysToConsentExpiry: number | null;
  lastRun: { status: string; startedAt: string; finishedAt: string | null; error: string | null } | null;
  accounts: {
    id: number;
    type: "BANK" | "CREDIT";
    subtype: string | null;
    name: string | null;
    numberLast4: string | null;
    balanceCents: number | null;
  }[];
}
export interface ConnectionsResponse {
  connections: ConnectionHealth[];
}

// PATCH /api/overrides/:fingerprint — campos ausentes ficam como estão;
// category null volta à categoria automática (regra ou fornecedor). 404 se o fingerprint não existir em transactions.
export interface OverrideRequest {
  category?: string | null;
  ignored?: boolean;
  note?: string | null;
}
export interface OverrideResponse {
  fingerprint: string;
  category: string | null;
  ignored: boolean;
  note: string | null;
}

// De onde veio a natureza: marcação manual, detecção automática (repete todo mês com valor
// parecido, ou é parcela) ou o padrão (variável).
export type NatureSource = "manual" | "detected" | "default";

// PATCH /api/natures/:fingerprint — marca o estabelecimento da transação (a chave de recorrência,
// ex.: "Amazon Ad Free For Pri" e "AMAZON AD FREE FOR PRI SAO PAULO     BRA" são a mesma), não só a linha: vale para todos os
// meses, inclusive os que ainda vão sincronizar. nature null apaga a marcação (volta à detecção).
// 404 se o fingerprint não existir; 400 se a transação não for gasto/estorno ou não tiver chave.
export interface NatureRequest {
  nature: Nature | null;
}
export interface NatureResponse {
  recurrenceKey: string;
  nature: Nature | null; // marcação gravada
  matchCount: number; // transações com a mesma chave
}

// PATCH /api/natures/by-key/:recurrenceKey → NatureResponse. Mesmo efeito do PATCH por fingerprint,
// para marcar um estabelecimento sem passar por uma transação. 404 se nenhum gasto/estorno tiver a chave.

// GET /api/natures → um item por estabelecimento (chave de recorrência) com pelo menos um gasto,
// para gerenciar os gastos fixos. Desconsidera transações ignoradas; PENDING entra (mostra que já veio no mês).
export interface NatureEntry {
  recurrenceKey: string;
  description: string; // da transação mais recente
  category: string; // efetiva, da transação mais recente
  nature: Nature; // marcação manual > detecção > variável
  natureSource: NatureSource;
  autoNature: Nature; // o que valeria sem a marcação manual
  installment: { number: number; total: number } | null; // da transação mais recente, se for parcela
  lastDate: string;
  typicalCents: number; // mediana dos totais mensais (gasto − estorno)
  months: { month: string; amountCents: number }[]; // meses em que apareceu, asc
  txCount: number;
}
export interface NaturesResponse {
  items: NatureEntry[]; // lastDate desc
}

// POST /api/sync → roda o mesmo SyncService do `npm run sync`.
// 409 se já houver um sync em andamento.
export type SyncResponse = SyncReport;

// De onde veio a categoria efetiva. "none" = sem categoria.
export type CategorySource = "override" | "rule" | "provider" | "none";

// Regras locais de categorização (fase 3). A primeira regra habilitada que casar,
// em ordem de `priority` asc (empate: id asc), define a categoria. O padrão é uma
// regex JS testada com flag "i" contra a descrição; acentos são ignorados dos dois lados.
// A regra só muda a categoria exibida; o `kind` continua vindo da categoria do fornecedor.
export interface CategoryRule {
  id: number;
  pattern: string;
  category: string;
  priority: number;
  enabled: boolean;
  matchCount: number; // transações que esta regra categoriza hoje (já descontando regras anteriores)
  createdAt: string;
}

// GET /api/rules
export interface RulesResponse {
  rules: CategoryRule[]; // ordem de aplicação
}

// POST /api/rules → 201 CategoryRule. priority ausente = vai para o fim.
// 400 se a regex for inválida, pattern vazio/> 200 caracteres ou category vazia/> 60.
export interface RuleCreateRequest {
  pattern: string;
  category: string;
  priority?: number;
  enabled?: boolean;
}

// PATCH /api/rules/:id → CategoryRule (campos ausentes ficam como estão). DELETE /api/rules/:id → 204.
export type RuleUpdateRequest = Partial<RuleCreateRequest>;

// POST /api/rules/reorder → RulesResponse. `ids` deve conter todas as regras, na nova ordem.
export interface RuleReorderRequest {
  ids: number[];
}

// POST /api/rules/preview: testa um padrão sem salvar. `excludeRuleId` ignora a própria
// regra ao editar. Conta todas as transações do banco (não só um mês).
export interface RulePreviewRequest {
  pattern: string;
  excludeRuleId?: number;
}
export interface RulePreviewResponse {
  matchCount: number;
  sample: { localDate: string; description: string; amountCents: number; currentCategory: string }[]; // até 20, mais recentes
}

export interface ApiError {
  error: string;
}
