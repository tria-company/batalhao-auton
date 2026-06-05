import type { Platform } from '../config';
import type { PostAnalysis, RawPost } from '../domain';
import { getSupabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { organizadorOutputSchema, type OrganizadorOutput } from '../schemas/organizador';
import type { EspecialistaOutput } from '../schemas/especialistas';
import { upsertByKeys } from './upsert';

/**
 * Mapeamento ALINHADO ao schema real de `scrappers_contents` (introspectado
 * em 2026-05). Colunas reais: postid, username, platform, alttext, mediaurl
 * (jpg em storage, serve de imagem/thumb), thumbnail_url, carouselimages
 * (text[]), iscarousel, is_slideshow, duration_seconds (numeric), hashtags
 * (text[]), music_info (jsonb), *_count, posted_at, mediatype, ...
 */
const SCRAPPERS_TABLE = 'scrappers_contents';
const ORDER_COLUMN = 'posted_at';

type Row = Record<string, unknown>;

function str(row: Row, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number') return String(v);
  }
  return '';
}
function strOrNull(row: Row, ...keys: string[]): string | null {
  const s = str(row, ...keys);
  return s === '' ? null : s;
}
function num(row: Row, ...keys: string[]): number {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  }
  return 0;
}
function numOrNull(row: Row, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}
function bool(row: Row, ...keys: string[]): boolean {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v === 'true' || v === '1';
  }
  return false;
}
function strArr(row: Row, ...keys: string[]): string[] {
  for (const k of keys) {
    const v = row[k];
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
  }
  return [];
}

/** Mapeia 1 linha de scrappers_contents para o RawPost do pipeline. */
export function mapRawRow(row: Row, platform: Platform, username: string): RawPost {
  return {
    platform,
    username,
    postid: str(row, 'postid', 'video_id', 'id'),
    alttext: str(row, 'alttext'),
    description: strOrNull(row, 'description'),
    hashtags: strArr(row, 'hashtags'),
    mediatype: strOrNull(row, 'mediatype'),
    iscarousel: bool(row, 'iscarousel') || bool(row, 'is_slideshow'),
    duration_seconds: numOrNull(row, 'duration_seconds'),
    // mediaurl em scrappers_contents e um .jpg no storage (serve de imagem e de thumb)
    mediaurl: strOrNull(row, 'mediaurl', 'thumbnail_url'),
    thumbnail: strOrNull(row, 'thumbnail_url', 'mediaurl'),
    videourl: strOrNull(row, 'videourl'),
    posturl: strOrNull(row, 'posturl'),
    n_slides: numOrNull(row, 'n_slides') ?? (strArr(row, 'carouselimages').length || null),
    carouselimages: strArr(row, 'carouselimages'),
    music_info: (row['music_info'] ?? null) as Record<string, unknown> | null,
    posted_at: strOrNull(row, 'posted_at', 'created_at'),
    metrics: {
      likes_count: num(row, 'likes_count'),
      views_count: num(row, 'views_count', 'plays_count'),
      shares_count: num(row, 'shares_count', 'reshares_count'),
      saves_count: num(row, 'saves_count'),
      comments_count: num(row, 'comments_count'),
    },
  };
}

/** Le os top-N posts de (perfil, rede) de scrappers_contents (mais recentes). */
export async function getTopPosts(
  platform: Platform,
  username: string,
  limit: number,
): Promise<RawPost[]> {
  const sb = getSupabase();
  const base = () =>
    sb.from(SCRAPPERS_TABLE).select('*').eq('platform', platform).eq('username', username).limit(limit);

  let { data, error } = await base().order(ORDER_COLUMN, { ascending: false });
  if (error) {
    logger.warn(`getTopPosts: ordenacao por ${ORDER_COLUMN} falhou, lendo sem ordenar`, {
      error: error.message,
    });
    ({ data, error } = await base());
  }
  if (error) throw new Error(`Erro lendo ${SCRAPPERS_TABLE}: ${error.message}`);
  return (data ?? []).map((r) => mapRawRow(r as Row, platform, username));
}

/**
 * Monta a linha de post_analysis no SCHEMA REAL. Campos do especialista que
 * NAO tem coluna dedicada (composicao, texto_sobreposto_ratio, loop_potencial,
 * titulo_seo_score, titulo_padrao, thumb_clickability, evergreen_vs_hype,
 * densidade_corte textual) vao para `raw_outputs` — sem ALTER na tabela.
 */
