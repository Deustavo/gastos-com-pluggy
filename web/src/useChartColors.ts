import { useEffect, useState } from "react";

// O Recharts escreve as cores como atributos SVG; lemos as variáveis CSS do tema
// e relemos quando o esquema claro/escuro do sistema muda.
export interface ChartColors {
  series1: string;
  series2: string;
  surface: string;
}

function read(): ChartColors {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    series1: v("--series-1", "#2a78d6"),
    series2: v("--series-2", "#eb6834"),
    surface: v("--surface", "#fcfcfb"),
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
