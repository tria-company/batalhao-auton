import type { Platform } from '../config';
import { getSupabase } from '../lib/supabase';
import type { RawScrapedPost } from '../scrapers/types';
import { upsertByKeys } from './upsert';

/**
 * Upsert idempotente em scrappers_contents por (platform, postid). Usa
 * `upsertByKeys` que ja faz select-then-update/insert — nao depende de
 * UNIQUE constraint no banco (a memoria do projeto sinaliza que falta).
 */
export async function upsertScrapedPost(
  username: string,
  platform: Platform,
  post: RawScrapedPost,
): Promise<void> {
  const { postid, ...rest } = post;
  await upsertByKeys(
    'scrappers_contents',
    { platform, postid },
    { username, ...rest, updated_at: new Date().toISOString() },
  );
}

/** Marca quando este (perfil, rede) foi raspado pela ultima vez. */
export async function markScraped(username: string, platform: Platform): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from('reference_profiles')
    .update({ last_scraped_at: new Date().toISOString() })
    .eq('username', username)
    .eq('platform', platform);
  if (error) {
    throw new Error(`Erro marcando last_scraped_at de ${username}/${platform}: ${error.message}`);
  }
}

export interface ScrapeTarget {
  username: string;
  platform: Platform;
  intervalHours: number;
  lastScrapedAt: string | null;
}

/**
 * Lista (perfil, rede) ativos cujo `last_scraped_at` venceu — comparando
 * com `scrape_interval_hours` (default 24h). Quando `force=true`, ignora
 * o intervalo e devolve todos os ativos.
 */
export async function getDueScrapeTargets(force: boolean): Promise<ScrapeTarget[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('reference_profiles')
    .select('username, platform, scrape_interval_hours, last_scraped_at')
    .eq('is_active', true);
  if (error) throw new Error(`Erro lendo reference_profiles: ${error.message}`);

  const now = Date.now();
  return (data ?? [])
    .map((r) => {
      const row = r as {
        username?: string;
        platform?: string;
        scrape_interval_hours?: number | null;
        last_scraped_at?: string | null;
      };
      return {
        username: row.username ?? '',
        platform: (row.platform ?? '') as Platform,
        intervalHours: Number(row.scrape_interval_hours ?? 24),
        lastScrapedAt: row.last_scraped_at ?? null,
      };
    })
    .filter((t) => t.username.length > 0 && t.platform.length > 0)
    .filter((t) => {
      if (force) return true;
      if (!t.lastScrapedAt) return true;
      const last = new Date(t.lastScrapedAt).getTime();
      if (Number.isNaN(last)) return true;
      return now - last >= t.intervalHours * 3600 * 1000;
    });
}
