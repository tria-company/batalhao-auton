import type { Platform } from '../config';
import type { PostAnalysis, PostMetrics } from '../domain';
import { parseStructured, type StructuredResult } from '../lib/openai';
import { withRetry } from '../lib/retry';
import { SINTETIZADOR_PROMPT } from '../prompts';
import type { SynthesisSignals } from '../rubrics/aggregation';
import {
  sintetizadorOutputSchema,
  type SintetizadorOutput,
} from '../schemas/sintetizador';

export interface SintetizadorPostInput {
  postid: string;
  posted_at: string | null;
  metrics: PostMetrics;
  analysis: PostAnalysis;
}

export interface SintetizadorParams {
  platform: Platform;
  username: string;
  posts: SintetizadorPostInput[];
  bio_metrics: { followers_count: number; posts_count: number; is_verified: boolean };
  signals: SynthesisSignals;
}

/**
 * Agente 6 · SINTETIZADOR POR PLATAFORMA (Camada 3). Recebe ate 50 analises de
 * UMA rede + os SINAIS_CALCULADOS deterministicos e produz a identidade do
 * criador nessa rede. O LLM redige; nao recalcula os sinais.
 */
export async function runSintetizador(
  params: SintetizadorParams,
): Promise<StructuredResult<SintetizadorOutput>> {
  const user = JSON.stringify({
    platform: params.platform,
    username: params.username,
    bio_metrics: params.bio_metrics,
    SINAIS_CALCULADOS: params.signals,
    posts_analisados: params.posts.map((p) => ({
      postid: p.postid,
      posted_at: p.posted_at,
      metrics: p.metrics,
      analysis: {
        ...p.analysis.organizador,
        ...(p.analysis.specialist ?? {}),
      },
    })),
  });

  return withRetry(
    () =>
      parseStructured({
        system: SINTETIZADOR_PROMPT,
        user,
        schema: sintetizadorOutputSchema,
        schemaName: 'sintetizador_output',
      }),
    { label: 'sintetizador' },
  );
}
