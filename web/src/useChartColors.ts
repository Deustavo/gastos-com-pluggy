import { useEffect, useState } from "react";

// O Recharts escreve as cores como atributos SVG; lemos as variáveis CSS do tema
// e relemos quando o esquema claro/escuro do sistema muda.
export interface ChartColors {
  series1: string;
  series2: string;
  surface: string;
  categorical: string[];
  other: string;
}

function read(): ChartColors {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    series1: v("--series-1", "#d63c3c"),
    series2: v("--series-2", "#1f9d55"),
    surface: v("--surface", "#fcfcfb"),
    categorical: [1, 2, 3, 4, 5, 6, 7].map((i) => v(`--cat-${i}`, "#2a78d6")),
    other: v("--cat-other", "#a3a7b3"),
  };
}

export function useChartColors(): ChartColors {
  const [colors, setColors] = useState(read);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setColors(read());
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return colors;
}
