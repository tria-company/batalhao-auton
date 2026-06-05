import { config } from '../config';
import { runApifyActor } from './apifyClient';
import type { RawScrapedPost, ScraperAdapter } from './types';

/**
 * Output de `apify/instagram-profile-scraper` (resultsType=posts): 1 item
 * top-level POR PERFIL, com os posts dentro de `latestPosts: [...]`. O
 * actor ignora `resultsLimit` (sempre devolve ~12), entao fazemos o slice
 * no client pra respeitar o limite pedido.
 */
interface ApifyIgProfileItem {
  username?: string;
  latestPosts?: ApifyIgPost[];
}

interface ApifyIgPost {
  id?: string;
  shortCode?: string;
  url?: string;
  /** 'Video' | 'Image' | 'Sidecar' */
  type?: string;
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
  /** Carrossel — URLs das midias filhas. */
  images?: string[];
}

function mapPost(p: ApifyIgPost): RawScrapedPost {
  const carousel = p.images?.length ? p.images : null;
  const isCarousel = p.type === 'Sidecar' || !!carousel;
  const mediatype = p.type === 'Video' ? 'video' : isCarousel ? 'carousel' : 'image';
  const postid = p.shortCode ?? p.id ?? '';
  const posturl = p.url ?? (p.shortCode ? `https://www.instagram.com/p/${p.shortCode}/` : null);
  return {
    postid,
    posturl,
    alttext: p.caption ?? null,
    mediatype,
    mediaurl: p.displayUrl ?? null,
    thumbnail_url: p.displayUrl ?? null,
    videourl: p.videoUrl ?? null,
    iscarousel: isCarousel,
    duration_seconds: p.videoDuration ?? null,
    posted_at: p.timestamp ?? null,
    views_count: p.videoViewCount ?? null,
    plays_count: p.videoPlayCount ?? null,
    likes_count: p.likesCount ?? null,
    comments_count: p.commentsCount ?? null,
    shares_count: null,
    saves_count: null,
    reshares_count: null,
    hashtags: p.hashtags?.length ? p.hashtags : null,
    carouselimages: carousel,
    music_info: null,
  };
}

export const instagramScraper: ScraperAdapter = async (username, limit) => {
  const profiles = (await runApifyActor(config.apifyInstagramActor, {
    usernames: [username],
    resultsType: 'posts',
    resultsLimit: limit,
  })) as ApifyIgProfileItem[];

  const allPosts: ApifyIgPost[] = [];
  for (const prof of profiles) {
    if (Array.isArray(prof.latestPosts)) allPosts.push(...prof.latestPosts);
  }

  return allPosts
    .slice(0, limit)
    .map(mapPost)
    .filter((p) => p.postid.length > 0);
};
