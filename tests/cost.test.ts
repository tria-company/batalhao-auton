import { describe, expect, it } from 'vitest';
import { PRICING, usdCost, usdToBrl } from '../src/lib/cost';

describe('usdCost — precos GPT-4.1 mini (PRD §10.1)', () => {
  it('input $0,40/M e output $1,60/M', () => {
    // 1M input + 1M output = 0.40 + 1.60 = 2.00
    expect(usdCost({ promptTokens: 1_000_000, completionTokens: 1_000_000 })).toBeCloseTo(2.0, 6);
  });

  it('tokens em cache custam $0,10/M', () => {
    // 1M input, dos quais 1M cacheado -> 0.10
    const c = usdCost({ promptTokens: 1_000_000, completionTokens: 0, cachedTokens: 1_000_000 });
    expect(c).toBeCloseTo(PRICING.cachedInputPerMTok, 6);
  });

  it('uso zero custa zero', () => {
    expect(usdCost({ promptTokens: 0, completionTokens: 0 })).toBe(0);
  });
});

describe('usdToBrl', () => {
  it('converte com a taxa informada', () => {
    expect(usdToBrl(2, 6)).toBeCloseTo(12, 6);
  });
});
