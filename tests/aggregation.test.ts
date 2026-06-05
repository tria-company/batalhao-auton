import { describe, expect, it } from 'vitest';
import { buildSynthesisSignals, computeEngagement } from '../src/rubrics/aggregation';
import type { AnalyzedPost } from '../src/domain';
import type { OrganizadorOutput } from '../src/schemas/organizador';

function org(partial: Partial<OrganizadorOutput>): OrganizadorOutput {
  return {
    tipo: partial.tipo ?? 'imagem',
    tema_principal: partial.tema_principal ?? 'nutricao',
    temas_secundarios: partial.temas_secundarios ?? [],
    perfil_alvo: partial.perfil_alvo ?? 'paciente_final',
    nivel_tecnico: partial.nivel_tecnico ?? 'leigo',
    tom: partial.tom ?? 'educativo',
    tem_prova: partial.tem_prova ?? false,
    tem_cta: partial.tem_cta ?? false,
    qualidade_legenda: partial.qualidade_legenda ?? 'media',
  };
}

function post(p: { id: string; eng: number; when?: string; o: Partial<OrganizadorOutput> }): AnalyzedPost {
  return { postid: p.id, posted_at: p.when ?? null, engagement: p.eng, organizador: org(p.o) };
}

describe('computeEngagement', () => {
  it('IG usa interacoes/seguidores', () => {
    const e = computeEngagement(
      { likes_count: 100, views_count: 0, shares_count: 10, saves_count: 20, comments_count: 5 },
      'instagram',
      1000,
    );
    expect(e).toBeCloseTo(0.135, 5);
  });
  it('YT/TT usam views quando disponiveis', () => {
    const e = computeEngagement(
      { likes_count: 0, views_count: 5000, shares_count: 0, saves_count: 0, comments_count: 0 },
      'youtube',
      1000,
    );
    expect(e).toBeCloseTo(5, 5);
  });
});

describe('buildSynthesisSignals', () => {
  const posts: AnalyzedPost[] = [
    post({ id: '1', eng: 0.9, o: { tipo: 'video_curto', tema_principal: 'jejum' } }),
    post({ id: '2', eng: 0.8, o: { tipo: 'video_curto', tema_principal: 'jejum' } }),
    post({ id: '3', eng: 0.1, o: { tipo: 'imagem', tema_principal: 'nutricao' } }),
    post({ id: '4', eng: 0.05, o: { tipo: 'imagem', tema_principal: 'nutricao' } }),
  ];

  it('formato_que_printa = maior engajamento medio; que_morre = menor', () => {
    const s = buildSynthesisSignals(posts);
    expect(s.n_posts).toBe(4);
    expect(s.formato_que_printa?.categoria).toBe('video_curto');
    expect(s.formato_que_morre?.categoria).toBe('imagem');
    expect(s.tema_que_printa?.categoria).toBe('jejum');
    expect(s.tema_que_morre?.categoria).toBe('nutricao');
  });

  it('assuntos_novos: tema cuja primeira aparicao esta na janela de 6 meses', () => {
    const now = new Date();
    const recent = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const old = new Date(now.getFullYear() - 2, now.getMonth(), 1).toISOString();
    const s = buildSynthesisSignals([
      post({ id: 'a', eng: 0.2, when: old, o: { tema_principal: 'nutricao' } }),
      post({ id: 'b', eng: 0.5, when: recent, o: { tema_principal: 'longevidade' } }),
    ]);
    const temas = s.assuntos_novos.map((x) => x.tema);
    expect(temas).toContain('longevidade');
    expect(temas).not.toContain('nutricao');
  });

  it('nao quebra com lista vazia', () => {
    const s = buildSynthesisSignals([]);
    expect(s.n_posts).toBe(0);
    expect(s.formato_que_printa).toBeNull();
  });
});
