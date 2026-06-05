import type { Platform } from '../config';
import { getDueScrapeTargets, markScraped, upsertScrapedPost, type ScrapeTarget } from '../db/scrappersContents';
import { logger } from '../lib/logger';
import { instagramScraper } from './instagram';
import { tiktokScraper } from './tiktok';
import type { ScraperAdapter } from './types';
import { youtubeScraper } from './youtube';

const ADAPTERS: Record<Platform, ScraperAdapter> = {
  youtube: youtubeScraper,
  instagram: instagramScraper,
  tiktok: tiktokScraper,
};

export interface RunScraperOptions {
  limit: number;
  /** Chama as APIs mas NAO grava em scrappers_contents nem mexe em last_scraped_at. */
  dryRun: boolean;
  /** Ignora last_scraped_at — raspa todos os selecionados. */
  force: boolean;
  /** Filtra por 1 username (alem dos filtros de elegibilidade). */
  username?: string;
  /** Filtra por 1 plataforma. */
  platform?: Platform;
}

export interface ScrapeResult {
  username: string;
  platform: Platform;
  inserted: number;
  error?: string;
  durationMs: number;
}

async function scrapeOne(t: ScrapeTarget, opts: RunScraperOptions): Promise<ScrapeResult> {
  const adapter = ADAPTERS[t.platform];
  const t0 = Date.now();
  try {
    const posts = await adapter(t.username, opts.limit);
    logger.info(`[${t.username}/${t.platform}] ${posts.length} posts retornados pela fonte`, {});

    if (!opts.dryRun) {
      for (const p of posts) {
        await upsertScrapedPost(t.username, t.platform, p);
      }
      await markScraped(t.username, t.platform);
    }

    return {
      username: t.username,
      platform: t.platform,
      inserted: posts.length,
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[${t.username}/${t.platform}] scrape falhou`, { error: msg });
    return {
      username: t.username,
      platform: t.platform,
      inserted: 0,
      error: msg,
      durationMs: Date.now() - t0,
    };
  }
}

export async function runScraper(opts: RunScraperOptions): Promise<ScrapeResult[]> {
  const due = await getDueScrapeTargets(opts.force);
  const targets = due
    .filter((t) => !opts.username || t.username === opts.username)
    .filter((t) => !opts.platform || t.platform === opts.platform);

  logger.info(`Scraper: ${targets.length} (perfil, rede) due de ${due.length} ativos`, {
    dryRun: opts.dryRun,
    force: opts.force,
    limit: opts.limit,
    username: opts.username,
    platform: opts.platform,
  });

  // Serial: o `run-sync` da Apify ja pode levar 1-2 min por call e o yt-dlp
  // gasta CPU/rede; paralelo aqui daria pouco ganho e mais risco de rate-limit.
  const results: ScrapeResult[] = [];
  for (const t of targets) {
    results.push(await scrapeOne(t, opts));
  }
  return results;
}
