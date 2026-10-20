import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { Nature, TransactionRow } from "../../../src/api/contract.ts";
import { useMoney } from "../privacy.ts";
import { Icon } from "./Icon.tsx";
import { Panel } from "./Panel.tsx";
import { useChartColors } from "../useChartColors.ts";

interface Props {
  nature: Nature;
  rows: TransactionRow[] | undefined;
  loading: boolean;
  error: string | undefined;
  selected: { category: string | undefined; nature: Nature | undefined };
  onSelect: (category: string | undefined, nature: Nature | undefined) => void;
}

// Fatias com cor própria; o resto vira "Outros" (não clicável).
const PIE_SLICES = 7;
const OTHER = "Outros";

const TITLE: Record<Nature, string> = { fixed: "Gastos fixos", variable: "Gastos variáveis" };

interface Slice {
  category: string;
  cents: number;
  fill: string;
}

// Gasto do mês por categoria, só da natureza pedida. Mesma regra do resumo:
// confirmado, não ignorado, expense soma e refund abate.
function byCategory(rows: TransactionRow[], nature: Nature): { category: string; cents: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.ignored || r.status !== "POSTED" || r.nature !== nature) continue;
    if (r.kind !== "expense" && r.kind !== "refund") continue;
    map.set(r.category, (map.get(r.category) ?? 0) - r.amountCents);
  }
  return [...map.entries()].map(([category, cents]) => ({ category, cents })).sort((a, b) => b.cents - a.cents);
}

export function NaturePieChart({ nature, rows, loading, error, selected, onSelect }: Props) {
  const colors = useChartColors();
  const money = useMoney();
  const positive = rows ? byCategory(rows, nature).filter((d) => d.cents > 0) : [];
  const total = positive.reduce((n, d) => n + d.cents, 0);
  const slices: Slice[] = positive.slice(0, PIE_SLICES).map((d, i) => ({ ...d, fill: colors.categorical[i]! }));
  const rest = positive.slice(PIE_SLICES).reduce((n, d) => n + d.cents, 0);
  if (rest > 0) slices.push({ category: OTHER, cents: rest, fill: colors.other });
  const pct = (cents: number) => (total > 0 ? Math.round((cents / total) * 100) : 0);
  const active = selected.nature === nature ? selected.category : undefined;
  const toggle = (cat: string) => {
    if (cat === OTHER) return;
    if (cat === active) onSelect(undefined, undefined);
    else onSelect(cat, nature);
  };

  return (
    <Panel
      title={TITLE[nature]}
      icon="pie"
      className="panel-nature"
      loading={loading && !rows}
      refreshing={loading && !!rows}
      error={error}
      empty={rows && slices.length === 0 ? `Nenhum ${nature === "fixed" ? "gasto fixo" : "gasto variável"} confirmado neste mês.` : false}
      actions={
        active ? (
          <button type="button" className="chip active" onClick={() => onSelect(undefined, undefined)}>
            {active} <Icon name="x" size={12} />
          </button>
        ) : (
          rows && total > 0 && <span className="muted">{money.cents(total)}</span>
        )
      }
    >
      {rows && slices.length > 0 && (
        <div className="pie-row">
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="cents"
                  nameKey="category"
                  innerRadius="58%"
                  outerRadius="100%"
                  paddingAngle={slices.length > 1 ? 1 : 0}
                  stroke={colors.surface}
                  strokeWidth={2}
                  startAngle={90}
                  endAngle={-270}
                  isAnimationActive={false}
                  className="clickable"
                  onClick={(entry) => toggle((entry as unknown as Slice).category)}
                >
                  {slices.map((s) => (
                    <Cell key={s.category} fill={s.fill} fillOpacity={active && active !== s.category ? 0.3 : 1} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active: on, payload }) => {
                    const item = payload?.[0]?.payload as Slice | undefined;
                    if (!on || !item) return null;
                    return (
                      <div className="tooltip">
                        <div className="tooltip-title">{item.category}</div>
                        <div>
                          {money.cents(item.cents)} <span className="muted">({pct(item.cents)}%)</span>
                        </div>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="pie-legend">
            {slices.map((s) => (
              <li key={s.category}>
                <button
                  type="button"
                  className={active && active !== s.category ? "dim" : undefined}
                  disabled={s.category === OTHER}
                  onClick={() => toggle(s.category)}
                >
                  <span className="swatch" style={{ background: s.fill }} />
                  <span className="name">{s.category}</span>
                  <span className="pct">{pct(s.cents)}%</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
