import 'dotenv/config';
import { getSupabase } from '../lib/supabase';

/**
 * READ-ONLY: verifica no banco se TODAS as analises de TODOS os materiais
 * foram feitas. Compara scrappers_contents (materiais/fonte) contra
 * post_analysis (C1+2), profile_synthesis (C3) e profile_cross_brief (C4).
 *   npx tsx src/scripts/verify-coverage.ts
 * Nao grava nada.
 *
 * Usa getSupabase() (transport ws) — necessario no Node 20 do VPS, onde o
 * createClient() cru quebra por falta de WebSocket nativo.
 */
const sb = getSupabase();
const N = Number(process.env.POSTS_PER_PROFILE ?? 50);
const PLATFORMS = ['instagram', 'tiktok', 'youtube'] as const;
type Row = Record<string, unknown>;

async function count(table: string, filt?: (q: any) => any): Promise<number> {
  let q = sb.from(table).select('*', { count: 'exact', head: true });
  if (filt) q = filt(q);
  const { count, error } = await q;
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return count ?? 0;
}

async function topPostIds(platform: string, username: string): Promise<string[]> {
  const base = () =>
    sb
      .from('scrappers_contents')
      .select('postid, posted_at')
      .eq('platform', platform)
      .eq('username', username)
      .limit(N);
  let { data, error } = await base().order('posted_at', { ascending: false });
  if (error) ({ data, error } = await base());
  if (error) throw new Error(`scrappers_contents ${username}/${platform}: ${error.message}`);
  return (data ?? []).map((r) => String((r as Row).postid ?? '')).filter(Boolean);
}

async function analyzedIds(
  platform: string,
  username: string,
): Promise<{ ok: Set<string>; errored: Set<string>; invalid: Set<string> }> {
  const { data, error } = await sb
    .from('post_analysis')
    .select('postid, tipo, specialist_error')
    .eq('platform', platform)
    .eq('username', username);
  if (error) throw new Error(`post_analysis ${username}/${platform}: ${error.message}`);
  const ok = new Set<string>();
  const errored = new Set<string>();
  const invalid = new Set<string>();
  for (const r of data ?? []) {
    const row = r as Row;
    const id = String(row.postid ?? '');
    if (!id) continue;
    if (row.specialist_error) errored.add(id);
    if (row.tipo) ok.add(id);
    else invalid.add(id); // tem linha mas classificacao C1 ausente
  }
  return { ok, errored, invalid };
}

