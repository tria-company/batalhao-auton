import type { Platform } from './config';
import type { OrganizadorOutput } from './schemas/organizador';
import type { EspecialistaOutput } from './schemas/especialistas';

/** Metricas brutas de 1 post (vindas de scrappers_contents). */
export interface PostMetrics {
  likes_count: number;
  views_count: number;
  shares_count: number;
  saves_count: number;
  comments_count: number;
}

/** 1 post cru pronto para o pipeline (apos mapeamento de scrappers_contents). */
export interface RawPost {
  platform: Platform;
  username: string;
  postid: string;
  alttext: string;
  description: string | null;
  hashtags: string[];
  mediatype: string | null;
  iscarousel: boolean;
  duration_seconds: number | null;
  mediaurl: string | null;
  thumbnail: string | null;
  videourl: string | null;
  posturl: string | null;
  n_slides: number | null;
  carouselimages: string[];
  music_info: Record<string, unknown> | null;
  posted_at: string | null;
  metrics: PostMetrics;
}

/** Resultado da analise de 1 post (Camada 1 + Camada 2 mescladas). */
export interface PostAnalysis {
  organizador: OrganizadorOutput;
  specialist: EspecialistaOutput | null;
  specialistName: string | null;
  specialistError: string | null;
  /** Transcricao do audio do video (quando disponivel), senao null. */
  transcript: string | null;
}

/** Post + analise + sinal de engajamento, usado pelas rubricas. */
export interface AnalyzedPost {
  postid: string;
  posted_at: string | null;
  engagement: number;
  organizador: OrganizadorOutput;
}

/** Metricas agregadas por (perfil, rede), para sintese/consolidacao. */
export interface PlatformMetrics {
  followers: number;
  eng_rate_medio: number;
  posts_30d: number;
  views_medio: number;
}
