import { describe, expect, it } from 'vitest';
import {
  alcancePts,
  autoridadePts,
  coerenciaPts,
  computeScore,
  deriveFit,
  deriveRecomendacao,
  deriveRecorrencia,
  engajamentoPts,
  fitPts,
  letterFromScore,
  recorrenciaPts,
} from '../src/rubrics/score';

describe('letterFromScore — faixas do PRD', () => {
  it('mapeia score -> letra (S=90+, A=75-89, B=60-74, C=45-59, D<45)', () => {
    expect(letterFromScore(95)).toBe('S');
    expect(letterFromScore(90)).toBe('S');
    expect(letterFromScore(89)).toBe('A');
    expect(letterFromScore(75)).toBe('A');
    expect(letterFromScore(74)).toBe('B');
    expect(letterFromScore(60)).toBe('B');
    expect(letterFromScore(59)).toBe('C');
    expect(letterFromScore(45)).toBe('C');
    expect(letterFromScore(44)).toBe('D');
    expect(letterFromScore(0)).toBe('D');
  });
});

describe('ancoras dos criterios (PRD §6)', () => {
  it('alcance: 100k=10, 1M=15, 10M=20', () => {
    expect(alcancePts(100_000)).toBeCloseTo(10, 5);
    expect(alcancePts(1_000_000)).toBeCloseTo(15, 5);
    expect(alcancePts(10_000_000)).toBeCloseTo(20, 5);
    expect(alcancePts(0)).toBe(0);
  });
  it('engajamento: 3%=10, 7%=15, >10%=20', () => {
    expect(engajamentoPts(0.03)).toBeCloseTo(10, 5);
    expect(engajamentoPts(0.07)).toBeCloseTo(15, 5);
    expect(engajamentoPts(0.1)).toBeCloseTo(20, 5);
    expect(engajamentoPts(0.5)).toBe(20);
    expect(engajamentoPts(0)).toBe(0);
  });
  it('autoridade: tecnico=1.0, intermediario=0.5, sem prova zera', () => {
    expect(autoridadePts(1, 0, 1)).toBe(25); // todo tecnico + prova
    expect(autoridadePts(0, 1, 1)).toBeCloseTo(12.5, 5); // todo intermediario + prova = metade
    expect(autoridadePts(0, 1, 0)).toBe(0); // sem prova zera
    expect(autoridadePts(0, 0, 1)).toBe(0); // sem conteudo tecnico zera
  });
  it('coerencia/fit/recorrencia: pesos do PRD', () => {
    expect(coerenciaPts('alta')).toBe(15);
    expect(coerenciaPts('media')).toBe(8);
    expect(coerenciaPts('baixa')).toBe(3);
    expect(fitPts('sim')).toBe(10);
    expect(fitPts('parcial')).toBe(5);
    expect(fitPts('nao')).toBe(0);
    expect(recorrenciaPts('constante')).toBe(10);
    expect(recorrenciaPts('esporadico')).toBe(5);
    expect(recorrenciaPts('dormente')).toBe(0);
  });
});

describe('deriveFit / deriveRecorrencia', () => {
  it('tema funcional core -> sim; saude ampla -> parcial; outros -> nao', () => {
    expect(deriveFit('microbiota')).toBe('sim');
    expect(deriveFit('nutricao')).toBe('parcial');
    expect(deriveFit('outros')).toBe('nao');
    expect(deriveFit(null)).toBe('nao');
  });
  it('recorrencia por posts_30d', () => {
    expect(deriveRecorrencia(12)).toBe('constante');
    expect(deriveRecorrencia(5)).toBe('esporadico');
    expect(deriveRecorrencia(2)).toBe('dormente');
  });
});

describe('deriveRecomendacao — "sim" so com score>=70 E coerencia>=media E fit>=parcial', () => {
  it('aplica a regra do PRD', () => {
    expect(deriveRecomendacao(80, 'alta', 'sim')).toBe('sim');
    expect(deriveRecomendacao(80, 'media', 'parcial')).toBe('sim');
    expect(deriveRecomendacao(80, 'baixa', 'sim')).toBe('esperar'); // coerencia baixa
    expect(deriveRecomendacao(80, 'alta', 'nao')).toBe('esperar'); // fit nao
    expect(deriveRecomendacao(69, 'alta', 'sim')).toBe('esperar'); // score < 70
    expect(deriveRecomendacao(40, 'baixa', 'nao')).toBe('nao');
  });
});

describe('computeScore — soma, letra e recomendacao consistentes', () => {
  it('perfil "S": autoridade alta + 10M + 12% eng + coerencia alta + fit sim + constante', () => {
    const r = computeScore({
      freqTecnico: 1,
      freqIntermediario: 0,
      freqProva: 1,
      followersTotal: 10_000_000,
      engRate: 0.12,
      coerencia: 'alta',
      fit: 'sim',
      recorrencia: 'constante',
    });
    // 25 + 20 + 20 + 15 + 10 + 10 = 100
    expect(r.score).toBe(100);
    expect(r.letra).toBe('S');
    expect(r.recomendacao).toBe('sim');
  });

  it('perfil fraco: tudo no piso -> D e nao', () => {
    const r = computeScore({
      freqTecnico: 0,
      freqIntermediario: 0,
      freqProva: 0,
      followersTotal: 100,
      engRate: 0,
      coerencia: 'baixa',
      fit: 'nao',
      recorrencia: 'dormente',
    });
    expect(r.score).toBeLessThan(45);
    expect(r.letra).toBe('D');
    expect(r.recomendacao).toBe('nao');
  });

  it('a letra SEMPRE bate a faixa do score (invariante do PRD §13)', () => {
    const r = computeScore({
      freqTecnico: 0.5,
      freqIntermediario: 0,
      freqProva: 0.5,
      followersTotal: 500_000,
      engRate: 0.05,
      coerencia: 'media',
      fit: 'parcial',
      recorrencia: 'esporadico',
    });
    expect(r.letra).toBe(letterFromScore(r.score));
  });
});
