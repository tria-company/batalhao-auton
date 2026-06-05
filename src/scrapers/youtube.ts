import { spawn } from 'node:child_process';
import { config } from '../config';
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
 * Lista os top-N videos do canal `@<username>` com metadados completos.
 * `--playlist-end` aplica o limite na URL do canal sem precisar paginar.
 * `--skip-download` garante que so descemos metadata (sem video).
 */
export const youtubeScraper: ScraperAdapter = async (username, limit) => {
  const channelUrl = `https://www.youtube.com/@${username}/videos`;
  const items = await ytDlpJson([
    '--dump-json',
    '--skip-download',
    '--playlist-end',
    String(limit),
    '--no-warnings',
    '--ignore-errors',
    channelUrl,
  ]);
  return items
    .filter((v) => v && v.id)
    .map((v): RawScrapedPost => {
      const url = v.webpage_url ?? `https://www.youtube.com/watch?v=${v.id}`;
      const postedAt = v.timestamp
        ? new Date(v.timestamp * 1000).toISOString()
        : v.upload_date
          ? isoFromUploadDate(v.upload_date)
          : null;
      const alttext = [v.title, v.description].filter((s): s is string => !!s).join('\n\n') || null;
      return {
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
      };
    });
};
