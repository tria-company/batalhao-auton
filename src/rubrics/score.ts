import type { TemaPrincipal } from '../schemas/common';

/**
 * Rubrica de score DETERMINISTICA do Consolidador (Agente 7 — PRD §6).
 * Total 100 pts: Autoridade 25 · Alcance 20 · Engajamento 20 · Coerencia 15 ·
 * Fit Auton 10 · Recorrencia 10. A letra SEMPRE deriva do score (PRD §13).
 *
 * O PRD da os criterios e ancoras; as formulas intermediarias abaixo sao
 * interpretacoes documentadas e ajustaveis (constantes no topo de cada fn).
 */

export type Coerencia = 'alta' | 'media' | 'baixa';
export type Fit = 'sim' | 'parcial' | 'nao';
export type Recorrencia = 'constante' | 'esporadico' | 'dormente';
export type Letra = 'S' | 'A' | 'B' | 'C' | 'D';
export type Recomendacao = 'sim' | 'esperar' | 'nao';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Autoridade tecnica (25). PRD: freq(nivel_tecnico=tecnico) x freq(tem_prova).
 * DESVIO DOCUMENTADO: damos credito PARCIAL ao conteudo `intermediario`
 * (peso 0,5), porque medico que explica de forma acessivel COM prova ainda e
 * autoridade — senao todo criador "intermediario" zera. `tecnico` vale 1,0.
 */
export function autoridadePts(
  freqTecnico: number,
  freqIntermediario: number,
  freqProva: number,
): number {
  const tech = clamp(freqTecnico + 0.5 * freqIntermediario, 0, 1);
  return clamp(tech * freqProva, 0, 1) * 25;
}

/** Alcance (20): log10(followers): 100k=10, 1M=15, 10M=20. */
export function alcancePts(followersTotal: number): number {
  if (followersTotal <= 1) return 0;
  return clamp(Math.log10(followersTotal) * 5 - 15, 0, 20);
}

/** Engajamento (20): eng_rate (fracao) vs benchmark 3%=10, 7%=15, >10%=20. */
export function engajamentoPts(engRate: number): number {
  const pct = engRate * 100;
  if (pct <= 0) return 0;
  if (pct <= 3) return (pct / 3) * 10;
  if (pct <= 7) return 10 + ((pct - 3) / 4) * 5;
  if (pct <= 10) return 15 + ((pct - 7) / 3) * 5;
  return 20;
}

/** Coerencia cross-plat (15): alta=15 · media=8 · baixa=3. */
export function coerenciaPts(c: Coerencia): number {
  return c === 'alta' ? 15 : c === 'media' ? 8 : 3;
}

/** Fit Auton (10): sim=10 · parcial=5 · nao=0. */
export function fitPts(f: Fit): number {
  return f === 'sim' ? 10 : f === 'parcial' ? 5 : 0;
}

/** Recorrencia (10): constante=10 · esporadico=5 · dormente=0. */
export function recorrenciaPts(r: Recorrencia): number {
  return r === 'constante' ? 10 : r === 'esporadico' ? 5 : 0;
}

/** Letra a partir do score: S=90+ · A=75-89 · B=60-74 · C=45-59 · D<45. */
export function letterFromScore(score: number): Letra {
  if (score >= 90) return 'S';
  if (score >= 75) return 'A';
  if (score >= 60) return 'B';
  if (score >= 45) return 'C';
  return 'D';
}

/** Temas considerados "funcionais/integrativos" (fit forte com a Auton). */
const FUNCIONAL_CORE: ReadonlySet<TemaPrincipal> = new Set<TemaPrincipal>([
  'jejum',
  'microbiota',
  'inflamacao',
  'hormonios',
  'longevidade',
  'autoimune',
  'intestino',
  'metabolismo',
  'detox',
]);
const SAUDE_AMPLA: ReadonlySet<TemaPrincipal> = new Set<TemaPrincipal>([
  'nutricao',
  'suplementacao',
  'exercicio',
  'sono',
  'saude_mental',
  'neurologia',
  'obesidade',
]);

/** Deriva o Fit Auton a partir do tema dominante do perfil. */
export function deriveFit(temaDominante: TemaPrincipal | null): Fit {
  if (temaDominante && FUNCIONAL_CORE.has(temaDominante)) return 'sim';
  if (temaDominante && SAUDE_AMPLA.has(temaDominante)) return 'parcial';
  return 'nao';
}

/** Deriva a Recorrencia a partir de posts nos ultimos 30 dias (somados nas redes). */
export function deriveRecorrencia(posts30dTotal: number): Recorrencia {
  if (posts30dTotal >= 12) return 'constante';
  if (posts30dTotal >= 3) return 'esporadico';
  return 'dormente';
}

export interface ScoreInput {
  freqTecnico: number; // 0..1
  freqIntermediario: number; // 0..1 (credito parcial na autoridade)
  freqProva: number; // 0..1
  followersTotal: number;
  engRate: number; // fracao, ex.: 0.04
  coerencia: Coerencia;
  fit: Fit;
  recorrencia: Recorrencia;
}

export interface ScoreBreakdown {
  autoridade: number;
  alcance: number;
  engajamento: number;
  coerencia: number;
  fit: number;
  recorrencia: number;
}

export interface ScoreResult {
  score: number; // inteiro 0..100
  letra: Letra;
  recomendacao: Recomendacao;
  breakdown: ScoreBreakdown;
}

/**
 * Recomendacao (PRD): "sim" SO se score>=70 E coerencia>=media E fit>=parcial.
 * Caso contrario "esperar" (>=45) ou "nao" (<45).
 */
export function deriveRecomendacao(score: number, coerencia: Coerencia, fit: Fit): Recomendacao {
  const coerenciaOk = coerencia === 'alta' || coerencia === 'media';
  const fitOk = fit === 'sim' || fit === 'parcial';
  if (score >= 70 && coerenciaOk && fitOk) return 'sim';
  if (score >= 45) return 'esperar';
  return 'nao';
}

/** Calcula score (0-100), letra e recomendacao de forma 100% deterministica. */
export function computeScore(input: ScoreInput): ScoreResult {
  const breakdown: ScoreBreakdown = {
    autoridade: autoridadePts(input.freqTecnico, input.freqIntermediario, input.freqProva),
    alcance: alcancePts(input.followersTotal),
    engajamento: engajamentoPts(input.engRate),
    coerencia: coerenciaPts(input.coerencia),
    fit: fitPts(input.fit),
    recorrencia: recorrenciaPts(input.recorrencia),
  };
  const raw =
    breakdown.autoridade +
    breakdown.alcance +
    breakdown.engajamento +
    breakdown.coerencia +
    breakdown.fit +
    breakdown.recorrencia;
  const score = clamp(Math.round(raw), 0, 100);
  return {
    score,
    letra: letterFromScore(score),
    recomendacao: deriveRecomendacao(score, input.coerencia, input.fit),
    breakdown,
  };
}
