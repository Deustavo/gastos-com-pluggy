import type { ConnectionHealth, ConnectionsResponse } from "../../../src/api/contract.ts";
import { formatDateTime } from "../format.ts";
import { useMoney } from "../privacy.ts";
import { Icon } from "./Icon.tsx";
import { Panel } from "./Panel.tsx";

interface Props {
  data: ConnectionsResponse | undefined;
  loading: boolean;
  error: string | undefined;
}

const CONSENT_WARN_DAYS = 30;

const RUN_STATUS: Record<string, string> = { success: "ok", error: "erro", running: "em andamento" };

export function ConnectionsPanel({ data, loading, error }: Props) {
  const list = data?.connections ?? [];
  return (
    <Panel
      title="Saúde das conexões"
      icon="landmark"
      className="panel-conn"
      loading={loading && !data}
      refreshing={loading && !!data}
      error={error}
      empty={data && list.length === 0 ? "Nenhuma conexão cadastrada." : false}
    >
      {data && list.length > 0 && (
        <div className="conn-grid">
          {list.map((c) => (
            <ConnectionCard key={c.id} c={c} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function consent(c: ConnectionHealth): { cls: string; text: string } {
  const d = c.daysToConsentExpiry;
  if (d === null) return { cls: "", text: "sem data de expiração" };
  const date = c.consentExpiresAt ? ` (${formatDateTime(c.consentExpiresAt).slice(0, 10)})` : "";
  if (d < 0) return { cls: "consent-bad", text: `expirado há ${-d} ${-d === 1 ? "dia" : "dias"}${date}` };
  if (d === 0) return { cls: "consent-bad", text: `expira hoje${date}` };
  if (d < CONSENT_WARN_DAYS) return { cls: "consent-warn", text: `expira em ${d} ${d === 1 ? "dia" : "dias"}${date}` };
  return { cls: "consent-ok", text: `expira em ${d} dias${date}` };
}

function ConnectionCard({ c }: { c: ConnectionHealth }) {
  const money = useMoney();
  const cs = consent(c);
  const run = c.lastRun;
  const runBad = run?.status === "error";
  return (
    <article className="conn-card">
      <header>
        <h3>{c.nickname ?? `${c.provider} #${c.id}`}</h3>
        <span className={`badge ${c.providerStatus === "UPDATED" ? "badge-ok" : c.providerStatus ? "badge-warn" : ""}`}>
          {c.providerStatus ?? "status desconhecido"}
        </span>
      </header>
      <dl>
        <dt>Fornecedor</dt>
        <dd>{c.provider}</dd>
        <dt>Última atualização</dt>
        <dd>{formatDateTime(c.lastUpdatedAt)}</dd>
        <dt>Último sync</dt>
        <dd>
          {run ? (
            <>
              <span className={`badge ${runBad ? "badge-bad" : run.status === "success" ? "badge-ok" : "badge-warn"}`}>
                {RUN_STATUS[run.status] ?? run.status}
              </span>{" "}
              {formatDateTime(run.finishedAt ?? run.startedAt)}
              {run.error && <div className="row-error">{run.error}</div>}
            </>
          ) : (
            "nunca"
          )}
        </dd>
        <dt>Consentimento</dt>
        <dd>
          <span className={`consent ${cs.cls}`}>
            {cs.cls === "consent-bad" || cs.cls === "consent-warn" ? <Icon name="alert" size={13} /> : null}
            {cs.text}
          </span>
        </dd>
      </dl>
      {c.accounts.length > 0 ? (
        <table className="acct-table">
          <tbody>
            {c.accounts.map((a) => (
              <tr key={a.id}>
                <td>
                  {a.name ?? a.subtype ?? (a.type === "CREDIT" ? "Cartão" : "Conta")}
                  {a.numberLast4 && <span className="muted"> ••••{a.numberLast4}</span>}
                </td>
                <td className="num nowrap">{a.balanceCents === null ? "—" : money.cents(a.balanceCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small">Sem contas.</p>
      )}
    </article>
  );
}
