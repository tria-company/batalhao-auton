/**
 * Schema 1-1 com as colunas de `scrappers_contents` (introspectado em
 * 2026-05). Cada adapter de rede (Instagram/TikTok/YouTube) mapeia o
 * output bruto da fonte pra esse shape — sem nenhuma logica de DB aqui.
 *
 * `postid` + `platform` (preenchido pelo runner) e a chave logica do upsert.
 */
export interface RawScrapedPost {
  postid: string;
  posturl: string | null;
  alttext: string | null;
  /** 'video' | 'image' | 'carousel' | 'reel' etc. — alinhado ao schema. */
  mediatype: string | null;
  mediaurl: string | null;
  thumbnail_url: string | null;
  videourl: string | null;
  iscarousel: boolean;
  duration_seconds: number | null;
  /** ISO 8601, UTC. */
  posted_at: string | null;
  views_count: number | null;
  plays_count: number | null;
  likes_count: number | null;
  comments_count: number | null;
  shares_count: number | null;
  saves_count: number | null;
  reshares_count: number | null;
  hashtags: string[] | null;
  carouselimages: string[] | null;
  music_info: Record<string, unknown> | null;
  /** Texto transcrito pre-extraido (ex: legenda automatica do YT). null = analisador chama Whisper. */
  transcript: string | null;
  /** Origem do `transcript` — ex: `youtube_auto_subs:pt-BR`. */
  transcript_source: string | null;
}

/** Cada adapter recebe (handle/username, max posts) e retorna posts brutos. */
export type ScraperAdapter = (username: string, limit: number) => Promise<RawScrapedPost[]>;
