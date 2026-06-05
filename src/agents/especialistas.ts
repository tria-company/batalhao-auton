import type { RawPost } from '../domain';
import { parseStructured, type StructuredResult } from '../lib/openai';
import { withRetry } from '../lib/retry';
import {
  CARROSSEL_PROMPT,
  IMAGEM_PROMPT,
  VIDEO_CURTO_PROMPT,
  VIDEO_LONGO_PROMPT,
} from '../prompts';
import {
  carrosselOutputSchema,
  imagemOutputSchema,
  videoCurtoOutputSchema,
  videoLongoOutputSchema,
  type EspecialistaOutput,
} from '../schemas/especialistas';
import type { OrganizadorOutput } from '../schemas/organizador';
import type { Tipo } from '../schemas/common';
import { logger } from '../lib/logger';
import { AgentGuardError } from './errors';

const MAX_CAROUSEL_IMAGES = 4;
const SHORT_VIDEO_MAX_SECONDS = 90;

export type SpecialistName = 'imagem' | 'carrossel' | 'video_curto' | 'video_longo';

/** Roteamento da Camada 2 (PRD §5): match(organizador_output.tipo). */
export function routeSpecialist(tipo: Tipo): SpecialistName {
  switch (tipo) {
    case 'imagem':
      return 'imagem';
    case 'carrossel':
    case 'slideshow':
      return 'carrossel';
    case 'video_curto':
      return 'video_curto';
    case 'video_longo':
      return 'video_longo';
  }
}

// Visao do gpt-4.1-mini aceita png/jpeg/gif/webp. Descarta formatos que dao 400.
const UNSUPPORTED_IMG = /\.(heic|heif|avif|mp4|mov|webm|m4v|tiff?)(\?|$)/i;
function keepImages(urls: (string | null | undefined)[]): string[] {
  return urls.filter(
    (u): u is string => !!u && /^https?:\/\//i.test(u) && !UNSUPPORTED_IMG.test(u),
  );
}

/** Detecta erro de imagem invalida/nao suportada vindo da API de visao. */
function isImageError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /unsupported image|invalid.*image|image.*format|image_parse|could not process image|download.*image/i.test(
    msg,
  );
}

function imagesFor(name: SpecialistName, raw: RawPost): string[] {
  if (name === 'carrossel') {
    return keepImages([raw.mediaurl, ...raw.carouselimages]).slice(0, MAX_CAROUSEL_IMAGES);
  }
  if (name === 'imagem') {
    return keepImages([raw.mediaurl]);
  }
  // video curto/longo: usa o thumbnail (jpg), nunca a URL de video
  return keepImages([raw.thumbnail, raw.mediaurl]).slice(0, 1);
}

/**
 * Roteia videos por DURACAO (a definicao do PRD: curto <=90s, longo >90s),
 * o que evita erros de classificacao do Organizador. Imagem/carrossel seguem
 * pelo `tipo`.
 */
export function resolveSpecialist(tipo: Tipo, durationSeconds: number | null): SpecialistName {
  const name = routeSpecialist(tipo);
  if ((name === 'video_curto' || name === 'video_longo') && durationSeconds != null) {
    return durationSeconds > SHORT_VIDEO_MAX_SECONDS ? 'video_longo' : 'video_curto';
  }
  return name;
}

/** Aplica as guardas deterministicas de plataforma/formato (PRD §6). */
export function assertGuards(name: SpecialistName, raw: RawPost): void {
  const dur = raw.duration_seconds ?? 0;
  switch (name) {
    case 'imagem':
      if (raw.platform !== 'instagram') throw new AgentGuardError('platform_not_supported');
      return;
    case 'carrossel':
      if (raw.platform !== 'instagram' && raw.platform !== 'tiktok')
        throw new AgentGuardError('wrong_format');
      return;
    case 'video_curto':
      if (dur > SHORT_VIDEO_MAX_SECONDS) throw new AgentGuardError('too_long');
      return;
    case 'video_longo':
      // Com transcricao de audio, video longo e analisado em QUALQUER rede
      // (IG/TikTok/YouTube) — nao ha mais restricao de plataforma.
      return;
  }
}

function userPayload(raw: RawPost, org: OrganizadorOutput, transcript: string | null): string {
  return JSON.stringify({
    platform: raw.platform,
    username: raw.username,
    postid: raw.postid,
    alttext: raw.alttext,
    description: raw.description,
    mediaurl: raw.mediaurl,
    n_slides: raw.n_slides,
    duration_seconds: raw.duration_seconds,
    music_info: raw.music_info,
    // Transcricao do audio do video (quando houver) — usar como verdade do que e FALADO.
    transcricao: transcript,
    organizador_output: org,
  });
}

export interface SpecialistResult extends StructuredResult<EspecialistaOutput> {
  name: SpecialistName;
}

/**
 * Camada 2: roteia pelo `tipo`, valida guardas e chama o especialista certo
 * (com visao quando ha imagem/thumb). Lanca AgentGuardError se a guarda falhar.
 */
export async function runEspecialista(
  raw: RawPost,
  org: OrganizadorOutput,
  transcript: string | null = null,
): Promise<SpecialistResult> {
  const name = resolveSpecialist(org.tipo, raw.duration_seconds);
  assertGuards(name, raw);

  const user = userPayload(raw, org, transcript);
  const images = imagesFor(name, raw);

  const call = async (imgs: string[]): Promise<StructuredResult<EspecialistaOutput>> => {
    switch (name) {
      case 'imagem':
        return parseStructured({
          system: IMAGEM_PROMPT,
          user,
          images: imgs,
          schema: imagemOutputSchema,
          schemaName: 'imagem_output',
        });
      case 'carrossel':
        return parseStructured({
          system: CARROSSEL_PROMPT,
          user,
          images: imgs,
          schema: carrosselOutputSchema,
          schemaName: 'carrossel_output',
        });
      case 'video_curto':
        return parseStructured({
          system: VIDEO_CURTO_PROMPT,
          user,
          images: imgs,
          schema: videoCurtoOutputSchema,
          schemaName: 'video_curto_output',
        });
      case 'video_longo':
        return parseStructured({
          system: VIDEO_LONGO_PROMPT,
          user,
          images: imgs,
          schema: videoLongoOutputSchema,
          schemaName: 'video_longo_output',
        });
    }
  };

  try {
    const result = await withRetry(() => call(images), { label: name });
    return { name, ...result };
  } catch (err) {
    // Imagem nao suportada/invalida -> nao perde o post: reanalisa SEM imagem
    // (legenda + transcricao), em vez de pular.
    if (images.length > 0 && isImageError(err)) {
      logger.warn(`[${name}] imagem rejeitada (${raw.postid}) — reanalisando sem imagem`, {});
      const result = await withRetry(() => call([]), { label: `${name}-sem-img` });
      return { name, ...result };
    }
    throw err;
  }
}
