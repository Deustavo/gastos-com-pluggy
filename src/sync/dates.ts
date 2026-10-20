// Datas: o app agrupa por dia local de São Paulo; o fornecedor manda ISO UTC.

const TZ = "America/Sao_Paulo";
const DAY_MS = 86_400_000;

// en-CA já formata como YYYY-MM-DD
const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function toLocalDate(isoUtc: string): string {
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) throw new Error(`data inválida: ${isoUtc}`);
  return fmt.format(d);
}

function parseLocal(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`esperado YYYY-MM-DD: ${s}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// Diferença absoluta em dias entre duas datas YYYY-MM-DD (via UTC, sem DST)
export function daysBetween(a: string, b: string): number {
  return Math.abs(Math.round((parseLocal(a) - parseLocal(b)) / DAY_MS));
}
