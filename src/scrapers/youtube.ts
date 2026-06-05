import { spawn } from 'node:child_process';
import { promises as fs, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config';
import { logger } from '../lib/logger';
import type { RawScrapedPost, ScraperAdapter } from './types';

/** Shape parcial do `--dump-json` do yt-dlp pra um video. */
interface YtDlpVideo {
  id: string;
  title?: string | null;
  description?: string | null;
  webpage_url?: string | null;
  thumbnail?: string | null;
  duration?: number | null;
  view_count?: number | null;
  like_count?: number | null;
  comment_count?: number | null;
  /** AAAAMMDD */
  upload_date?: string | null;
  /** Unix seconds. */
  timestamp?: number | null;
  tags?: string[] | null;
}

/** Roda o yt-dlp, captura stdout como NDJSON (1 video por linha). */
function ytDlpJson(args: string[]): Promise<YtDlpVideo[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.ytDlpBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d: Buffer) => (out += d.toString()));
    proc.stderr.on('data', (d: Buffer) => (err += d.toString()));
    proc.on('error', (e) => reject(new Error(`yt-dlp spawn falhou: ${e.message}`)));
    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`yt-dlp exit ${code}: ${err.slice(0, 500)}`));
      }
      try {
        const items = out
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
          .map((l) => JSON.parse(l) as YtDlpVideo);
        resolve(items);
      } catch (e) {
        reject(new Error(`yt-dlp JSON parse: ${(e as Error).message}`));
      }
    });
  });
}

function isoFromUploadDate(d: string): string | null {
  // YYYYMMDD -> YYYY-MM-DDT00:00:00Z
  if (!/^\d{8}$/.test(d)) return null;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T00:00:00Z`;
}

/**
 * Converte WebVTT em texto corrido. Tira cabecalhos (WEBVTT/Kind/Language),
 * marcadores de tempo (`00:00:01.000 --> 00:00:03.000`), cue ids numericos,
 * tags inline (`<c>...</c>`, `<00:00:01.000>`) e duplica linhas consecutivas
 * iguais (auto-captions repetem palavras entre cues por overlap).
 */
function vttToText(vtt: string): string {
  const lines = vtt.split(/\r?\n/);
  const out: string[] = [];
  let prev = '';
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('WEBVTT')) continue;
    if (line.startsWith('NOTE')) continue;
    if (line.startsWith('STYLE')) continue;
    if (line.startsWith('Kind:') || line.startsWith('Language:')) continue;
    if (line.includes('-->')) continue;
    if (/^\d+$/.test(line)) continue;
    const clean = line.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    if (clean === prev) continue;
    out.push(clean);
    prev = clean;
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Procura o .vtt do video por preferencia de idioma e devolve o texto extraido.
 * Quando nenhum idioma esta disponivel (canal sem captions), devolve null.
 */
async function readCaption(
  dir: string,
  videoId: string,
  files: string[],
): Promise<{ text: string; lang: string } | null> {
  // pt-orig (legenda do audio original) tem precedencia — qualidade muito
  // melhor que pt/pt-PT que costumam ser auto-translate.
  const langPrefs = ['pt-orig', 'pt-BR', 'pt-br', 'pt', 'pt-PT', 'pt-pt'];
  for (const lang of langPrefs) {
    const fname = `${videoId}.${lang}.vtt`;
    if (!files.includes(fname)) continue;
    try {
      const vtt = await fs.readFile(join(dir, fname), 'utf-8');
      const text = vttToText(vtt);
      if (text.length > 0) return { text, lang };
    } catch {
      // tenta o proximo idioma
    }
  }
  return null;
}

/**
 * Top-N videos do canal `@<username>/videos` com metadata + legenda automatica
 * (quando o canal permite). yt-dlp roda 1 vez so com `--dump-json` (NDJSON em
 * stdout) E `--write-auto-subs` (escreve .vtt em -P dir por video). Depois
 * cruzamos cada video com seu .vtt e parseamos pra texto.
 */
export const youtubeScraper: ScraperAdapter = async (username, limit) => {
  const channelUrl = `https://www.youtube.com/@${username}/videos`;
  const subsDir = mkdtempSync(join(tmpdir(), 'auton-yt-subs-'));
  try {
    const items = await ytDlpJson([
      '--dump-json',
      // --dump-json implica --simulate (yt-dlp nao escreve nada). Sem
      // --no-simulate, o --write-auto-subs e ignorado silenciosamente
      // mesmo o JSON listando automatic_captions cheio.
      '--no-simulate',
      '--write-auto-subs',
      // pt-orig = legenda auto a partir do AUDIO em pt (alta qualidade).
      // Quando nao tem, cai em pt-BR/pt/pt-PT (geralmente traducao).
      '--sub-lang',
      'pt-orig,pt-BR,pt-br,pt,pt-PT',
      '--sub-format',
      'vtt',
      '--skip-download',
      // Versoes recentes do yt-dlp exigem runtime JS pra resolver URLs assinadas
      // do YouTube (sem isso, --list-subs lista mas o download falha em silencio).
      // Node ja esta no PATH do VPS; em outras maquinas pode trocar p/ deno/bun.
      '--js-runtimes',
      'node',
      '--playlist-end',
      String(limit),
      '--no-warnings',
      '--ignore-errors',
      '-P',
      subsDir,
      '-o',
      '%(id)s.%(ext)s',
      channelUrl,
    ]);

    let subFiles: string[] = [];
    try {
      subFiles = await fs.readdir(subsDir);
    } catch {
      subFiles = [];
    }

    let captionsHit = 0;
    const results: RawScrapedPost[] = [];
    for (const v of items.filter((x) => x && x.id)) {
      const url = v.webpage_url ?? `https://www.youtube.com/watch?v=${v.id}`;
      const postedAt = v.timestamp
        ? new Date(v.timestamp * 1000).toISOString()
        : v.upload_date
          ? isoFromUploadDate(v.upload_date)
          : null;
      const alttext =
        [v.title, v.description].filter((s): s is string => !!s).join('\n\n') || null;
      const caption = await readCaption(subsDir, v.id, subFiles);
      if (caption) captionsHit++;
      results.push({
        postid: v.id,
        posturl: url,
        alttext,
        mediatype: 'video',
        mediaurl: v.thumbnail ?? null,
        thumbnail_url: v.thumbnail ?? null,
        videourl: url,
        iscarousel: false,
        duration_seconds: v.duration ?? null,
        posted_at: postedAt,
        views_count: v.view_count ?? null,
        plays_count: v.view_count ?? null,
        likes_count: v.like_count ?? null,
        comments_count: v.comment_count ?? null,
        shares_count: null,
        saves_count: null,
        reshares_count: null,
        hashtags: v.tags && v.tags.length ? v.tags : null,
        carouselimages: null,
        music_info: null,
        transcript: caption?.text ?? null,
        transcript_source: caption ? `youtube_auto_subs:${caption.lang}` : null,
      });
    }
    logger.info(`[${username}/youtube] legendas auto: ${captionsHit}/${results.length}`, {});
    return results;
  } finally {
    try {
      rmSync(subsDir, { recursive: true, force: true });
    } catch {
      // ignore — temp dir cleanup nao deve quebrar o scrape
    }
  }
};
