import { createElement, useSyncExternalStore, type ReactNode } from "react";
import { formatCents, formatCentsCompact } from "./format.ts";

// Modo "ocultar valores": estado global persistido no navegador, lido por quem exibe dinheiro.
const KEY = "openfinance:hide-values";
// Valores ocultos continuam no DOM, só borrados (classe .money-hidden em styles.css).
const HIDDEN_CLASS = "money-hidden";

let hidden = load();
const listeners = new Set<() => void>();

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setHideValues(value: boolean): void {
  hidden = value;
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    // sem storage: vale só para esta aba
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useHideValues(): boolean {
  return useSyncExternalStore(subscribe, () => hidden);
}

// Formatadores de dinheiro que respeitam o modo oculto. `compact` é texto puro (eixos SVG):
// quem usa aplica `axisClass` no eixo para borrá-lo.
export function useMoney() {
  const isHidden = useHideValues();
  return {
    hidden: isHidden,
    cents: (cents: number): ReactNode =>
      isHidden ? createElement("span", { className: HIDDEN_CLASS, "aria-hidden": true }, formatCents(cents)) : formatCents(cents),
    compact: (cents: number) => formatCentsCompact(cents),
    axisClass: isHidden ? HIDDEN_CLASS : undefined,
  };
}
