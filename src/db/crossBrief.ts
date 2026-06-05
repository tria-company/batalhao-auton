import type { ConsolidadorOutput } from '../schemas/consolidador';
import { upsertByKeys } from './upsert';

/**
 * Upsert do veredicto final em profile_cross_brief (tabela NOVA — rode antes a
 * migration supabase/migrations/0002_profile_cross_brief.sql; ela nao existe
 * ainda no projeto). Idempotente por username.
 */
export async function upsertCrossBrief(params: {
  username: string;
  brief: ConsolidadorOutput;
  costTotalUsd: number;
  model: string | null;
  rawOutput: unknown;
}): Promise<void> {
  const { brief } = params;
  await upsertByKeys(
    'profile_cross_brief',
    { username: params.username },
    {
      rede_mais_escalavel: brief.rede_mais_escalavel,
      rede_dominante_hoje: brief.rede_dominante_hoje,
      coerencia_cross_plat: brief.coerencia_cross_plat,
      ajuste_auton: brief.ajuste_auton,
      recomendacao_aborda: brief.recomendacao_aborda,
      veredicto_letra: brief.veredicto_letra,
      score_embaixador: brief.score_embaixador,
      justificativa: brief.justificativa,
      gaps_oportunidade: brief.gaps_oportunidade,
      custo_total: params.costTotalUsd,
      modelo_usado: params.model,
      raw_output: params.rawOutput,
      updated_at: new Date().toISOString(),
    },
  );
}
