import { useMemo, useState } from "react";
import type { CategoryRule, OverrideRequest, TransactionRow } from "../../../src/api/contract.ts";
import { formatCents, formatDay, KIND_LABEL } from "../format.ts";
import { Panel } from "./Panel.tsx";

export type StatusFilter = "ALL" | "POSTED" | "PENDING";

export interface TxFilters {
  category: string | undefined;
  account: number | undefined;
  status: StatusFilter;
  showNonExpense: boolean;
}

interface Props {
  rows: TransactionRow[] | undefined;
  loading: boolean;
  error: string | undefined;
  categories: string[];
  filters: TxFilters;
  onFiltersChange: (f: TxFilters) => void;
  onOverride: (fingerprint: string, body: OverrideRequest) => Promise<void>;
  rules: CategoryRule[] | undefined; // para o tooltip da origem da categoria
  onCreateRule: (row: TransactionRow) => void;
}

// Kinds que não são gasto (ficam ocultos por padrão). refund fica visível: abate o gasto.
const NON_EXPENSE = new Set(["transfer", "card_payment", "income"]);

export function TransactionsTable({
  rows,
  loading,
  error,
  categories,
  filters,
  onFiltersChange,
  onOverride,
  rules,
  onCreateRule,
}: Props) {
  const all = useMemo(() => rows ?? [], [rows]);

  const rulesById = useMemo(() => new Map((rules ?? []).map((r) => [r.id, r])), [rules]);

  const accounts = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of all) m.set(r.accountId, r.accountLabel);
    if (filters.account !== undefined && !m.has(filters.account)) m.set(filters.account, `Conta #${filters.account}`);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [all, filters.account]);

  const filterCategories = useMemo(() => {
    const s = new Set(categories);
    for (const r of all) s.add(r.category);
    if (filters.category) s.add(filters.category);
    return [...s].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [all, categories, filters.category]);

  const visible = all.filter(
    (r) =>
      (filters.showNonExpense || !NON_EXPENSE.has(r.kind)) &&
      (!filters.category || r.category === filters.category) &&
      (filters.account === undefined || r.accountId === filters.account) &&
      (filters.status === "ALL" || r.status === filters.status),
  );
  const hiddenNonExpense = filters.showNonExpense ? 0 : all.filter((r) => NON_EXPENSE.has(r.kind)).length;
  const anyFilter = !!filters.category || filters.account !== undefined || filters.status !== "ALL";

  const set = (patch: Partial<TxFilters>) => onFiltersChange({ ...filters, ...patch });

  const toolbar = (
    <div className="filters">
      <label>
        Categoria
        <select value={filters.category ?? ""} onChange={(e) => set({ category: e.target.value || undefined })}>
          <option value="">Todas</option>
          {filterCategories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label>
        Conta
        <select
          value={filters.account ?? ""}
          onChange={(e) => set({ account: e.target.value ? Number(e.target.value) : undefined })}
        >
          <option value="">Todas</option>
          {accounts.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Status
        <select value={filters.status} onChange={(e) => set({ status: e.target.value as StatusFilter })}>
          <option value="ALL">Todas</option>
          <option value="POSTED">Confirmadas</option>
          <option value="PENDING">A confirmar</option>
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={filters.showNonExpense} onChange={(e) => set({ showNonExpense: e.target.checked })} />
        Mostrar transferências, faturas e receitas
      </label>
      {anyFilter && (
        <button
          type="button"
          className="link-btn"
          onClick={() => set({ category: undefined, account: undefined, status: "ALL" })}
        >
          limpar filtros
        </button>
      )}
    </div>
  );

  const emptyMsg = !rows
    ? false
    : all.length === 0
      ? "Nenhuma transação neste mês."
      : visible.length === 0
        ? "Nenhuma transação com esses filtros."
        : false;

  return (
    <Panel
      title="Transações do mês"
      className="panel-tx"
      loading={loading && !rows}
      refreshing={loading && !!rows}
      error={error}
      empty={emptyMsg}
      actions={
        rows && (
          <span className="muted small">
            {visible.length} de {all.length}
            {hiddenNonExpense > 0 && ` · ${hiddenNonExpense} ocultas (não são gasto)`}
          </span>
        )
      }
    >
      {rows && toolbar}
      {rows && visible.length > 0 && (
        <div className="table-wrap">
          <table className="tx-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Descrição</th>
                <th>Conta</th>
                <th>Categoria</th>
                <th className="num">Valor</th>
                <th className="center">Ignorar</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <TxRow
                  key={r.id}
                  row={r}
                  categories={categories}
                  rule={r.ruleId === null ? undefined : rulesById.get(r.ruleId)}
                  onOverride={onOverride}
                  onCreateRule={onCreateRule}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

const NEW = "__new__";
const RESET = "__reset__";
const RULE = "__rule__";

function TxRow({
  row,
  categories,
  rule,
  onOverride,
  onCreateRule,
}: {
  row: TransactionRow;
  categories: string[];
  rule: CategoryRule | undefined; // regra que casou (se a lista de regras estiver carregada)
  onOverride: (fingerprint: string, body: OverrideRequest) => Promise<void>;
  onCreateRule: (row: TransactionRow) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");

  const options = categories.includes(row.category) ? categories : [...categories, row.category].sort((a, b) => a.localeCompare(b, "pt-BR"));

  async function save(body: OverrideRequest) {
    setSaving(true);
    setErr(undefined);
    try {
      await onOverride(row.fingerprint, body);
      setCreating(false);
      setDraft("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function onSelect(value: string) {
    if (value === NEW) {
      setCreating(true);
      return;
    }
    if (value === RESET) return void save({ category: null });
    if (value === RULE) return onCreateRule(row);
    if (value !== row.category) void save({ category: value });
  }

  function submitNew() {
    const name = draft.trim();
    if (!name) return;
    void save({ category: name });
  }

  // Categoria automática (sem o override): a da regra que casou, senão a do fornecedor.
  // Se a regra casou mas a lista de regras não carregou, não dá para saber o nome.
  const autoCategory = row.ruleId !== null ? rule?.category : (row.providerCategory ?? "sem categoria");
  const source =
    row.categorySource === "override"
      ? {
          label: "manual",
          cls: "src-manual",
          title: `Categoria escolhida à mão${autoCategory ? ` (automática: ${autoCategory})` : ""}`,
        }
      : row.categorySource === "rule"
        ? { label: "regra", cls: "src-rule", title: rule ? `Regra: ${rule.pattern}` : "Categoria definida por uma regra" }
        : undefined;

  const amountClass = row.amountCents < 0 ? "neg" : row.amountCents > 0 ? "pos" : "";

  return (
    <tr className={`${row.ignored ? "ignored" : ""} ${saving ? "saving" : ""}`}>
      <td className="nowrap" data-label="Data">
        {formatDay(row.localDate)}
      </td>
      <td className="desc" data-label="Descrição">
        <span>{row.description}</span>
        <span className="badges">
          {row.installment && (
            <span className="badge" title="Parcela">
              {row.installment.number}/{row.installment.total}
            </span>
          )}
          {row.status === "PENDING" && <span className="badge badge-warn">a confirmar</span>}
          {row.kind !== "expense" && <span className={`badge badge-kind kind-${row.kind}`}>{KIND_LABEL[row.kind] ?? row.kind}</span>}
          {row.ignored && <span className="badge">ignorada</span>}
        </span>
        {row.note && <span className="note">{row.note}</span>}
      </td>
      <td className="nowrap" data-label="Conta">
        {row.accountLabel}
      </td>
      <td data-label="Categoria">
        {creating ? (
          <form
            className="new-cat"
            onSubmit={(e) => {
              e.preventDefault();
              submitNew();
            }}
          >
            <input
              autoFocus
              value={draft}
              placeholder="Nome da categoria"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
              disabled={saving}
              aria-label="Nova categoria"
            />
            <button type="submit" className="small-btn" disabled={saving || !draft.trim()}>
              OK
            </button>
            <button type="button" className="link-btn" onClick={() => setCreating(false)} disabled={saving}>
              cancelar
            </button>
          </form>
        ) : (
          <div className="cat-cell">
            <select
              className={`cat-select ${row.overridden ? "overridden" : ""}`}
              value={row.category}
              onChange={(e) => onSelect(e.target.value)}
              disabled={saving}
              title={source?.title}
              aria-label="Categoria"
            >
              {options.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value={NEW}>Nova categoria…</option>
              <option value={RULE}>Criar regra…</option>
              {row.overridden && (
                <option value={RESET}>Voltar à automática{autoCategory ? ` (${autoCategory})` : ""}</option>
              )}
            </select>
            <span className="src-slot">
              {source && (
                <span className={`src-badge ${source.cls}`} title={source.title}>
                  {source.label}
                </span>
              )}
            </span>
          </div>
        )}
        {err && <div className="row-error">{err}</div>}
      </td>
      <td className={`num nowrap ${amountClass}`} data-label="Valor">
        {formatCents(row.amountCents)}
      </td>
      <td className="center" data-label="Ignorar">
        <input
          type="checkbox"
          checked={row.ignored}
          disabled={saving}
          onChange={(e) => void save({ ignored: e.target.checked })}
          aria-label={row.ignored ? "Deixar de ignorar" : "Ignorar transação"}
          title="Ignorar nos totais"
        />
      </td>
    </tr>
  );
}
