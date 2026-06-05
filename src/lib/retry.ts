import { logger } from './logger';

/**
 * Retry simples. PRD §9: "1 retry com temperature=0 quando o JSON volta
 * invalido". Como o pipeline ja chama o LLM com temperature=0 e Structured
 * Outputs (schema garantido pela API), o retry cobre erros de rede/refusal
 * e qualquer falha de parse residual.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; label?: string } = {},
): Promise<T> {
  const retries = opts.retries ?? 1;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        logger.warn(`retry ${attempt + 1}/${retries}${opts.label ? ` (${opts.label})` : ''}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  throw lastErr;
}
