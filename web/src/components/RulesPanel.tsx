import { useEffect, useId, useState } from "react";
import type { CategoryRule, RulePreviewResponse } from "../../../src/api/contract.ts";
import { api } from "../api.ts";
import { formatDay } from "../format.ts";
import { useMoney } from "../privacy.ts";
import { Icon } from "./Icon.tsx";
import { Panel } from "./Panel.tsx";

// Pedido de "Criar regra…" vindo da lista de transações. `nonce` muda a cada clique,
// para reabrir o formulário mesmo com os mesmos valores.
export interface RuleDraft {
  pattern: string;
  category: string;
  nonce: number;
}

interface Props {
  rules: CategoryRule[] | undefined;
  loading: boolean;
  error: string | undefined;
  categories: string[];
  draft: RuleDraft | undefined;
  onChanged: () => void; // recarrega regras, resumo, transações e categorias
}

interface FormState {
  id: number | null; // null = nova regra
  pattern: string;
  category: string;
}

const MAX_PATTERN = 200;
const MAX_CATEGORY = 60;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? one : many}`;
}

export function RulesPanel({ rules, loading, error, categories, draft, onChanged }: Props) {
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  // Abre o formulário pré-preenchido quando a lista de transações pede.
  useEffect(() => {
    if (!draft) return;
    setForm({ id: null, pattern: draft.pattern, category: draft.category });
    setConfirmDelete(null);
  }, [draft]);

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setActionErr(undefined);
    try {
      await action();
      onChanged();
      return true;
    } catch (e) {
      setActionErr(errMsg(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function move(index: number, delta: -1 | 1) {
    if (!rules) return;
    const ids = rules.map((r) => r.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    void run(() => api.reorderRules(ids));
  }

  const list = rules ?? [];

  return (
    <Panel
      title="Regras de categorização"
      icon="sliders"
      className="panel-rules"
      loading={loading && !rules}
      refreshing={(loading && !!rules) || busy}
      error={error}
      actions={
        rules &&
        !form && (
          <button type="button" className="small-btn" onClick={() => setForm({ id: null, pattern: "", category: "" })}>
            <Icon name="plus" size={14} /> Nova regra
          </button>
        )
      }
    >
      {rules && (
        <>
          <p className="hint">
            Aplicadas de cima para baixo: a primeira regra habilitada cujo padrão aparece na descrição define a
            categoria. Categoria escolhida à mão numa transação vale mais que qualquer regra.
          </p>
          {actionErr && <div className="state state-error inline">{actionErr}</div>}
          {form && (
            <RuleForm
              key={`${form.id ?? "new"}-${draft?.nonce ?? 0}`}
              initial={form}
              categories={categories}
              onCancel={() => setForm(null)}
              onSave={async (f) => {
                const body = { pattern: f.pattern, category: f.category };
                const ok = await run(() => (f.id === null ? api.createRule(body) : api.updateRule(f.id, body)));
                if (ok) setForm(null);
                return ok;
              }}
              saving={busy}
            />
          )}
          {list.length === 0 ? (
            !form && <div className="state state-empty">Nenhuma regra ainda. Crie uma aqui ou a partir de uma transação (“Criar regra…”).</div>
          ) : (
            <ol className="rule-list">
              {list.map((r, i) => (
                <li key={r.id} className={`rule ${r.enabled ? "" : "disabled"} ${form?.id === r.id ? "editing" : ""}`}>
                  <span className="rule-order muted">{i + 1}</span>
                  <div className="rule-main">
                    <code className="rule-pattern" title={r.pattern}>
                      {r.pattern}
                    </code>
                    <span className="rule-arrow muted" aria-hidden>
                      →
                    </span>
                    <span className="rule-cat">{r.category}</span>
                  </div>
                  <span className="rule-count muted small" title="Transações que esta regra categoriza hoje">
                    {r.enabled ? plural(r.matchCount, "transação", "transações") : "desabilitada"}
                  </span>
                  <div className="rule-actions">
                    <label className="switch" title={r.enabled ? "Desabilitar" : "Habilitar"}>
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        disabled={busy}
                        onChange={(e) => void run(() => api.updateRule(r.id, { enabled: e.target.checked }))}
                        aria-label={`Regra ${r.pattern} habilitada`}
                      />
                      <span className="switch-track" aria-hidden />
                    </label>
                    <button
                      type="button"
                      className="icon-btn sm"
                      disabled={busy || i === 0}
                      onClick={() => move(i, -1)}
                      title="Mover para cima"
                      aria-label="Mover para cima"
                    >
                      <Icon name="chevronUp" size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn sm"
                      disabled={busy || i === list.length - 1}
                      onClick={() => move(i, 1)}
                      title="Mover para baixo"
                      aria-label="Mover para baixo"
                    >
                      <Icon name="chevronDown" size={14} />
                    </button>
                    {confirmDelete === r.id ? (
                      <span className="confirm">
                        Excluir?
                        <button
                          type="button"
                          className="small-btn danger"
                          disabled={busy}
                          onClick={() => {
                            setConfirmDelete(null);
                            if (form?.id === r.id) setForm(null);
                            void run(() => api.deleteRule(r.id));
                          }}
                        >
                          Excluir
                        </button>
                        <button type="button" className="link-btn" onClick={() => setConfirmDelete(null)}>
                          cancelar
                        </button>
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="link-btn"
                          disabled={busy}
                          onClick={() => setForm({ id: r.id, pattern: r.pattern, category: r.category })}
                        >
                          editar
                        </button>
                        <button
                          type="button"
                          className="link-btn danger"
                          disabled={busy}
                          onClick={() => setConfirmDelete(r.id)}
                        >
                          excluir
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </Panel>
  );
}

type PreviewState =
  | { kind: "idle" }
  | { kind: "loading"; prev?: RulePreviewResponse }
  | { kind: "ok"; data: RulePreviewResponse }
  | { kind: "error"; message: string };

// Testa o padrão na API com debounce de 300 ms; descarta respostas obsoletas.
function usePreview(pattern: string, excludeRuleId: number | null): PreviewState {
  const [state, setState] = useState<PreviewState>({ kind: "idle" });
  useEffect(() => {
    const p = pattern.trim();
    if (!p) {
      setState({ kind: "idle" });
      return;
    }
    let alive = true;
    setState((s) => ({ kind: "loading", prev: s.kind === "ok" ? s.data : s.kind === "loading" ? s.prev : undefined }));
    const t = setTimeout(() => {
      api
        .previewRule(excludeRuleId === null ? { pattern: p } : { pattern: p, excludeRuleId })
        .then(
          (data) => alive && setState({ kind: "ok", data }),
          (e: unknown) => alive && setState({ kind: "error", message: errMsg(e) }),
        );
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [pattern, excludeRuleId]);
  return state;
}

function RuleForm({
  initial,
  categories,
  saving,
  onCancel,
  onSave,
}: {
  initial: FormState;
  categories: string[];
  saving: boolean;
  onCancel: () => void;
  onSave: (f: FormState) => Promise<boolean>;
}) {
  const money = useMoney();
  const [pattern, setPattern] = useState(initial.pattern);
  const [category, setCategory] = useState(initial.category);
  const preview = usePreview(pattern, initial.id);
  const listId = useId();

  const p = pattern.trim();
  const c = category.trim();
  const canSave = !!p && !!c && preview.kind !== "error" && !saving;
  const shown = preview.kind === "ok" ? preview.data : preview.kind === "loading" ? preview.prev : undefined;

  return (
    <form
      className="rule-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) void onSave({ id: initial.id, pattern: p, category: c });
      }}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <h3>{initial.id === null ? "Nova regra" : "Editar regra"}</h3>
      <div className="rule-fields">
        <label className="grow">
          Padrão (regex sobre a descrição)
          <input
            type="text"
            className="mono"
            value={pattern}
            maxLength={MAX_PATTERN}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            placeholder="ex.: UBER|99APP"
            onChange={(e) => setPattern(e.target.value)}
            aria-invalid={preview.kind === "error"}
          />
        </label>
        <label>
          Categoria
          <input
            type="text"
            list={listId}
            value={category}
            maxLength={MAX_CATEGORY}
            autoComplete="off"
            placeholder="ex.: Transporte"
            onChange={(e) => setCategory(e.target.value)}
          />
          <datalist id={listId}>
            {categories.map((cat) => (
              <option key={cat} value={cat} />
            ))}
          </datalist>
        </label>
        <div className="rule-form-btns">
          <button type="submit" className="primary-btn" disabled={!canSave}>
            {saving ? "Salvando…" : initial.id === null ? "Criar regra" : "Salvar"}
          </button>
          <button type="button" className="link-btn" onClick={onCancel} disabled={saving}>
            cancelar
          </button>
        </div>
      </div>
      <p className="hint">Maiúsculas e acentos são ignorados; use | para alternativas, ex.: UBER|99APP.</p>

      <div className="rule-preview" aria-live="polite">
        {preview.kind === "idle" && <span className="muted small">Digite um padrão para ver quais transações ele pega.</span>}
        {preview.kind === "error" && <div className="row-error">{preview.message}</div>}
        {shown && (
          <>
            <div className="preview-head">
              <strong>{plural(shown.matchCount, "transação", "transações")}</strong>
              {shown.matchCount > shown.sample.length && (
                <span className="muted small"> · mostrando as {shown.sample.length} mais recentes</span>
              )}
              {preview.kind === "loading" && <span className="spinner" aria-label="testando" />}
            </div>
            {shown.sample.length > 0 && (
              <div className="table-wrap">
                <table className="tx-table preview-table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Descrição</th>
                      <th className="num">Valor</th>
                      <th>Categoria</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.sample.map((s, i) => {
                      const same = c === "" || s.currentCategory === c;
                      return (
                        <tr key={`${s.localDate}-${i}`}>
                          <td className="nowrap" data-label="Data">
                            {formatDay(s.localDate)}
                          </td>
                          <td data-label="Descrição">{s.description}</td>
                          <td className={`num nowrap ${s.amountCents < 0 ? "neg" : s.amountCents > 0 ? "pos" : ""}`} data-label="Valor">
                            {money.cents(s.amountCents)}
                          </td>
                          <td data-label="Categoria">
                            {same ? (
                              <span className="muted">{s.currentCategory}</span>
                            ) : (
                              <span className="cat-change">
                                <span className="muted">{s.currentCategory}</span> → <strong>{c}</strong>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {preview.kind === "loading" && !shown && <span className="muted small">Testando…</span>}
      </div>
    </form>
  );
}
