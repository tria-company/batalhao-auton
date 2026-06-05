import { config } from '../config';
import { runApifyActor } from './apifyClient';
import type { RawScrapedPost, ScraperAdapter } from './types';

/** Subset do output do actor `apify/instagram-profile-scraper` (resultsType=posts). */
interface ApifyIgItem {
  id?: string;
  shortCode?: string;
  url?: string;
  /** 'Video' | 'Image' | 'Sidecar' */
  type?: string;
  /** 'feed' | 'clips' (reel) etc. */
  productType?: string;
  caption?: string;
  hashtags?: string[];
  displayUrl?: string;
  videoUrl?: string;
  videoDuration?: number;
  videoViewCount?: number;
  videoPlayCount?: number;
  likesCount?: number;
  commentsCount?: number;
  /** ISO 8601 */
  timestamp?: string;
  /** Carrossel — algumas versoes do actor usam `images`, outras `childPosts`. */
  images?: string[];
  childPosts?: Array<{ displayUrl?: string }>;
}

function carouselUrls(it: ApifyIgItem): string[] | null {
  if (it.images?.length) return it.images;
  const urls = (it.childPosts ?? [])
    .map((c) => c.displayUrl)
    .filter((u): u is string => typeof u === 'string' && u.length > 0);
  return urls.length ? urls : null;
}

export const instagramScraper: ScraperAdapter = async (username, limit) => {
  const items = (await runApifyActor(config.apifyInstagramActor, {
    usernames: [username],
    resultsType: 'posts',
    resultsLimit: limit,
  })) as ApifyIgItem[];

  return items
    .map((it): RawScrapedPost => {
      const carousel = carouselUrls(it);
      const isCarousel = it.type === 'Sidecar' || !!carousel;
      const mediatype = it.type === 'Video' ? 'video' : isCarousel ? 'carousel' : 'image';
      const postid = it.shortCode ?? it.id ?? '';
      const posturl = it.url ?? (it.shortCode ? `https://www.instagram.com/p/${it.shortCode}/` : null);
      return {
        postid,
        posturl,
        alttext: it.caption ?? null,
        mediatype,
        mediaurl: it.displayUrl ?? null,
        thumbnail_url: it.displayUrl ?? null,
        videourl: it.videoUrl ?? null,
        iscarousel: isCarousel,
        duration_seconds: it.videoDuration ?? null,
        posted_at: it.timestamp ?? null,
        views_count: it.videoViewCount ?? null,
        plays_count: it.videoPlayCount ?? null,
        likes_count: it.likesCount ?? null,
        comments_count: it.commentsCount ?? null,
        shares_count: null,
        saves_count: null,
        reshares_count: null,
        hashtags: it.hashtags?.length ? it.hashtags : null,
        carouselimages: carousel,
        music_info: null,
      };
    })
    .filter((p) => p.postid.length > 0);
};