async function main() {
  console.log(`\n=== VERIFICACAO DE COBERTURA (read-only) · top-N=${N}/perfil×rede ===`);
  console.log(`Projeto: ${process.env.SUPABASE_URL}\n`);

  // Totais globais
  const [totMat, totAnalises, totSynth, totBrief, totShifts] = await Promise.all([
    count('scrappers_contents'),
    count('post_analysis'),
    count('profile_synthesis'),
    count('profile_cross_brief'),
    count('profile_narrative_shifts').catch(() => -1),
  ]);
  console.log('TOTAIS NO BANCO:');
  console.log(`  scrappers_contents (materiais) : ${totMat}`);
  console.log(`  post_analysis (analises C1+2)  : ${totAnalises}`);
  console.log(`  profile_synthesis (C3)         : ${totSynth}`);
  console.log(`  profile_cross_brief (C4)       : ${totBrief}`);
  console.log(`  profile_narrative_shifts       : ${totShifts < 0 ? 'n/d' : totShifts}\n`);

  // Perfis ativos
  const { data: pdata, error: perr } = await sb
    .from('reference_profiles')
    .select('*')
    .eq('is_active', true);
  if (perr) throw new Error(`reference_profiles: ${perr.message}`);
  const profRows = (pdata ?? []) as Row[];

  // Monta combos (username, platform). Se houver coluna platform, respeita;
  // senao assume as 3 redes por username.
  const hasPlatformCol = profRows.some((r) => r.platform != null);
  type Combo = { username: string; platform: string; status: string | null };
  const combos: Combo[] = [];
  const usernames = new Set<string>();
  const statusByUser = new Map<string, Set<string>>();
  for (const r of profRows) {
    const u = String(r.username ?? '');
    if (!u) continue;
    usernames.add(u);
    const st = (r.pipeline_status as string) ?? null;
    if (st) {
      if (!statusByUser.has(u)) statusByUser.set(u, new Set());
      statusByUser.get(u)!.add(st);
    }
    if (hasPlatformCol) {
      const p = String(r.platform ?? '');
      if (PLATFORMS.includes(p as any)) combos.push({ username: u, platform: p, status: st });
    }
  }
  if (!hasPlatformCol) {
    for (const u of usernames) for (const p of PLATFORMS) combos.push({ username: u, platform: p, status: null });
  }

  console.log(`PERFIS ATIVOS: ${usernames.size} usernames · ${combos.length} combinacoes (perfil×rede)\n`);

  // status do pipeline
  const statusCount: Record<string, number> = {};
  for (const r of profRows) {
    const st = String(r.pipeline_status ?? 'sem_status');
    statusCount[st] = (statusCount[st] ?? 0) + 1;
  }
  console.log('pipeline_status (linhas de reference_profiles):');
  for (const [k, v] of Object.entries(statusCount)) console.log(`  ${k}: ${v}`);
  console.log('');

  // Cobertura por combo
  let totMatTopN = 0;
  let totOk = 0;
  let totMissing = 0;
  let totErr = 0;
  let totInvalid = 0;
  const gaps: string[] = [];
  const semMaterial: string[] = [];

  for (const c of combos) {
    const ids = await topPostIds(c.platform, c.username);
    if (ids.length === 0) {
      semMaterial.push(`${c.username}/${c.platform}`);
      continue;
    }
    const { ok, errored, invalid } = await analyzedIds(c.platform, c.username);
    const missing = ids.filter((id) => !ok.has(id));
    const erroredInTop = ids.filter((id) => errored.has(id));
    const invalidInTop = ids.filter((id) => invalid.has(id) && !ok.has(id));
    totMatTopN += ids.length;
    totOk += ids.length - missing.length;
    totMissing += missing.length;
    totErr += erroredInTop.length;
    totInvalid += invalidInTop.length;
    if (missing.length > 0) {
      gaps.push(
        `  ${c.username}/${c.platform}: ${ids.length - missing.length}/${ids.length} analisados · FALTAM ${missing.length}` +
          (erroredInTop.length ? ` (${erroredInTop.length} c/ erro especialista)` : ''),
      );
    }
  }

  console.log('=== COBERTURA DE ANALISES (post_analysis) — escopo top-N por combo ===');
  console.log(`  materiais no escopo (sum top-N) : ${totMatTopN}`);
  console.log(`  analisados (tipo preenchido)    : ${totOk}`);
  console.log(`  FALTANDO analise                : ${totMissing}`);
  console.log(`  com specialist_error            : ${totErr}`);
  console.log(`  linha sem classificacao C1      : ${totInvalid}`);
  const pct = totMatTopN ? ((totOk / totMatTopN) * 100).toFixed(1) : '0';
  console.log(`  => cobertura: ${pct}%\n`);

  if (semMaterial.length) {
    console.log(`Combos SEM material em scrappers_contents (${semMaterial.length}):`);
    console.log('  ' + semMaterial.join(', ') + '\n');
  }
  if (gaps.length) {
    console.log(`Combos com analises FALTANDO (${gaps.length}):`);
    console.log(gaps.join('\n') + '\n');
  } else {
    console.log('Todos os combos com material estao 100% analisados (C1+2). ✔\n');
  }

  // Cobertura C3 (sintese) e C4 (veredicto)
  const { data: sdata } = await sb.from('profile_synthesis').select('username, platform');
  const synthSet = new Set((sdata ?? []).map((r) => `${(r as Row).username}/${(r as Row).platform}`));
  const { data: bdata } = await sb
    .from('profile_cross_brief')
    .select('username, veredicto_letra, score_embaixador');
  const briefSet = new Set((bdata ?? []).map((r) => String((r as Row).username)));

  const synthMissing = combos.filter((c) => !synthSet.has(`${c.username}/${c.platform}`));
  const briefMissing = [...usernames].filter((u) => !briefSet.has(u));

  console.log('=== COBERTURA C3 (profile_synthesis) por perfil×rede ===');
  console.log(`  sinteses presentes: ${synthSet.size} · faltando: ${synthMissing.length}`);
  if (synthMissing.length)
    console.log('  faltam: ' + synthMissing.map((c) => `${c.username}/${c.platform}`).join(', '));
  console.log('');

  console.log('=== COBERTURA C4 (profile_cross_brief / veredicto) por perfil ===');
  console.log(`  vereditos presentes: ${briefSet.size}/${usernames.size} · faltando: ${briefMissing.length}`);
  if (briefMissing.length) console.log('  faltam: ' + briefMissing.join(', '));
  console.log('');

  const fullyDone =
    totMissing === 0 && synthMissing.length === 0 && briefMissing.length === 0 && semMaterial.length === 0;
  console.log(
    fullyDone
      ? '>>> RESULTADO: TODAS as analises de TODOS os materiais foram feitas. ✔'
      : '>>> RESULTADO: ha analises pendentes (ver acima). ✗',
  );
}

main().catch((e) => {
  console.error('verify-coverage falhou:', e instanceof Error ? e.message : e);
  process.exit(1);
});
