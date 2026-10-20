import { useState } from "react";
import type { SyncReport } from "../../../src/api/contract.ts";
import { api, HttpError } from "../api.ts";
import { addMonths, currentMonth, formatDateTime, formatMonthLong } from "../format.ts";
import { setHideValues, useHideValues } from "../privacy.ts";
import { Icon } from "./Icon.tsx";

interface HeaderProps {
  month: string;
  onMonthChange: (month: string) => void;
  onSynced: () => void;
}

type SyncState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; report: SyncReport }
  | { kind: "error"; message: string };

export function Header({ month, onMonthChange, onSynced }: HeaderProps) {
  const [sync, setSync] = useState<SyncState>({ kind: "idle" });
  const hidden = useHideValues();
  const isCurrent = month === currentMonth();
  // Não há dados no futuro: a navegação para no mês corrente.
  const canGoNext = month < currentMonth();

  async function runSync() {
    setSync({ kind: "running" });
    try {
      const report = await api.sync();
      setSync({ kind: "done", report });
    } catch (err) {
      const message =
        err instanceof HttpError && err.status === 409
          ? "Sincronização já em andamento."
          : `Falha na sincronização: ${err instanceof Error ? err.message : String(err)}`;
      setSync({ kind: "error", message });
    } finally {
      onSynced();
    }
  }

  return (
    <header className="app-header">
      <div className="app-title">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="wallet" size={20} />
          </span>
          <h1>Gastos</h1>
        </div>
        <nav className="month-nav" aria-label="Selecionar mês">
          <button type="button" className="icon-btn" onClick={() => onMonthChange(addMonths(month, -1))} aria-label="Mês anterior">
            <Icon name="chevronLeft" />
          </button>
          <span className="month-label">
            <Icon name="calendar" size={15} className="muted" />
            {formatMonthLong(month)}
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onMonthChange(addMonths(month, 1))}
            disabled={!canGoNext}
            aria-label="Próximo mês"
            title={canGoNext ? undefined : "Você já está no mês atual"}
          >
            <Icon name="chevronRight" />
          </button>
          {!isCurrent && (
            <button type="button" className="ghost-btn" onClick={() => onMonthChange(currentMonth())}>
              <Icon name="undo" size={14} /> mês atual
            </button>
          )}
        </nav>
      </div>
      <div className="sync-area">
        <button
          type="button"
          className={`icon-btn lg ${hidden ? "active" : ""}`}
          onClick={() => setHideValues(!hidden)}
          aria-pressed={hidden}
          aria-label={hidden ? "Mostrar valores" : "Ocultar valores"}
          title={hidden ? "Mostrar valores" : "Ocultar valores"}
        >
          <Icon name={hidden ? "eyeOff" : "eye"} size={18} />
        </button>
        <button type="button" className="primary-btn" onClick={runSync} disabled={sync.kind === "running"}>
          {sync.kind === "running" ? (
            <>
              <span className="spinner light" /> Sincronizando…
            </>
          ) : (
            <>
              <Icon name="refresh" /> Sincronizar agora
            </>
          )}
        </button>
      </div>
      {sync.kind === "error" && (
        <div className="sync-result error" role="alert">
          <span className="sync-msg">
            <Icon name="alert" /> {sync.message}
          </span>
          <button type="button" className="link-btn" onClick={() => setSync({ kind: "idle" })} aria-label="Fechar">
            <Icon name="x" />
          </button>
        </div>
      )}
      {sync.kind === "done" && <SyncSummary report={sync.report} onClose={() => setSync({ kind: "idle" })} />}
    </header>
  );
}

function SyncSummary({ report, onClose }: { report: SyncReport; onClose: () => void }) {
  const failed = report.connections.some((c) => c.status === "error");
  const mismatches = report.integrity.reduce((n, i) => n + i.mismatch, 0);
  return (
    <div className={`sync-result ${failed ? "error" : "ok"}`} role="status">
      <div>
        <Icon name={failed ? "alert" : "check"} className="sync-icon" />
        <strong>Sincronização concluída</strong> em {formatDateTime(report.finishedAt)}
        <ul className="sync-list">
          {report.connections.map((c) => (
            <li key={c.connectionId}>
              <span className={`badge ${c.status === "success" ? "badge-ok" : "badge-bad"}`}>
                {c.status === "success" ? "ok" : "erro"}
              </span>{" "}
              {c.provider} #{c.connectionId}: {c.txCount} transações
              {c.error && <span className="muted"> — {c.error}</span>}
            </li>
          ))}
          {report.connections.length === 0 && <li className="muted">Nenhuma conexão sincronizada.</li>}
          {mismatches > 0 && <li>Faturas com divergência: {mismatches}</li>}
          {report.overrides.orphaned > 0 && <li>Ajustes órfãos (sem transação): {report.overrides.orphaned}</li>}
        </ul>
        {report.alerts.length > 0 && (
          <ul className="sync-alerts">
            {report.alerts.map((a, i) => (
              <li key={i}>
                <Icon name="alert" size={14} /> {a}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button type="button" className="link-btn" onClick={onClose} aria-label="Fechar">
        <Icon name="x" />
      </button>
    </div>
  );
}
