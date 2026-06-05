import { z } from 'zod';

/**
 * Enums e tipos compartilhados entre agentes — fieis ao PRD §6.
 * IMPORTANTE (Structured Outputs da OpenAI): todo campo de objeto deve ser
 * "required". Campos opcionais usam `.nullable()` (nunca `.optional()` /
 * `.default()`), senao o json_schema estrito e rejeitado.
 */

export const platformEnum = z.enum(['instagram', 'tiktok', 'youtube']);
export type Platform = z.infer<typeof platformEnum>;

// --- Organizador (9 campos universais) ---
export const tipoEnum = z.enum([
  'imagem',
  'carrossel',
  'slideshow',
  'video_curto',
  'video_longo',
]);
export type Tipo = z.infer<typeof tipoEnum>;

export const temaPrincipalEnum = z.enum([
  'jejum',
  'microbiota',
  'inflamacao',
  'hormonios',
  'saude_mental',
  'neurologia',
  'obesidade',
  'suplementacao',
  'nutricao',
  'exercicio',
  'sono',
  'longevidade',
  'detox',
  'autoimune',
  'intestino',
  'metabolismo',
  'outros',
]);
export type TemaPrincipal = z.infer<typeof temaPrincipalEnum>;

export const perfilAlvoEnum = z.enum(['paciente_final', 'profissional_saude', 'ambos']);
export const nivelTecnicoEnum = z.enum(['leigo', 'intermediario', 'tecnico']);
export const tomEnum = z.enum(['educativo', 'provocativo', 'acolhedor', 'autoridade', 'pessoal']);
export const tresNiveisEnum = z.enum(['alta', 'media', 'baixa']);

// --- Universais "criativos" dos especialistas ---
export const tipoGanchoEnum = z.enum([
  'pergunta',
  'claim',
  'numero',
  'historia',
  'aviso',
  'listagem',
  'curiosidade',
]);
export const provaMostradaEnum = z.enum([
  'credencial',
  'estudo',
  'cliente',
  'pessoal',
  'nenhuma',
]);
export const ctaEnum = z.enum(['comentario', 'salvar', 'compartilhar', 'clique_bio', 'nenhum']);
