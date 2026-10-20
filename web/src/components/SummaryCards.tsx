import type { SummaryResponse } from "../../../src/api/contract.ts";
import { useMoney } from "../privacy.ts";
import { Icon } from "./Icon.tsx";

interface Props {
  summary: SummaryResponse | undefined;
  loading: boolean;
  error: string | undefined;
}

export function SummaryCards({ summary, loading, error }: Props) {
  const money = useMoney();
  const value = (fn: (s: SummaryResponse) => string) =>
    summary ? fn(summary) : loading ? "…" : error ? "—" : "—";
  return (
    <div className={`cards ${loading && summary ? "is-refreshing" : ""}`} aria-busy={loading}>
      {error && !summary && <div className="state state-error card-error">Erro ao carregar o resumo: {error}</div>}
      <div className="card card-expense">
        <div className="card-label">
          <span className="card-icon">
            <Icon name="trendingDown" />
          </span>
          Gasto do mês
        </div>
        <div className="card-value">{value((s) => money.cents(s.expenseCents))}</div>
        <div className="card-sub" title="Confirmado, sem transferências nem faturas">
          {summary
            ? `fixo ${money.cents(summary.fixedExpenseCents)} · variável ${money.cents(summary.expenseCents - summary.fixedExpenseCents)}`
            : "confirmado, sem transferências nem faturas"}
        </div>
      </div>
      <div className="card card-income">
        <div className="card-label">
          <span className="card-icon">
            <Icon name="trendingUp" />
          </span>
          Receita do mês
        </div>
        <div className="card-value">{value((s) => money.cents(s.incomeCents))}</div>
        <div className="card-sub">entradas confirmadas</div>
      </div>
      <div className="card card-pending">
        <div className="card-label">
          <span className="card-icon">
            <Icon name="clock" />
          </span>
          A confirmar
        </div>
        <div className="card-value">{value((s) => money.cents(s.pendingExpenseCents))}</div>
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
