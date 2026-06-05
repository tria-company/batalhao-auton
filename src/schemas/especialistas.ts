import { z } from 'zod';
import { ctaEnum, provaMostradaEnum, tipoGanchoEnum, tresNiveisEnum } from './common';

/**
 * Schemas de saida dos 4 especialistas de formato (Camada 2 — PRD §6).
 * Cada um = universais "criativos" + campos especificos.
 */

// --- Agente 2 · ESPECIALISTA IMAGEM (IG estatico) ---
export const imagemOutputSchema = z.object({
  gancho_principal_texto: z.string(), // <=80c
  tipo_gancho: tipoGanchoEnum,
  promessa_central: z.string(), // <=140c
  prova_mostrada: provaMostradaEnum,
  estrutura: z.enum(['lista', 'tutorial', 'comparativo', 'storytelling', 'misto']),
  cta: ctaEnum,
  gancho_visual: z.enum([
    'antes_depois',
    'citacao',
    'dado',
    'meme',
    'retrato',
    'infografico',
    'bastidor',
    'ilustracao',
    'outro',
  ]),
  composicao: z.enum(['limpa', 'caotica', 'texto_pesado', 'minimalista']),
  texto_sobreposto_ratio: z.number().min(0).max(1),
});
export type ImagemOutput = z.infer<typeof imagemOutputSchema>;

// --- Agente 3 · ESPECIALISTA CARROSSEL/SLIDESHOW (IG + TT) ---
export const carrosselOutputSchema = z.object({
  gancho_principal_texto: z.string(), // texto literal do slide 1
  tipo_gancho: tipoGanchoEnum,
  promessa_central: z.string(),
  prova_mostrada: provaMostradaEnum,
  estrutura: z.enum(['lista', 'tutorial', 'comparativo', 'storytelling', 'misto']),
  cta: ctaEnum,
  arco_narrativo: z.enum([
    'problema_solucao',
    'lista_itens',
    'passo_a_passo',
    'mito_verdade',
    'comparativo',
    'storytelling',
  ]),
  n_slides: z.number().int().min(1),
  slide_payoff: z.number().int().min(1),
  n_claims: z.number().int().min(0),
  qualidade_design: tresNiveisEnum,
  consistencia_visual: tresNiveisEnum,
});
export type CarrosselOutput = z.infer<typeof carrosselOutputSchema>;

// --- Agente 4 · ESPECIALISTA VIDEO CURTO (Reel + TT + YT Short <=90s) ---
export const videoCurtoOutputSchema = z.object({
  gancho_principal_texto: z.string(),
  tipo_gancho: tipoGanchoEnum,
  promessa_central: z.string(),
  prova_mostrada: provaMostradaEnum,
  estrutura: z.enum(['talking_head', 'cenas_misturadas', 'tela_dividida', 'tutorial', 'bastidor']),
  cta: ctaEnum,
  gancho_3s: z.string(), // o que ABRE o video (<=200c)
  ritmo: z.enum(['lento', 'medio', 'rapido']),
  densidade_corte: z.enum(['baixa', 'media', 'alta']),
  densidade_jargao: z.enum(['leigo', 'misto', 'tecnico']),
  som_origem: z.enum(['original', 'trending', 'remix', 'silent']).nullable(), // TT-only
  loop_potencial: z.enum(['alto', 'medio', 'baixo']),
});
export type VideoCurtoOutput = z.infer<typeof videoCurtoOutputSchema>;

// --- Agente 5 · ESPECIALISTA VIDEO LONGO (YT >90s) ---
export const videoLongoOutputSchema = z.object({
  gancho_principal_texto: z.string(), // primeiros 80c do titulo
  tipo_gancho: tipoGanchoEnum,
  promessa_central: z.string(),
  prova_mostrada: provaMostradaEnum,
  estrutura: z.enum(['talking_head', 'entrevista', 'tutorial', 'mesa_redonda', 'bastidor']),
  cta: ctaEnum,
  titulo_seo_score: tresNiveisEnum,
  titulo_padrao: z.enum(['pergunta', 'listagem', 'claim', 'tutorial', 'entrevista']),
  thumb_clickability: tresNiveisEnum,
  evergreen_vs_hype: z.enum(['evergreen', 'hype', 'misto']),
  densidade_jargao: z.enum(['leigo', 'misto', 'tecnico']),
  gancho_3s: z.string(), // descricao inferida
});
export type VideoLongoOutput = z.infer<typeof videoLongoOutputSchema>;

/** Uniao das saidas possiveis dos especialistas. */
export type EspecialistaOutput =
  | ImagemOutput
  | CarrosselOutput
  | VideoCurtoOutput
  | VideoLongoOutput;
