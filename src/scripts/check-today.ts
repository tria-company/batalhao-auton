import 'dotenv/config';
import { getSupabase } from '../lib/supabase';

/**
 * READ-ONLY: "rodou tudo certo hoje e nao teve erro?". Olha o que foi tocado
 * HOJE (fuso local) em cada tabela do pipeline e sinaliza erros:
 *   - scrappers_contents  : posts raspados/atualizados hoje (por rede)
 *   - reference_profiles  : pipeline_status='erro' (qualquer um => FALHA) e
 *                           perfis raspados hoje (last_scraped_at)
 *   - post_analysis       : analises gravadas hoje + quantas com specialist_error
 *   - profile_synthesis   : sinteses (C3) gravadas hoje
 *   - profile_cross_brief : vereditos (C4) gravados hoje
 * Nao grava nada.
 *   npx tsx src/scripts/check-today.ts            (hoje)
 *   npx tsx src/scripts/check-today.ts 2026-06-07 (um dia especifico)
 *
 * Usa getSupabase() (transport ws) — necessario no Node 20 do VPS, onde o
 * createClient() cru quebra por falta de WebSocket nativo.
 */
const sb = getSupabase();

// Inicio do dia (local) em ISO/UTC, para comparar com colunas timestamptz.
function startOfDayISO(arg?: string): { fromISO: string; label: string } {
  const base = arg ? new Date(`${arg}T00:00:00`) : new Date();
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
  const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { fromISO: d.toISOString(), label };
}

async function countSince(table: string, col: string, fromISO: string): Promise<number> {
  const { count, error } = await sb
    .from(table)
    .select('*', { count: 'exact', head: true })
    .gte(col, fromISO);
  if (error) throw new Error(`count ${table}.${col}: ${error.message}`);
  return count ?? 0;
}

async function main(): Promise<void> {
  const { fromISO, label } = startOfDayISO(process.argv[2]);
  console.log(`\n=== O QUE RODOU EM ${label} (read-only) ===`);
  console.log(`Projeto: ${process.env.SUPABASE_URL}`);
  console.log(`Janela : desde ${fromISO}\n`);

  const problems: string[] = [];

  // 1) pipeline_status='erro' — sinal direto de falha (em QUALQUER perfil/rede).
  const { data: erros, error: e1 } = await sb
    .from('reference_profiles')
    .select('username, platform, pipeline_status')
    .eq('pipeline_status', 'erro');
  if (e1) throw new Error(`reference_profiles erro: ${e1.message}`);
  if ((erros ?? []).length) {
    problems.push(`${erros!.length} perfil(is) com pipeline_status='erro'`);
    console.log(`✗ pipeline_status='erro' (${erros!.length}):`);
    for (const r of erros!) console.log(`    ${(r as any).username}/${(r as any).platform}`);
  } else {
    console.log(`✔ Nenhum perfil com pipeline_status='erro'.`);
  }

  // 2) Scrape de hoje (last_scraped_at em reference_profiles).
  const { data: scraped, error: e2 } = await sb
    .from('reference_profiles')
    .select('username, platform, last_scraped_at')
    .gte('last_scraped_at', fromISO);
  if (e2) throw new Error(`reference_profiles last_scraped_at: ${e2.message}`);
  const byPlat: Record<string, number> = {};
  for (const r of scraped ?? []) byPlat[String((r as any).platform)] = (byPlat[String((r as any).platform)] ?? 0) + 1;
  console.log(`\nScrape hoje (perfis com last_scraped_at hoje): ${(scraped ?? []).length}`);
  for (const [p, n] of Object.entries(byPlat)) console.log(`    ${p}: ${n}`);

  // 3) Materiais gravados/atualizados hoje.
  const matHoje = await countSince('scrappers_contents', 'updated_at', fromISO);
  console.log(`\nscrappers_contents tocados hoje (updated_at): ${matHoje}`);

  // 4) Analises gravadas hoje + quantas com specialist_error.
  const anHoje = await countSince('post_analysis', 'updated_at', fromISO);
  const { count: specErr, error: e4 } = await sb
    .from('post_analysis')
    .select('*', { count: 'exact', head: true })
    .gte('updated_at', fromISO)
    .not('specialist_error', 'is', null);
  if (e4) throw new Error(`post_analysis specialist_error: ${e4.message}`);
  console.log(`\npost_analysis (C1+2) gravadas hoje: ${anHoje}`);
  if ((specErr ?? 0) > 0) {
    problems.push(`${specErr} analise(s) de hoje com specialist_error`);
    console.log(`    ✗ com specialist_error: ${specErr}`);
  } else {
    console.log(`    ✔ specialist_error: 0`);
  }

  // 5) C3 e C4 de hoje.
  const synthHoje = await countSince('profile_synthesis', 'updated_at', fromISO);
  const briefHoje = await countSince('profile_cross_brief', 'updated_at', fromISO);
  console.log(`\nprofile_synthesis (C3) gravadas hoje : ${synthHoje}`);
  console.log(`profile_cross_brief (C4) gravados hoje: ${briefHoje}`);

  // Veredicto final.
  const semAtividade = matHoje === 0 && anHoje === 0 && synthHoje === 0 && (scraped ?? []).length === 0;
  console.log('\n=== RESULTADO ===');
  if (problems.length) {
    console.log('✗ ERROS DETECTADOS:');
    for (const p of problems) console.log(`    - ${p}`);
    process.exitCode = 1;
  } else if (semAtividade) {
    console.log('⚠ SEM atividade hoje (nada raspado/analisado). O cron rodou? Veja os logs do servidor.');
  } else {
    console.log('✔ Rodou e sem erros no banco. (Erros de runtime que nao chegam ao banco — ex.: cron que');
    console.log('  nem disparou, ou webhook que retornou 500 — so aparecem nos LOGS do servidor.)');
  }
}

main().catch((e) => {
  console.error('check-today falhou:', e instanceof Error ? e.message : e);
  process.exit(1);
});