export function buildPostAnalysisRow(
  raw: RawPost,
  analysis: PostAnalysis,
  audit: { model: string | null; costUsd: number },
): { keys: Record<string, unknown>; row: Record<string, unknown> } {
  const spec = (analysis.specialist ?? {}) as Record<string, unknown>;
  const semColuna = {
    composicao: spec['composicao'] ?? null,
    texto_sobreposto_ratio: spec['texto_sobreposto_ratio'] ?? null,
    loop_potencial: spec['loop_potencial'] ?? null,
    titulo_seo_score: spec['titulo_seo_score'] ?? null,
    titulo_padrao: spec['titulo_padrao'] ?? null,
    thumb_clickability: spec['thumb_clickability'] ?? null,
    evergreen_vs_hype: spec['evergreen_vs_hype'] ?? null,
    densidade_corte_qualitativa: spec['densidade_corte'] ?? null, // coluna real e numeric
  };

  return {
    keys: { platform: raw.platform, postid: raw.postid },
    row: {
      username: raw.username,
      // Organizador (todas as 9 colunas existem na tabela real)
      ...analysis.organizador,
      // Especialista -> colunas reais
      gancho_legenda_80c: spec['gancho_principal_texto'] ?? null,
      tipo_gancho: spec['tipo_gancho'] ?? null,
      promessa_central: spec['promessa_central'] ?? null,
      prova_mostrada: spec['prova_mostrada'] ?? null,
      estrutura: spec['estrutura'] ?? null,
      cta: spec['cta'] ?? null,
      gancho_visual: spec['gancho_visual'] ?? null,
      arco_narrativo: spec['arco_narrativo'] ?? null,
      n_slides: spec['n_slides'] ?? null,
      slide_payoff: spec['slide_payoff'] ?? null,
      n_claims: spec['n_claims'] ?? null,
      qualidade_design: spec['qualidade_design'] ?? null,
      consistencia_visual: spec['consistencia_visual'] ?? null,
      gancho_3s: spec['gancho_3s'] ?? null,
      ritmo: spec['ritmo'] ?? null,
      densidade_jargao: spec['densidade_jargao'] ?? null,
      som_origem: spec['som_origem'] ?? null,
      // Auditoria (colunas reais)
      agentes_executados: ['organizador', analysis.specialistName].filter(Boolean),
      custo_total: audit.costUsd,
      modelo_usado: audit.model,
      raw_outputs: {
        organizador: analysis.organizador,
        specialist: analysis.specialist,
        specialist_name: analysis.specialistName,
        specialist_error: analysis.specialistError,
        transcricao: analysis.transcript,
        sem_coluna: semColuna,
      },
      updated_at: new Date().toISOString(),
    },
  };
}

/** Upsert idempotente em post_analysis por (platform, postid). */
export async function upsertPostAnalysis(built: {
  keys: Record<string, unknown>;
  row: Record<string, unknown>;
}): Promise<void> {
  await upsertByKeys('post_analysis', built.keys, built.row);
}

export interface StoredAnalysis {
  organizador: OrganizadorOutput;
  specialist: EspecialistaOutput | null;
  specialistName: string | null;
  specialistError: string | null;
  transcript: string | null;
}

/** Reconstroi o Organizador a partir das COLUNAS (vale p/ linhas antigas tambem). */
function reconstructOrganizador(row: Row): OrganizadorOutput | null {
  const parsed = organizadorOutputSchema.safeParse({
    tipo: row['tipo'],
    tema_principal: row['tema_principal'],
    temas_secundarios: Array.isArray(row['temas_secundarios']) ? row['temas_secundarios'] : [],
    perfil_alvo: row['perfil_alvo'],
    nivel_tecnico: row['nivel_tecnico'],
    tom: row['tom'],
    tem_prova: row['tem_prova'] ?? false,
    tem_cta: row['tem_cta'] ?? false,
    qualidade_legenda: row['qualidade_legenda'],
  });
  return parsed.success ? parsed.data : null;
}

/**
 * Le analises ja existentes de (perfil, rede) em post_analysis, para PULAR
 * re-analise. So inclui posts cuja classificacao reconstroi como valida
 * (senao serao reanalisados). Posts que falharam de vez nao tem linha -> nao
 * aparecem aqui -> serao reanalisados.
 */
export async function getExistingAnalyses(
  platform: Platform,
  username: string,
): Promise<Map<string, StoredAnalysis>> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('post_analysis')
    .select(
      'postid, tipo, tema_principal, temas_secundarios, perfil_alvo, nivel_tecnico, tom, tem_prova, tem_cta, qualidade_legenda, specialist_error, raw_outputs',
    )
    .eq('platform', platform)
    .eq('username', username);
  if (error) throw new Error(`Erro lendo post_analysis existente: ${error.message}`);

  const map = new Map<string, StoredAnalysis>();
  for (const r of data ?? []) {
    const row = r as Row;
    const postid = String(row['postid'] ?? '');
    if (!postid) continue;
    const organizador = reconstructOrganizador(row);
    if (!organizador) continue; // classificacao invalida -> reanalisa
    const raw = (row['raw_outputs'] ?? {}) as Record<string, unknown>;
    map.set(postid, {
      organizador,
      specialist: (raw['specialist'] as EspecialistaOutput | null) ?? null,
      specialistName: (raw['specialist_name'] as string | null) ?? null,
      specialistError:
        (raw['specialist_error'] as string | null) ?? (row['specialist_error'] as string | null) ?? null,
      transcript: (raw['transcricao'] as string | null) ?? null,
    });
  }
  return map;
}
