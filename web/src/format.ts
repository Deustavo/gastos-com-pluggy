// Formatação pt-BR: moeda a partir de centavos, datas dd/mm/aaaa, meses "out/26".

import type { Nature } from "../../src/api/contract.ts";

const TZ = "America/Sao_Paulo";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlCompact = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCents(cents: number): string {
  return brl.format(cents / 100);
}

export function formatCentsCompact(cents: number): string {
  return brlCompact.format(cents / 100);
}

// "2026-10-05" → "05/10/2026"
export function formatDay(day: string): string {
  const [y, m, d] = day.split("-");
  return y && m && d ? `${d}/${m}/${y}` : day;
}

// ISO com hora → "05/10/2026 14:32" no fuso de São Paulo
const dateTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateTime.format(d);
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS_LONG = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function parseMonth(month: string): { y: number; m: number } {
  const [y, m] = month.split("-").map(Number);
  return { y: y ?? 1970, m: m ?? 1 };
}

// "2026-10" → "out/26"
export function formatMonthShort(month: string): string {
  const { y, m } = parseMonth(month);
  return `${MONTHS[m - 1] ?? "?"}/${String(y).slice(-2)}`;
}

// "2026-10" → "Outubro de 2026"
export function formatMonthLong(month: string): string {
  const { y, m } = parseMonth(month);
  const name = MONTHS_LONG[m - 1] ?? "?";
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${y}`;
}

export function addMonths(month: string, delta: number): string {
  const { y, m } = parseMonth(month);
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

// Mês corrente em America/Sao_Paulo, "YYYY-MM"
export function currentMonth(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).formatToParts(
    new Date(),
  );
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${y}-${m}`;
}

export const NATURE_LABEL: Record<Nature, string> = {
  fixed: "Fixo",
  variable: "Variável",
};

export const KIND_LABEL: Record<string, string> = {
  expense: "gasto",
  income: "receita",
  transfer: "transferência",
  card_payment: "pagamento de fatura",
  refund: "estorno",
};
