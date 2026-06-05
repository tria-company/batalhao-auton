import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
type Row = Record<string, unknown>;
async function main() {
  const { data, error } = await sb.from('reference_profiles').select('*');
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  console.log(`reference_profiles: ${rows.length} linhas no total`);
  console.log(`colunas: ${Object.keys(rows[0] ?? {}).join(', ')}\n`);

  // duplicatas por (username, platform)
  const byKey = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.username}|${r.platform}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(r);
  }
  const dups = [...byKey.entries()].filter(([, v]) => v.length > 1);
  console.log(`(username, platform) distintos: ${byKey.size}`);
  console.log(`chaves DUPLICADAS: ${dups.length}`);
  for (const [k, v] of dups.slice(0, 10)) {
    console.log(
      `  ${k} ×${v.length} · ids=[${v.map((r) => String(r.id ?? '?').slice(0, 8)).join(', ')}] · status=[${v.map((r) => r.pipeline_status).join(', ')}] · created=[${v.map((r) => String(r.created_at ?? '?').slice(0, 10)).join(', ')}]`,
    );
  }
  // processando
  const proc = rows.filter((r) => r.pipeline_status === 'processando');
  console.log(`\nlinhas 'processando' (${proc.length}):`);
  for (const r of proc) console.log(`  ${r.username}/${r.platform} · id=${r.id} · updated=${r.updated_at}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
