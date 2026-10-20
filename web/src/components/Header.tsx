import { useState } from "react";
import type { SyncReport } from "../../../src/api/contract.ts";
import { api, HttpError } from "../api.ts";
import { addMonths, currentMonth, formatDateTime, formatMonthLong } from "../format.ts";

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
  const isCurrent = month === currentMonth();

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
        <h1>Gastos</h1>
        <nav className="month-nav" aria-label="Selecionar mês">
          <button type="button" className="icon-btn" onClick={() => onMonthChange(addMonths(month, -1))} aria-label="Mês anterior">
            ←
          </button>
          <span className="month-label">{formatMonthLong(month)}</span>
          <button type="button" className="icon-btn" onClick={() => onMonthChange(addMonths(month, 1))} aria-label="Próximo mês">
            →
          </button>
          {!isCurrent && (
            <button type="button" className="link-btn" onClick={() => onMonthChange(currentMonth())}>
              mês atual
            </button>
          )}
        </nav>
      </div>
      <div className="sync-area">
        <button type="button" className="primary-btn" onClick={runSync} disabled={sync.kind === "running"}>
          {sync.kind === "running" ? (
            <>
              <span className="spinner light" /> Sincronizando…
            </>
          ) : (
            "Sincronizar agora"
          )}
        </button>
      </div>
      {sync.kind === "error" && (
        <div className="sync-result error" role="alert">
          <span>{sync.message}</span>
          <button type="button" className="link-btn" onClick={() => setSync({ kind: "idle" })} aria-label="Fechar">
            ✕
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
              <li key={i}>⚠ {a}</li>
            ))}
          </ul>
        )}
      </div>
      <button type="button" className="link-btn" onClick={onClose} aria-label="Fechar">
        ✕
      </button>
    </div>
  );
}
