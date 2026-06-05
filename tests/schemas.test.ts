import { describe, expect, it } from 'vitest';
import { organizadorOutputSchema } from '../src/schemas/organizador';
import { videoCurtoOutputSchema } from '../src/schemas/especialistas';
import { consolidadorOutputSchema } from '../src/schemas/consolidador';

describe('organizadorOutputSchema', () => {
  const valid = {
    tipo: 'video_curto',
    tema_principal: 'jejum',
    temas_secundarios: ['microbiota'],
    perfil_alvo: 'ambos',
    nivel_tecnico: 'tecnico',
    tom: 'autoridade',
    tem_prova: true,
    tem_cta: false,
    qualidade_legenda: 'alta',
  };

  it('aceita output valido', () => {
    expect(organizadorOutputSchema.safeParse(valid).success).toBe(true);
  });

  it('rejeita tema fora do enum (No Invention)', () => {
    const bad = { ...valid, tema_principal: 'biohacking_inventado' };
    expect(organizadorOutputSchema.safeParse(bad).success).toBe(false);
  });

  it('rejeita mais de 3 temas secundarios', () => {
    const bad = { ...valid, temas_secundarios: ['microbiota', 'sono', 'detox', 'jejum'] };
    expect(organizadorOutputSchema.safeParse(bad).success).toBe(false);
  });
});

describe('videoCurtoOutputSchema', () => {
  it('som_origem aceita null (TT-only)', () => {
    const r = videoCurtoOutputSchema.safeParse({
      gancho_principal_texto: 'x',
      tipo_gancho: 'pergunta',
      promessa_central: 'y',
      prova_mostrada: 'nenhuma',
      estrutura: 'talking_head',
      cta: 'nenhum',
      gancho_3s: 'abre com pergunta',
      ritmo: 'rapido',
      densidade_corte: 'alta',
      densidade_jargao: 'leigo',
      som_origem: null,
      loop_potencial: 'alto',
    });
    expect(r.success).toBe(true);
  });
});

describe('consolidadorOutputSchema', () => {
  it('valida veredicto completo', () => {
    const r = consolidadorOutputSchema.safeParse({
      rede_mais_escalavel: 'instagram',
      rede_dominante_hoje: 'youtube',
      coerencia_cross_plat: 'alta',
      ajuste_auton: 'fit forte',
      recomendacao_aborda: 'sim',
      veredicto_letra: 'A',
      score_embaixador: 84,
      justificativa: '3 frases com numeros',
      gaps_oportunidade: [{ rede: 'tiktok', lacuna: 'ausente', acao: 'convidar' }],
    });
    expect(r.success).toBe(true);
  });

  it('rejeita score fora de 0..100', () => {
    const r = consolidadorOutputSchema.safeParse({
      rede_mais_escalavel: 'instagram',
      rede_dominante_hoje: 'youtube',
      coerencia_cross_plat: 'alta',
      ajuste_auton: 'x',
      recomendacao_aborda: 'sim',
      veredicto_letra: 'A',
      score_embaixador: 140,
      justificativa: 'x',
      gaps_oportunidade: [],
    });
    expect(r.success).toBe(false);
  });
});
