import { getSupabase } from '../lib/supabase';

/**
 * Upsert idempotente SEM depender de constraint UNIQUE no banco: faz
 * SELECT por chave -> UPDATE se existe, senao INSERT. Evita o erro
 * "no unique/exclusion constraint" do PostgREST quando a tabela existente
 * nao tem a constraint que o onConflict exigiria.
 */
export async function upsertByKeys(
  table: string,
  keys: Record<string, unknown>,
  row: Record<string, unknown>,
): Promise<void> {
  const sb = getSupabase();

  let sel = sb.from(table).select('id');
  for (const [k, v] of Object.entries(keys)) sel = sel.eq(k, v as never);
  const { data, error } = await sel.limit(1);
  if (error) throw new Error(`upsertByKeys(${table}) select: ${error.message}`);

  if (data && data.length > 0) {
    let upd = sb.from(table).update(row);
    for (const [k, v] of Object.entries(keys)) upd = upd.eq(k, v as never);
    const { error: e2 } = await upd;
    if (e2) throw new Error(`upsertByKeys(${table}) update: ${e2.message}`);
  } else {
    const { error: e3 } = await sb.from(table).insert({ ...keys, ...row });
    if (e3) throw new Error(`upsertByKeys(${table}) insert: ${e3.message}`);
  }
}
