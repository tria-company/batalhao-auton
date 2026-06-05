import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

/**
 * Dedupe de reference_profiles: mantem 1 linha por (username, platform) e
 * apaga as duplicatas. Mantem a "melhor" linha: prioriza last_scraped_at
 * preenchido, depois last_analysis_at, depois analyzed_posts_count, e por fim
 * a mais ANTIGA (created_at) — que e a original, com o last_scraped_at real.
 *
 * DRY-RUN por padrao. Para apagar de verdade: `--apply`.
 *   npx tsx src/scripts/dedupe-refprofiles.ts          (so mostra o plano)
 *   npx tsx src/scripts/dedupe-refprofiles.ts --apply  (apaga)
 */
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const APPLY = process.argv.includes('--apply');
type Row = Record<string, unknown>;

function score(r: Row): number {
  let s = 0;
  if (r.last_scraped_at) s += 1000;
  if (r.last_analysis_at) s += 100;
  if (Number(r.analyzed_posts_count ?? 0) > 0) s += 10;
  if (r.pipeline_status === 'completo') s += 1;
  return s;
}

async function main() {
  const { data, error } = await sb.from('reference_profiles').select('*');
  if (error) throw error;
  const rows = (data ?? []) as Row[];

  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.username}|${r.platform}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  const toDelete: Row[] = [];
  const keepers: { key: string; keep: string; del: string[] }[] = [];
  for (const [k, g] of groups) {
    if (g.length <= 1) continue;
    // ordena: melhor score, depois created_at mais antigo
    const sorted = [...g].sort((a, b) => {
      const ds = score(b) - score(a);
      if (ds !== 0) return ds;
      return String(a.created_at).localeCompare(String(b.created_at));
    });
    const keep = sorted[0];
    const del = sorted.slice(1);
    toDelete.push(...del);
    keepers.push({
      key: k,
      keep: `${String(keep.id).slice(0, 8)} (created ${String(keep.created_at).slice(0, 10)}, scraped ${keep.last_scraped_at ? 'sim' : 'nao'})`,
      del: del.map((d) => `${String(d.id).slice(0, 8)} (created ${String(d.created_at).slice(0, 10)}, scraped ${d.last_scraped_at ? 'sim' : 'nao'})`),
    });
  }

  console.log(`Total de linhas: ${rows.length} · grupos (username,platform): ${groups.size}`);
  console.log(`Grupos com duplicata: ${keepers.length} · linhas a apagar: ${toDelete.length}\n`);
  for (const k of keepers.slice(0, 8)) {
    console.log(`${k.key}\n  KEEP ${k.keep}\n  DEL  ${k.del.join(' | ')}`);
  }
  if (keepers.length > 8) console.log(`  … e mais ${keepers.length - 8} grupos`);

  // Sanidade: nenhuma linha a apagar pode ter last_scraped_at/last_analysis_at
  // se o keeper do grupo nao tiver — ja garantido pelo score, mas confirmamos.
  const perigosas = toDelete.filter((d) => d.last_scraped_at || d.last_analysis_at);
  if (perigosas.length) {
    console.log(`\n⚠ ${perigosas.length} linhas a apagar tem dados de scrape/analise — ABORTANDO por seguranca.`);
    perigosas.forEach((d) => console.log(`  ${d.username}/${d.platform} id=${d.id}`));
    process.exit(2);
  }

  if (!APPLY) {
    console.log('\n[DRY-RUN] Nada apagado. Rode com --apply para executar.');
    return;
  }

  // Apaga em lotes por id.
  const ids = toDelete.map((d) => String(d.id));
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const { error: delErr, count } = await sb
      .from('reference_profiles')
      .delete({ count: 'exact' })
      .in('id', batch);
    if (delErr) throw new Error(`delete falhou: ${delErr.message}`);
    deleted += count ?? batch.length;
  }
  console.log(`\n✔ Apagadas ${deleted} linhas duplicadas.`);

  const { count: restante } = await sb
    .from('reference_profiles')
    .select('*', { count: 'exact', head: true });
  console.log(`reference_profiles agora: ${restante} linhas (esperado: ${groups.size}).`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
