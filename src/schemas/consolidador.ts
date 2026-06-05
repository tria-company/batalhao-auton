import { z } from 'zod';
import { platformEnum, tresNiveisEnum } from './common';

/**
 * Saida do Agente 7 · CONSOLIDADOR CROSS-PLATFORM (Camada 4 — PRD §6).
 *
 * NOTA DE DETERMINISMO (PRD §11 / §13): o LLM produz os campos QUALITATIVOS
 * (coerencia_cross_plat, ajuste_auton, redes, justificativa, gaps). Os campos
 * `score_embaixador`, `veredicto_letra` e `recomendacao_aborda` sao
 * RECALCULADOS em codigo pela rubrica deterministica (src/rubrics/score.ts) e
 * sobrescritos — garantindo que "a letra sempre bate a faixa". O schema mantem
 * todos os campos do PRD; o LLM pode preenche-los, mas o codigo tem a palavra
 * final nos 3 campos deterministicos.
 */
export const consolidadorOutputSchema = z.object({
  rede_mais_escalavel: platformEnum,
  rede_dominante_hoje: platformEnum,
  coerencia_cross_plat: tresNiveisEnum,
  ajuste_auton: z.string(), // 2-3 frases sobre fit com avatar Camila
  recomendacao_aborda: z.enum(['sim', 'esperar', 'nao']),
  veredicto_letra: z.enum(['S', 'A', 'B', 'C', 'D']),
  score_embaixador: z.number().int().min(0).max(100),
  justificativa: z.string(), // 3-5 frases com numeros
  gaps_oportunidade: z.array(
    z.object({
      rede: platformEnum,
      lacuna: z.string(),
      acao: z.string(),
    }),
  ),
});

export type ConsolidadorOutput = z.infer<typeof consolidadorOutputSchema>;
