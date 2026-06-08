import type { Platform } from '../config';
import { config } from '../config';
import { pMap } from './concurrency';
import { logger } from './logger';
import { minioEnabled, objectExists, publicUrl, putObject } from './minio';
import type { RawScrapedPost } from '../scrapers/types';

/**
 * Espelha a midia de um post (CDN do Instagram/TikTok/YT) pro MinIO e reescreve
 * as URLs (`mediaurl`, `videourl`, `carouselimages`) pras URLs publicas do MinIO,
 * ANTES de gravar em `scrappers_contents`. Substitui o antigo upload pro Supabase
 * Storage. Convencao de chave (igual ao storage anterior):
 *   <username>/<postid>.jpg   imagem/capa
 *   <username>/<postid>.mp4   video
 *   <username>/<postid>_N.jpg item N do carrossel
 *
 * Idempotente (HEAD antes de subir) e tolerante a falha: se o download do CDN
 * falhar (link expirado etc.), mantem a URL original daquele item e segue.
 */

// User-Agent de browser — alguns CDNs (TikTok) recusam clients sem UA.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MIRROR_CONCURRENCY = 4;

interface MirrorJob {
  url: string;
  key: string;
  contentType: string;
  /** Onde gravar a URL nova de volta no post. */
  apply: (newUrl: string) => void;
}

/** Ja e uma URL do nosso MinIO? Entao nao precisa reespelhar. */
function alreadyMirrored(url: string | null): boolean {
  return !!url && url.startsWith(config.minioEndpoint + '/' + config.minioBucket + '/');
}

function isHttp(url: string | null): url is string {
  return !!url && /^https?:\/\//i.test(url);
}

async function mirrorOne(job: MirrorJob): Promise<void> {
  // Idempotencia: se ja subiu antes, so aponta pra URL publica.
  if (await objectExists(job.key)) {
    job.apply(publicUrl(job.key));
    return;
  }
  const res = await fetch(job.url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`download ${res.status} de ${job.url.slice(0, 80)}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength === 0) throw new Error('download vazio');
  await putObject(job.key, buf, job.contentType);
  job.apply(publicUrl(job.key));
}

/**
 * Devolve uma copia do post com as URLs de midia apontando pro MinIO.
 * No-op (devolve o post como veio) quando o espelhamento esta desligado.
 */
export async function mirrorPostMedia(
  username: string,
  platform: Platform,
  post: RawScrapedPost,
): Promise<RawScrapedPost> {
  if (!minioEnabled()) return post;

  const out: RawScrapedPost = { ...post };
  const base = `${username}/${post.postid}`;
  const jobs: MirrorJob[] = [];

  if (isHttp(out.mediaurl) && !alreadyMirrored(out.mediaurl)) {
    jobs.push({
      url: out.mediaurl,
      key: `${base}.jpg`,
      contentType: 'image/jpeg',
      apply: (u) => {
        // thumbnail_url, no schema atual, aponta pra mesma imagem da capa.
        if (out.thumbnail_url === out.mediaurl) out.thumbnail_url = u;
        out.mediaurl = u;
      },
    });
  }
  if (isHttp(out.videourl) && !alreadyMirrored(out.videourl)) {
    jobs.push({
      url: out.videourl,
      key: `${base}.mp4`,
      contentType: 'video/mp4',
      apply: (u) => {
        out.videourl = u;
      },
    });
  }
  if (Array.isArray(out.carouselimages) && out.carouselimages.length) {
    const arr = [...out.carouselimages];
    out.carouselimages = arr;
    arr.forEach((item, i) => {
      if (isHttp(item) && !alreadyMirrored(item)) {
        jobs.push({
          url: item,
          key: `${base}_${i}.jpg`,
          contentType: 'image/jpeg',
          apply: (u) => {
            arr[i] = u;
          },
        });
      }
    });
  }

  if (!jobs.length) return out;

  let ok = 0;
  let fail = 0;
  await pMap(
    jobs,
    async (job) => {
      try {
        await mirrorOne(job);
        ok++;
      } catch (e) {
        fail++;
        logger.warn('Falha ao espelhar midia pro MinIO (mantendo URL original)', {
          platform,
          username,
          postid: post.postid,
          key: job.key,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
    MIRROR_CONCURRENCY,
  );

  logger.info('Midia espelhada pro MinIO', { platform, username, postid: post.postid, ok, fail });
  return out;
}
