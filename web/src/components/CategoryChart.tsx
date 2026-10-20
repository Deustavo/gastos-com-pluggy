import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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

export function CategoryChart({ summary, loading, error, selected, onSelect }: Props) {
  const colors = useChartColors();
  const money = useMoney();
  const data = [...(summary?.byCategory ?? [])].sort((a, b) => b.expenseCents - a.expenseCents);
  const total = data.reduce((n, d) => n + Math.max(0, d.expenseCents), 0);

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
          <p className="hint">Clique numa barra para filtrar a lista de transações.</p>
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
                    const pct = total > 0 ? Math.round((Math.max(0, item.expenseCents) / total) * 100) : 0;
                    return (
                      <div className="tooltip">
                        <div className="tooltip-title">{item.category}</div>
                        <div>
                          {money.cents(item.expenseCents)} <span className="muted">({pct}%)</span>
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
