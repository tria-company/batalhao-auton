import { describe, expect, it } from 'vitest';
import { assertGuards, resolveSpecialist, routeSpecialist } from '../src/agents/especialistas';
import { AgentGuardError } from '../src/agents/errors';
import type { Platform } from '../src/config';
import type { RawPost } from '../src/domain';

function fixture(p: Partial<RawPost> & { platform: Platform }): RawPost {
  return {
    platform: p.platform,
    username: p.username ?? 'creator',
    postid: p.postid ?? 'p1',
    alttext: p.alttext ?? '',
    description: p.description ?? null,
    hashtags: p.hashtags ?? [],
    mediatype: p.mediatype ?? null,
    iscarousel: p.iscarousel ?? false,
    duration_seconds: p.duration_seconds ?? null,
    mediaurl: p.mediaurl ?? null,
    thumbnail: p.thumbnail ?? null,
    videourl: p.videourl ?? null,
    posturl: p.posturl ?? null,
    n_slides: p.n_slides ?? null,
    carouselimages: p.carouselimages ?? [],
    music_info: p.music_info ?? null,
    posted_at: p.posted_at ?? null,
    metrics: p.metrics ?? {
      likes_count: 0,
      views_count: 0,
      shares_count: 0,
      saves_count: 0,
      comments_count: 0,
    },
  };
}

describe('routeSpecialist — match(tipo) do PRD §5', () => {
  it('mapeia cada tipo ao especialista certo', () => {
    expect(routeSpecialist('imagem')).toBe('imagem');
    expect(routeSpecialist('carrossel')).toBe('carrossel');
    expect(routeSpecialist('slideshow')).toBe('carrossel');
    expect(routeSpecialist('video_curto')).toBe('video_curto');
    expect(routeSpecialist('video_longo')).toBe('video_longo');
  });
});

describe('assertGuards — guardas deterministicas (PRD §6)', () => {
  it('imagem fora do Instagram -> platform_not_supported', () => {
    expect(() => assertGuards('imagem', fixture({ platform: 'tiktok' }))).toThrowError(
      AgentGuardError,
    );
    try {
      assertGuards('imagem', fixture({ platform: 'youtube' }));
    } catch (e) {
      expect((e as AgentGuardError).code).toBe('platform_not_supported');
    }
    expect(() => assertGuards('imagem', fixture({ platform: 'instagram' }))).not.toThrow();
  });

  it('carrossel fora de IG/TT -> wrong_format', () => {
    try {
      assertGuards('carrossel', fixture({ platform: 'youtube' }));
    } catch (e) {
      expect((e as AgentGuardError).code).toBe('wrong_format');
    }
    expect(() => assertGuards('carrossel', fixture({ platform: 'instagram' }))).not.toThrow();
    expect(() => assertGuards('carrossel', fixture({ platform: 'tiktok' }))).not.toThrow();
  });

  it('video_curto com duration>90 -> too_long', () => {
    try {
      assertGuards('video_curto', fixture({ platform: 'tiktok', duration_seconds: 120 }));
    } catch (e) {
      expect((e as AgentGuardError).code).toBe('too_long');
    }
    expect(() =>
      assertGuards('video_curto', fixture({ platform: 'tiktok', duration_seconds: 45 })),
    ).not.toThrow();
  });

  it('video_longo: aceita QUALQUER rede (com transcricao de audio)', () => {
    // Apos a feature de transcricao, video longo roda em IG/TikTok/YouTube.
    expect(() =>
      assertGuards('video_longo', fixture({ platform: 'instagram', duration_seconds: 600 })),
    ).not.toThrow();
    expect(() =>
      assertGuards('video_longo', fixture({ platform: 'tiktok', duration_seconds: 300 })),
    ).not.toThrow();
    expect(() =>
      assertGuards('video_longo', fixture({ platform: 'youtube', duration_seconds: 1200 })),
    ).not.toThrow();
  });
});

describe('resolveSpecialist — roteia video por duracao', () => {
  it('video por duracao: >90s -> longo, <=90s -> curto', () => {
    expect(resolveSpecialist('video_curto', 120)).toBe('video_longo'); // corrige classificacao
    expect(resolveSpecialist('video_longo', 30)).toBe('video_curto');
    expect(resolveSpecialist('video_curto', 45)).toBe('video_curto');
    expect(resolveSpecialist('imagem', null)).toBe('imagem');
    expect(resolveSpecialist('carrossel', null)).toBe('carrossel');
  });
});
