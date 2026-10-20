import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SummaryResponse } from "../../../src/api/contract.ts";
import { useMoney } from "../privacy.ts";
import { Icon } from "./Icon.tsx";
import { Panel } from "./Panel.tsx";
import { useChartColors } from "../useChartColors.ts";

interface Props {
  summary: SummaryResponse | undefined;
  loading: boolean;
  error: string | undefined;
  selected: string | undefined;
  onSelect: (category: string | undefined) => void;
}

const ROW_PX = 30;
// Fatias com cor própria; o resto vira "Outros" (não clicável).
const PIE_SLICES = 7;
const OTHER = "Outros";

interface Slice {
  category: string;
  cents: number;
  fill: string;
}

export function CategoryChart({ summary, loading, error, selected, onSelect }: Props) {
  const colors = useChartColors();
  const money = useMoney();
  const data = [...(summary?.byCategory ?? [])].sort((a, b) => b.expenseCents - a.expenseCents);
  const total = data.reduce((n, d) => n + Math.max(0, d.expenseCents), 0);
  const positive = data.filter((d) => d.expenseCents > 0);
  const slices: Slice[] = positive.slice(0, PIE_SLICES).map((d, i) => ({
    category: d.category,
    cents: d.expenseCents,
    fill: colors.categorical[i]!,
  }));
  const rest = positive.slice(PIE_SLICES).reduce((n, d) => n + d.expenseCents, 0);
  if (rest > 0) slices.push({ category: OTHER, cents: rest, fill: colors.other });
  const pct = (cents: number) => (total > 0 ? Math.round((Math.max(0, cents) / total) * 100) : 0);
  const toggle = (cat: string) => {
    if (cat !== OTHER) onSelect(cat === selected ? undefined : cat);
  };

  return (
    <Panel
      title="Gasto por categoria"
      icon="pie"
      className="panel-category"
      loading={loading && !summary}
      refreshing={loading && !!summary}
      error={error}
      empty={summary && data.length === 0 ? "Nenhum gasto confirmado neste mês." : false}
      actions={
        selected && (
          <button type="button" className="chip active" onClick={() => onSelect(undefined)}>
            {selected} <Icon name="x" size={12} />
          </button>
        )
      }
    >
      {summary && data.length > 0 && (
        <>
          <p className="hint">Clique numa fatia ou barra para filtrar a lista de transações.</p>
          {slices.length > 0 && (
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
                        <Cell key={s.category} fill={s.fill} fillOpacity={selected && selected !== s.category ? 0.3 : 1} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        const item = payload?.[0]?.payload as Slice | undefined;
                        if (!active || !item) return null;
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
                      className={selected && selected !== s.category ? "dim" : undefined}
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
          <div className="chart" style={{ height: data.length * ROW_PX + 40 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }} barCategoryGap={4}>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" tickFormatter={(v: number) => money.compact(v)} tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="category"
                  width={140}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  tickFormatter={(v: string) => (v.length > 20 ? `${v.slice(0, 19)}…` : v)}
                />
                <Tooltip
                  cursor={{ className: "chart-cursor" }}
                  content={({ active, payload }) => {
                    const item = payload?.[0]?.payload as { category: string; expenseCents: number } | undefined;
                    if (!active || !item) return null;
                    return (
                      <div className="tooltip">
                        <div className="tooltip-title">{item.category}</div>
                        <div>
                          {money.cents(item.expenseCents)} <span className="muted">({pct(item.expenseCents)}%)</span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="expenseCents"
                  className="bar-expense clickable"
                  radius={[0, 4, 4, 0]}
                  maxBarSize={22}
                  isAnimationActive={false}
                  onClick={(entry) => {
                    const cat = (entry.payload as { category?: string } | undefined)?.category;
                    if (cat) onSelect(cat === selected ? undefined : cat);
                  }}
                >
                  {data.map((d) => (
                    <Cell key={d.category} fill={colors.series1} fillOpacity={selected && selected !== d.category ? 0.3 : 1} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Panel>
  );
}
