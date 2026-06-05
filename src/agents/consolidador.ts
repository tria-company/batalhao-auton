import type { Platform } from '../config';
import type { PlatformMetrics } from '../domain';
import { parseStructured, type StructuredResult } from '../lib/openai';
import { withRetry } from '../lib/retry';
import { CONSOLIDADOR_PROMPT } from '../prompts';
import {
  consolidadorOutputSchema,
  type ConsolidadorOutput,
} from '../schemas/consolidador';
import type { SintetizadorOutput } from '../schemas/sintetizador';

export interface ConsolidadorParams {
  username: string;
  sinteses: Partial<Record<Platform, SintetizadorOutput>>;
  metricas_agregadas: {
    followers_total: number;
  } & Partial<Record<Platform, PlatformMetrics>>;
}

/**
 * Agente 7 · CONSOLIDADOR CROSS-PLATFORM (Camada 4). Recebe as 3 sinteses +
 * metricas e emite os campos qualitativos do veredicto. ATENCAO: score, letra
 * e recomendacao finais sao RECALCULADOS em codigo pelo orquestrador
 * (src/rubrics/score.ts) e sobrescrevem o que o LLM devolver aqui.
 */
export async function runConsolidador(
  params: ConsolidadorParams,
): Promise<StructuredResult<ConsolidadorOutput>> {
  const user = JSON.stringify({
    username: params.username,
    sinteses: params.sinteses,
    metricas_agregadas: params.metricas_agregadas,
  });

  return withRetry(
    () =>
      parseStructured({
        system: CONSOLIDADOR_PROMPT,
        user,
        schema: consolidadorOutputSchema,
        schemaName: 'consolidador_output',
      }),
    { label: 'consolidador' },
  );
}
