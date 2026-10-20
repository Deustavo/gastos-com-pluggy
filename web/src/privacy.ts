import { useSyncExternalStore } from "react";
import { formatCents, formatCentsCompact } from "./format.ts";

// Modo "ocultar valores": estado global persistido no navegador, lido por quem exibe dinheiro.
const KEY = "openfinance:hide-values";
const MASK = "R$ •••••";
const MASK_COMPACT = "•••";

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

// Formatadores de dinheiro que respeitam o modo oculto.
export function useMoney() {
  const isHidden = useHideValues();
  return {
    hidden: isHidden,
    cents: (cents: number) => (isHidden ? MASK : formatCents(cents)),
    compact: (cents: number) => (isHidden ? MASK_COMPACT : formatCentsCompact(cents)),
  };
}
