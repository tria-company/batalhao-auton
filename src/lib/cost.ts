import { config } from '../config';

/**
 * Precos de tabela GPT-4.1 mini (OpenAI, abr/2025) — PRD §10.1.
 * USD por 1.000.000 de tokens.
 */
export const PRICING = {
  inputPerMTok: 0.4,
  cachedInputPerMTok: 0.1,
  outputPerMTok: 1.6,
} as const;

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  /** Subconjunto de promptTokens servido de cache (cobrado mais barato). */
  cachedTokens?: number;
}

/** Custo em USD de uma chamada, a partir do uso de tokens. */
export function usdCost(usage: Usage): number {
  const cached = usage.cachedTokens ?? 0;
  const billedInput = Math.max(0, usage.promptTokens - cached);
  return (
    (billedInput / 1_000_000) * PRICING.inputPerMTok +
    (cached / 1_000_000) * PRICING.cachedInputPerMTok +
    (usage.completionTokens / 1_000_000) * PRICING.outputPerMTok
  );
}

/** Converte USD -> BRL (apenas para exibicao; ver config.usdBrlRate). */
export function usdToBrl(usd: number, rate: number = config.usdBrlRate): number {
  return usd * rate;
}
