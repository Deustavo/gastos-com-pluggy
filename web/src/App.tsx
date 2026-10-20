import { useCallback, useState } from "react";
import type { OverrideRequest, TransactionRow } from "../../src/api/contract.ts";
import { api } from "./api.ts";
import { CategoryChart } from "./components/CategoryChart.tsx";
import { ConnectionsPanel } from "./components/ConnectionsPanel.tsx";
import { Header } from "./components/Header.tsx";
import { MonthlyChart } from "./components/MonthlyChart.tsx";
import { type RuleDraft, RulesPanel } from "./components/RulesPanel.tsx";
import { SummaryCards } from "./components/SummaryCards.tsx";
import { TransactionsTable, type TxFilters } from "./components/TransactionsTable.tsx";
import { currentMonth } from "./format.ts";
import { suggestRulePattern } from "./ruleSuggest.ts";
import { useAsync } from "./useAsync.ts";

export function App() {
  const [month, setMonth] = useState(currentMonth);
  // dataVersion: recarrega resumo, lista, categorias e regras (após editar); syncVersion: tudo, inclusive conexões
  const [dataVersion, setDataVersion] = useState(0);
  const [syncVersion, setSyncVersion] = useState(0);
  const [filters, setFilters] = useState<TxFilters>({
    category: undefined,
    account: undefined,
    status: "ALL",
    showNonExpense: false,
  });

  const summary = useAsync(() => api.summary(month), [month, dataVersion, syncVersion]);
  // A lista do mês vem inteira e é filtrada no cliente (resposta imediata aos filtros e ao clique no gráfico).
  const txs = useAsync(() => api.transactions({ month }), [month, dataVersion, syncVersion]);
  const cats = useAsync(() => api.categories(), [dataVersion, syncVersion]);
  const conns = useAsync(() => api.connections(), [syncVersion]);
  const rules = useAsync(() => api.rules(), [dataVersion, syncVersion]);
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | undefined>();

  const onOverride = useCallback(async (fingerprint: string, body: OverrideRequest) => {
    await api.override(fingerprint, body);
    setDataVersion((v) => v + 1);
  }, []);

  const onDataChanged = useCallback(() => setDataVersion((v) => v + 1), []);

  const onCreateRule = useCallback((row: TransactionRow) => {
    setRuleDraft((d) => ({
      pattern: suggestRulePattern(row.description),
      category: row.category === "Sem categoria" ? "" : row.category,
      nonce: (d?.nonce ?? 0) + 1,
    }));
    document.getElementById("regras")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const selectCategory = (category: string | undefined) => {
    setFilters((f) => ({ ...f, category }));
    if (category) document.getElementById("transacoes")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="app">
      <Header month={month} onMonthChange={setMonth} onSynced={() => setSyncVersion((v) => v + 1)} />
      <main>
        <SummaryCards summary={summary.data} loading={summary.loading} error={summary.error} />
        <div className="grid-2">
          <CategoryChart
            summary={summary.data}
            loading={summary.loading}
            error={summary.error}
            selected={filters.category}
            onSelect={selectCategory}
          />
          <MonthlyChart
            summary={summary.data}
            loading={summary.loading}
            error={summary.error}
            month={month}
            onSelect={setMonth}
          />
        </div>
        <div id="transacoes">
          <TransactionsTable
            rows={txs.data?.items}
            loading={txs.loading}
            error={txs.error}
            categories={cats.data?.categories ?? []}
            filters={filters}
            onFiltersChange={setFilters}
            onOverride={onOverride}
            rules={rules.data?.rules}
            onCreateRule={onCreateRule}
          />
        </div>
        <div id="regras">
          <RulesPanel
            rules={rules.data?.rules}
            loading={rules.loading}
            error={rules.error}
            categories={cats.data?.categories ?? []}
            draft={ruleDraft}
            onChanged={onDataChanged}
          />
        </div>
        <ConnectionsPanel data={conns.data} loading={conns.loading} error={conns.error} />
      </main>
    </div>
  );
}
