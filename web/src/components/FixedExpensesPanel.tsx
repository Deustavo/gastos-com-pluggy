import { useMemo, useState } from "react";
import type { Nature, NatureEntry } from "../../../src/api/contract.ts";
import { api } from "../api.ts";
import { addMonths, currentMonth, formatCents, formatDay, formatMonthLong, formatMonthShort } from "../format.ts";
import { useMoney } from "../privacy.ts";
import { Icon } from "./Icon.tsx";
import { Panel } from "./Panel.tsx";

interface Props {
  entries: NatureEntry[] | undefined;
  loading: boolean;
  error: string | undefined;
  month: string; // mês do dashboard: mostra o que já foi lançado nele
  onChanged: () => void; // recarrega lista, resumo e transações
}

type SourceFilter = "all" | "detected" | "manual";

// Sem lançamento em nenhum destes meses antes do selecionado = parado (assinatura cancelada,
// parcelas encerradas); sai da conta do "ainda não apareceu".
const STALE_MONTHS = 3;
const HISTORY_MONTHS = 6;
const MAX_CANDIDATES = 10;

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? one : many}`;
}

// Status do estabelecimento no mês: lançado, esperado, parado ou ainda não existia.
type MonthStatus =
  | { kind: "posted"; cents: number }
  | { kind: "expected" }
  | { kind: "stale"; since: string }
  | { kind: "ended" }
  | { kind: "later"; from: string };

function monthStatus(e: NatureEntry, month: string): MonthStatus {
  const hit = e.months.find((m) => m.month === month);
  if (hit) return { kind: "posted", cents: hit.amountCents };
  const first = e.months[0]?.month ?? month;
  if (first > month) return { kind: "later", from: first };
  const before = e.months.filter((m) => m.month < month);
  const lastBefore = before[before.length - 1]?.month;
  if (!lastBefore) return { kind: "later", from: first };
  if (e.installment && e.installment.number >= e.installment.total && e.lastDate.slice(0, 7) < month) return { kind: "ended" };
  if (lastBefore < addMonths(month, -STALE_MONTHS)) return { kind: "stale", since: lastBefore };
  return { kind: "expected" };
}

// Marcação que leva à natureza pedida: apaga a manual quando a detecção já chega lá.
const markFor = (e: NatureEntry, target: Nature): Nature | null => (e.autoNature === target ? null : target);

export function FixedExpensesPanel({ entries, loading, error, month, onChanged }: Props) {
  const money = useMoney();
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | undefined>();

  const all = useMemo(() => entries ?? [], [entries]);
  const fixed = useMemo(
    () => all.filter((e) => e.nature === "fixed").sort((a, b) => b.typicalCents - a.typicalCents),
    [all],
  );
  const markedVariable = useMemo(() => all.filter((e) => e.nature === "variable" && e.natureSource === "manual"), [all]);
  const candidates = useMemo(() => {
    const q = fold(query.trim());
    return all
      .filter((e) => e.nature === "variable" && (!q || fold(`${e.description} ${e.category}`).includes(q)))
      .slice(0, MAX_CANDIDATES);
  }, [all, query]);

  const statuses = useMemo(() => new Map(fixed.map((e) => [e.recurrenceKey, monthStatus(e, month)])), [fixed, month]);
  const active = fixed.filter((e) => {
    const k = statuses.get(e.recurrenceKey)?.kind;
    return k === "posted" || k === "expected";
  });
  const typicalTotal = active.reduce((n, e) => n + e.typicalCents, 0);
  const postedTotal = fixed.reduce((n, e) => {
    const s = statuses.get(e.recurrenceKey);
    return s?.kind === "posted" ? n + s.cents : n;
  }, 0);
  const expected = active.filter((e) => statuses.get(e.recurrenceKey)?.kind === "expected");
  const expectedTotal = expected.reduce((n, e) => n + e.typicalCents, 0);

  const counts = {
    all: fixed.length,
    detected: fixed.filter((e) => e.natureSource === "detected").length,
    manual: fixed.filter((e) => e.natureSource === "manual").length,
  };
  const shown = filter === "all" ? fixed : fixed.filter((e) => e.natureSource === filter);
  const isCurrent = month === currentMonth();

  async function mark(e: NatureEntry, target: Nature) {
    setBusyKey(e.recurrenceKey);
    setActionErr(undefined);
    try {
      await api.natureByKey(e.recurrenceKey, { nature: markFor(e, target) });
      onChanged();
    } catch (err) {
      setActionErr(errMsg(err));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Panel
      title="Gerenciar gastos fixos"
      icon="calendar"
      className="panel-fixed"
      loading={loading && !entries}
      refreshing={(loading && !!entries) || busyKey !== null}
      error={error}
      actions={
        entries &&
        !adding && (
          <button type="button" className="small-btn" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} /> Adicionar
          </button>
        )
      }
    >
      {entries && (
        <>
          <p className="hint">
            Fixo vale para o estabelecimento em todos os meses, inclusive os próximos. A detecção marca sozinha o que se
            repete todo mês com valor parecido e as parcelas; aqui você confirma, tira ou acrescenta.
          </p>
          {actionErr && <div className="state state-error inline">{actionErr}</div>}

          {adding && (
            <div className="fx-add" onKeyDown={(e) => e.key === "Escape" && setAdding(false)}>
              <div className="fx-add-head">
                <label className="grow">
                  Buscar estabelecimento
                  <input
                    type="text"
                    value={query}
                    autoFocus
                    autoComplete="off"
                    placeholder="ex.: academia, aluguel, escola"
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <button type="button" className="link-btn" onClick={() => setAdding(false)}>
                  fechar
                </button>
              </div>
              {candidates.length === 0 ? (
                <div className="muted small">Nenhum gasto variável com esse nome.</div>
              ) : (
                <ul className="fx-list">
                  {candidates.map((e) => (
                    <li key={e.recurrenceKey} className="fx-row compact">
                      <EntryName entry={e} />
                      <span className="muted small nowrap">último {formatDay(e.lastDate)}</span>
                      <span className="num nowrap">{money.cents(e.typicalCents)}</span>
                      <button
                        type="button"
                        className="small-btn"
                        disabled={busyKey !== null}
                        onClick={() => void mark(e, "fixed")}
                      >
                        <Icon name="plus" size={12} /> fixo
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {fixed.length === 0 ? (
            <div className="state state-empty">Nenhum gasto fixo ainda. Use “Adicionar” ou marque na lista de transações.</div>
          ) : (
            <>
              <div className="fx-summary">
                <div>
                  <span className="muted small">Típico por mês</span>
                  <strong>{money.cents(typicalTotal)}</strong>
                  <span className="muted small">{plural(active.length, "gasto ativo", "gastos ativos")}</span>
                </div>
                <div>
                  <span className="muted small">Lançado em {formatMonthLong(month).toLowerCase()}</span>
                  <strong>{money.cents(postedTotal)}</strong>
                  <span className="muted small">{plural(active.length - expected.length, "gasto", "gastos")}</span>
                </div>
                <div>
                  <span className="muted small">{isCurrent ? "Ainda não apareceu" : "Não apareceu no mês"}</span>
                  <strong>{money.cents(expectedTotal)}</strong>
                  <span className="muted small">{plural(expected.length, "gasto", "gastos")}</span>
                </div>
              </div>

              <div className="fx-filters" role="group" aria-label="Origem">
                {(
                  [
                    ["all", "Todos"],
                    ["detected", "Detectados"],
                    ["manual", "Marcados à mão"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`chip ${filter === value ? "active" : ""}`}
                    onClick={() => setFilter(value)}
                    aria-pressed={filter === value}
                  >
                    {label} <span className="muted">{counts[value]}</span>
                  </button>
                ))}
              </div>

              <ul className="fx-list">
                {shown.map((e) => (
                  <FixedRow
                    key={e.recurrenceKey}
                    entry={e}
                    month={month}
                    status={statuses.get(e.recurrenceKey)!}
                    isCurrent={isCurrent}
                    busy={busyKey !== null}
                    onUnfix={() => void mark(e, "variable")}
                  />
                ))}
              </ul>
            </>
          )}

          {markedVariable.length > 0 && (
            <details className="fx-variable">
              <summary>
                Marcados como variável <span className="muted">({markedVariable.length})</span>
              </summary>
              <p className="hint">Estabelecimentos que você tirou dos fixos. Desfazer volta à detecção automática.</p>
              <ul className="fx-list">
                {markedVariable.map((e) => (
                  <li key={e.recurrenceKey} className="fx-row compact">
                    <EntryName entry={e} />
                    <span className="muted small nowrap">
                      {e.autoNature === "fixed" ? "detecção diria fixo" : `último ${formatDay(e.lastDate)}`}
                    </span>
                    <span className="num nowrap">{money.cents(e.typicalCents)}</span>
                    <button
                      type="button"
                      className="link-btn"
                      disabled={busyKey !== null}
                      onClick={() => void mark(e, "fixed")}
                    >
                      {e.autoNature === "fixed" ? "desfazer" : "voltar a fixo"}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Panel>
  );
}

function EntryName({ entry }: { entry: NatureEntry }) {
  return (
    <div className="fx-name">
      <span className="fx-desc" title={entry.description}>
        {entry.description}
      </span>
      <span className="muted small">{entry.category}</span>
    </div>
  );
}

function FixedRow({
  entry: e,
  month,
  status,
  isCurrent,
  busy,
  onUnfix,
}: {
  entry: NatureEntry;
  month: string;
  status: MonthStatus;
  isCurrent: boolean;
  busy: boolean;
  onUnfix: () => void;
}) {
  const money = useMoney();
  const amounts = new Map(e.months.map((m) => [m.month, m.amountCents]));
  const history = Array.from({ length: HISTORY_MONTHS }, (_, i) => addMonths(month, i - HISTORY_MONTHS + 1));
  const inactive = status.kind === "stale" || status.kind === "ended" || status.kind === "later";

  return (
    <li className={`fx-row ${inactive ? "inactive" : ""}`}>
      <div className="fx-name">
        <span className="fx-desc" title={e.description}>
          {e.description}
        </span>
        <span className="fx-meta">
          <span className="muted small">{e.category}</span>
          {e.natureSource === "manual" ? (
            <span className="src-badge src-manual" title="Marcado à mão">
              manual
            </span>
          ) : e.installment ? (
            <span className="badge" title="Parcela: conta como fixo até acabar">
              parcela {e.installment.number}/{e.installment.total}
            </span>
          ) : (
            <span className="badge" title="Se repete todo mês com valor parecido">
              detectado
            </span>
          )}
        </span>
      </div>

      <div className="fx-history" aria-label="Últimos meses">
        {history.map((m) => {
          const cents = amounts.get(m);
          return (
            <span
              key={m}
              className={`fx-dot ${cents !== undefined ? "on" : ""} ${m === month ? "current" : ""}`}
              title={`${formatMonthShort(m)}: ${cents !== undefined ? (money.hidden ? "lançado" : formatCents(cents)) : "sem lançamento"}`}
            />
          );
        })}
      </div>

      <div className="fx-amount num">
        <span className="nowrap">{money.cents(e.typicalCents)}</span>
        <span className="muted small">típico</span>
      </div>

      <div className="fx-status small">
        <StatusLabel status={status} isCurrent={isCurrent} />
      </div>

      <button type="button" className="link-btn danger" disabled={busy} onClick={onUnfix} title="Passa a contar como variável">
        não é fixo
      </button>
    </li>
  );
}

function StatusLabel({ status, isCurrent }: { status: MonthStatus; isCurrent: boolean }) {
  const money = useMoney();
  switch (status.kind) {
    case "posted":
      return (
        <span className="fx-ok">
          <Icon name="check" size={12} /> {money.cents(status.cents)}
        </span>
      );
    case "expected":
      return <span className="fx-wait">{isCurrent ? "ainda não veio" : "não veio"}</span>;
    case "ended":
      return <span className="muted">parcelas encerradas</span>;
    case "stale":
      return <span className="muted">parado desde {formatMonthShort(status.since)}</span>;
    case "later":
      return <span className="muted">a partir de {formatMonthShort(status.from)}</span>;
  }
}
