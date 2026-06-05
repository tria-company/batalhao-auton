import { z } from 'zod';

/** Saida do Agente 6 · SINTETIZADOR POR PLATAFORMA (Camada 3 — PRD §6). */
export const sintetizadorOutputSchema = z.object({
  posicionamento: z.string(),
  promessa_principal: z.string(),
  voz_tom: z.string(),
  publico_alvo: z.string(),
  diferencial: z.string(),
  padroes_fortes: z.object({
    formato_que_printa: z.string(), // tipo + descricao + evidencia
    tema_que_printa: z.string(),
    gancho_que_printa: z.string(),
  }),
  padroes_fracos: z.object({
    formato_que_morre: z.string(),
    tema_que_morre: z.string(),
  }),
  evolucao_narrativa: z.array(
    z.object({
      quando: z.string(),
      de: z.string(),
      para: z.string(),
      evidencia: z.string(),
    }),
  ),
  assuntos_novos: z.array(
    z.object({
      tema: z.string(),
      apareceu_em: z.string(),
      peso_atual_pct: z.number(),
    }),
  ),
  resumo_executivo: z.string(), // 5-10 linhas
});

export type SintetizadorOutput = z.infer<typeof sintetizadorOutputSchema>;
