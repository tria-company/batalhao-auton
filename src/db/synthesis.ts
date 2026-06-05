import type { Platform } from '../config';
import { PLATFORMS } from '../config';
import { getSupabase } from '../lib/supabase';
import type { SynthesisSignals } from '../rubrics/aggregation';
import type { SintetizadorOutput } from '../schemas/sintetizador';
import { upsertByKeys } from './upsert';

/**
 * Upsert da sintese por (perfil, rede) no SCHEMA REAL de profile_synthesis,
 * que e FLAT: colunas formato/tema/gancho_que_printa, formato/tema_que_morre,
 * etc. Os campos ricos (evolucao_narrativa, assuntos_novos, padroes completos)
 * vao para `raw_synthesis` jsonb — sem ALTER na tabela.
 */
export async function upsertProfileSynthesis(params: {
  platform: Platform;
  username: string;
  synthesis: SintetizadorOutput;
  signals: SynthesisSignals;
  postsAnalisados: number;
  model: string | null;
  costUsd: number;
}): Promise<void> {
  const { synthesis } = params;
  await upsertByKeys(
    'profile_synthesis',
    { platform: params.platform, username: params.username },
    {
      posicionamento: synthesis.posicionamento,
      promessa_principal: synthesis.promessa_principal,
      voz_tom: synthesis.voz_tom,
      publico_alvo: synthesis.publico_alvo,
      diferencial: synthesis.diferencial,
      formato_que_printa: synthesis.padroes_fortes.formato_que_printa,
      tema_que_printa: synthesis.padroes_fortes.tema_que_printa,
      gancho_que_printa: synthesis.padroes_fortes.gancho_que_printa,
      formato_que_morre: synthesis.padroes_fracos.formato_que_morre,
      tema_que_morre: synthesis.padroes_fracos.tema_que_morre,
      resumo_executivo: synthesis.resumo_executivo,
      posts_analisados: params.postsAnalisados,
      custo_total: params.costUsd,
      modelo_usado: params.model,
      raw_synthesis: { synthesis, sinais_calculados: params.signals },
      updated_at: new Date().toISOString(),
    },
  );
}

/** INSERTs em profile_narrative_shifts (colunas reais: de_discurso/para_discurso). */
export async function insertNarrativeShifts(params: {
  platform: Platform;
  username: string;
  synthesis: SintetizadorOutput;
}): Promise<void> {
  const rows = params.synthesis.evolucao_narrativa.map((e) => ({
    platform: params.platform,
    username: params.username,
    quando: e.quando,
    de_discurso: e.de,
    para_discurso: e.para,
    evidencia: e.evidencia,
  }));
  if (rows.length === 0) return;
  const sb = getSupabase();
  const { error } = await sb.from('profile_narrative_shifts').insert(rows);
  if (error) throw new Error(`Erro inserindo profile_narrative_shifts: ${error.message}`);
}

/** Carrega sinteses ja gravadas (reconstruidas de raw_synthesis), por rede. */
export async function getSyntheses(
  username: string,
): Promise<Partial<Record<Platform, SintetizadorOutput>>> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('profile_synthesis')
    .select('platform, raw_synthesis')
    .eq('username', username);
  if (error) throw new Error(`Erro lendo profile_synthesis: ${error.message}`);

  const out: Partial<Record<Platform, SintetizadorOutput>> = {};
  for (const r of data ?? []) {
    const row = r as { platform?: string; raw_synthesis?: { synthesis?: SintetizadorOutput } };
    const platform = row.platform as Platform;
    if (!PLATFORMS.includes(platform)) continue;
    if (row.raw_synthesis?.synthesis) out[platform] = row.raw_synthesis.synthesis;
  }
  return out;
}
