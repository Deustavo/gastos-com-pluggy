import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon.tsx";

interface PanelProps {
  title: string;
  icon?: IconName;
  actions?: ReactNode;
  className?: string;
  loading?: boolean; // carregando sem nenhum dado ainda
  refreshing?: boolean; // recarregando com dado anterior visível
  error?: string;
  empty?: string | false; // mensagem de vazio quando truthy
  children?: ReactNode;
}

// Moldura comum dos blocos, com os estados de carregando, erro e vazio.
export function Panel({ title, icon, actions, className, loading, refreshing, error, empty, children }: PanelProps) {
  let body: ReactNode;
  if (loading) body = <div className="state state-loading">Carregando…</div>;
  else if (error && !children) body = <div className="state state-error">Erro: {error}</div>;
  else if (empty) body = <div className="state state-empty">{empty}</div>;
  else body = children;

  return (
    <section className={`panel ${className ?? ""}`} aria-busy={loading || refreshing}>
      <header className="panel-head">
        <h2>
          {icon && (
            <span className="panel-icon">
              <Icon name={icon} />
            </span>
          )}
          {title}
          {refreshing && !loading && <span className="spinner" aria-label="atualizando" />}
        </h2>
        {actions && <div className="panel-actions">{actions}</div>}
      </header>
      {error && children && !loading && <div className="state state-error inline">Erro ao atualizar: {error}</div>}
      {body}
    </section>
  );
}
