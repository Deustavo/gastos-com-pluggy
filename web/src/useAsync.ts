import { useEffect, useState } from "react";

export interface AsyncState<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
}

// Carrega `fn` sempre que `deps` mudam. Mantém o dado anterior durante o recarregamento
// (evita piscar) e descarta respostas de requisições obsoletas.
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: undefined, error: undefined, loading: true });

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fn().then(
      (data) => alive && setState({ data, error: undefined, loading: false }),
      (err: unknown) =>
        alive && setState((s) => ({ data: s.data, error: err instanceof Error ? err.message : String(err), loading: false })),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
