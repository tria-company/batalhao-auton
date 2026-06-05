import { config } from '../config';
import { runApifyActor } from './apifyClient';
import type { RawScrapedPost, ScraperAdapter } from './types';

/** Subset do output do actor `clockworks/tiktok-scraper`. */
interface ApifyTtItem {
  id?: string;
  text?: string;
  /** ISO 8601 */
  createTimeISO?: string;
  webVideoUrl?: string;
  videoMeta?: {
    duration?: number;
    downloadAddr?: string;
    coverUrl?: string;
  };
  diggCount?: number;
  shareCount?: number;
  playCount?: number;
  commentCount?: number;
  collectCount?: number;
  hashtags?: Array<{ name?: string } | string>;
  musicMeta?: Record<string, unknown>;
}

function extractHashtags(raw: ApifyTtItem['hashtags']): string[] | null {
  if (!raw?.length) return null;
  const tags = raw
    .map((h) => (typeof h === 'string' ? h : (h?.name ?? '')))
    .filter((s): s is string => !!s && s.length > 0);
  return tags.length ? tags : null;
}

export const tiktokScraper: ScraperAdapter = async (username, limit) => {
  const items = (await runApifyActor(config.apifyTiktokActor, {
    profiles: [username],
    resultsPerPage: limit,
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
  })) as ApifyTtItem[];

  return items
    .map((it): RawScrapedPost => ({
      postid: it.id ?? '',
      posturl: it.webVideoUrl ?? null,
      alttext: it.text ?? null,
      mediatype: 'video',
      mediaurl: it.videoMeta?.coverUrl ?? null,
      thumbnail_url: it.videoMeta?.coverUrl ?? null,
      videourl: it.videoMeta?.downloadAddr ?? null,
      iscarousel: false,
      duration_seconds: it.videoMeta?.duration ?? null,
      posted_at: it.createTimeISO ?? null,
      views_count: it.playCount ?? null,
      plays_count: it.playCount ?? null,
      likes_count: it.diggCount ?? null,
      comments_count: it.commentCount ?? null,
      shares_count: it.shareCount ?? null,
      saves_count: it.collectCount ?? null,
      reshares_count: null,
      hashtags: extractHashtags(it.hashtags),
      carouselimages: null,
      music_info: it.musicMeta ?? null,
    }))
    .filter((p) => p.postid.length > 0);
};
