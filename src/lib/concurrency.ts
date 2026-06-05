/**
 * Executa `fn` sobre `items` com no maximo `concurrency` em paralelo.
 * Preserva a ordem dos resultados. Sem dependencias externas.
 */
export async function pMap<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx] as T, idx);
    }
  }

  const workers = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
