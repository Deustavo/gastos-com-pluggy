import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SummaryResponse } from "../../../src/api/contract.ts";
import { formatMonthLong, formatMonthShort } from "../format.ts";
import { useMoney } from "../privacy.ts";
import { Panel } from "./Panel.tsx";
import { useChartColors } from "../useChartColors.ts";

interface Props {
  summary: SummaryResponse | undefined;
  loading: boolean;
  error: string | undefined;
  month: string;
  onSelect: (month: string) => void;
}

// Gasto (barras) e receita (linha) no mesmo eixo: ambos em R$, sem eixo duplo.
export function MonthlyChart({ summary, loading, error, month, onSelect }: Props) {
  const colors = useChartColors();
  const money = useMoney();
  const data = summary?.monthly ?? [];
  const hasData = data.some((d) => d.expenseCents !== 0 || d.incomeCents !== 0);

  return (
    <Panel
      title="Este ano"
      icon="chart"
      className="panel-monthly"
      loading={loading && !summary}
      refreshing={loading && !!summary}
      error={error}
      empty={summary && !hasData ? "Sem movimentação neste ano." : false}
    >
      {summary && hasData && (
        <>
          <p className="hint">Clique num mês para selecioná-lo.</p>
          <div className="chart" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={data}
                margin={{ top: 8, right: 8, bottom: 0, left: 4 }}
                className="clickable"
                onClick={(state) => {
                  const label = state?.activeLabel;
                  if (typeof label === "string" && /^\d{4}-\d{2}$/.test(label)) onSelect(label);
                }}
              >
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickFormatter={(v: string) => formatMonthShort(v)} tickLine={false} interval="preserveStartEnd" />
                <YAxis tickFormatter={(v: number) => money.compact(v)} tickLine={false} axisLine={false} width={72} />
                <Tooltip
                  cursor={{ className: "chart-cursor" }}
                  content={({ active, payload, label }) => {
                    const item = payload?.[0]?.payload as SummaryResponse["monthly"][number] | undefined;
                    if (!active || !item) return null;
                    return (
                      <div className="tooltip">
                        <div className="tooltip-title">{formatMonthLong(String(label ?? item.month))}</div>
                        <div>
                          <span className="swatch swatch-expense" /> Gasto: {money.cents(item.expenseCents)}
                        </div>
                        <div>
                          <span className="swatch swatch-income" /> Receita: {money.cents(item.incomeCents)}
                        </div>
                      </div>
                    );
                  }}
                />
                <Legend
                  content={() => (
                    <div className="legend">
                      <span>
                        <span className="swatch swatch-expense" /> Gasto
                      </span>
                      <span>
                        <span className="swatch swatch-income line" /> Receita
                      </span>
                    </div>
                  )}
                />
                <Bar dataKey="expenseCents" name="Gasto" className="bar-expense" radius={[4, 4, 0, 0]} maxBarSize={32} isAnimationActive={false}>
                  {data.map((d) => (
                    <Cell key={d.month} fill={colors.series1} fillOpacity={d.month === month ? 1 : 0.5} />
                  ))}
                </Bar>
                <Line
                  dataKey="incomeCents"
                  name="Receita"
                  type="monotone"
                  className="line-income"
                  stroke={colors.series2}
                  strokeWidth={2}
                  dot={{ r: 3, fill: colors.surface, stroke: colors.series2, strokeWidth: 2 }}
                  activeDot={{ r: 5, fill: colors.series2, stroke: colors.surface, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Panel>
  );
}
