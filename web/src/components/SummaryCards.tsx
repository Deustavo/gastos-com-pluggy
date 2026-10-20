import type { SummaryResponse } from "../../../src/api/contract.ts";
import { formatCents } from "../format.ts";

interface Props {
  summary: SummaryResponse | undefined;
  loading: boolean;
  error: string | undefined;
}

export function SummaryCards({ summary, loading, error }: Props) {
  const value = (fn: (s: SummaryResponse) => string) =>
    summary ? fn(summary) : loading ? "…" : error ? "—" : "—";
  return (
    <div className={`cards ${loading && summary ? "is-refreshing" : ""}`} aria-busy={loading}>
      {error && !summary && <div className="state state-error card-error">Erro ao carregar o resumo: {error}</div>}
      <div className="card">
        <div className="card-label">Gasto do mês</div>
        <div className="card-value">{value((s) => formatCents(s.expenseCents))}</div>
        <div className="card-sub">confirmado, sem transferências nem faturas</div>
      </div>
      <div className="card">
        <div className="card-label">Receita do mês</div>
        <div className="card-value">{value((s) => formatCents(s.incomeCents))}</div>
        <div className="card-sub">entradas confirmadas</div>
      </div>
      <div className="card card-pending">
        <div className="card-label">A confirmar</div>
        <div className="card-value">{value((s) => formatCents(s.pendingExpenseCents))}</div>
        <div className="card-sub">
          {summary
            ? summary.pendingCount === 0
              ? "nenhuma transação pendente"
              : `${summary.pendingCount} ${summary.pendingCount === 1 ? "transação pendente" : "transações pendentes"}`
            : " "}
        </div>
      </div>
    </div>
  );
}
