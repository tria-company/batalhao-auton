import { PLATFORMS, config, type Platform } from '../config';
import { pMap } from '../lib/concurrency';
import { runConsolidador } from '../agents/consolidador';
import { AgentGuardError } from '../agents/errors';
import { runEspecialista } from '../agents/especialistas';
import { runOrganizador } from '../agents/organizador';
import { runSintetizador, type SintetizadorPostInput } from '../agents/sintetizador';
import {
  buildPostAnalysisRow,
  getExistingAnalyses,
  getTopPosts,
  upsertPostAnalysis,
  type StoredAnalysis,
} from '../db/posts';
import { getProfileBio, setPipelineStatus } from '../db/profiles';
import { insertNarrativeShifts, upsertProfileSynthesis } from '../db/synthesis';
import { upsertCrossBrief } from '../db/crossBrief';
import type { AnalyzedPost, PlatformMetrics, PostAnalysis, RawPost } from '../domain';
import { usdCost } from '../lib/cost';
import { logger } from '../lib/logger';
import { transcribeVideo } from '../lib/transcribe';
import { buildSynthesisSignals, toAnalyzedPost } from '../rubrics/aggregation';
import { computeScore, deriveFit, deriveRecorrencia } from '../rubrics/score';
import type { TemaPrincipal } from '../schemas/common';
import type { SintetizadorOutput } from '../schemas/sintetizador';

export interface RunOptions {
  limit: number;
  dryRun: boolean;
  /** Quantas sinteses sao necessarias para consolidar (PRD: 3). */
  minSyntheses: number;
  /** Pular posts ja analisados (com linha em post_analysis). Default true. */
  skipExisting: boolean;
}

const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;

function computePlatformMetrics(posts: RawPost[], followers: number): PlatformMetrics {
  const now = Date.now();
  let engSum = 0;
  let viewsSum = 0;
  let recent = 0;
  for (const p of posts) {
    const inter =
      p.metrics.likes_count + p.metrics.shares_count + p.metrics.saves_count + p.metrics.comments_count;
    engSum += followers > 0 ? inter / followers : 0;
    viewsSum += p.metrics.views_count;
    if (p.posted_at) {
      const t = new Date(p.posted_at).getTime();
      if (!Number.isNaN(t) && now - t <= THIRTY_DAYS_MS) recent++;
    }
  }
  const n = posts.length || 1;
  return { followers, eng_rate_medio: engSum / n, posts_30d: recent, views_medio: viewsSum / n };
}

function dominantTheme(posts: AnalyzedPost[]): TemaPrincipal | null {
  const counts = new Map<TemaPrincipal, number>();
  for (const p of posts) {
    const t = p.organizador.tema_principal;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let best: TemaPrincipal | null = null;
  let bestN = 0;
  for (const [t, n] of counts) {
    if (n > bestN) {
      best = t;
      bestN = n;
    }
  }
  return best;
}

export interface PlatformResult {
  platform: Platform;
  synthesis: SintetizadorOutput | null;
  analyzed: AnalyzedPost[];
  metrics: PlatformMetrics;
  postCount: number;
  costUsd: number;
}

interface PostResult {
  analyzed: AnalyzedPost;
  synthInput: SintetizadorPostInput;
  costUsd: number;
}

/**
 * Processa 1 post (Camadas 1-2): transcricao -> Organizador -> especialista ->
 * upsert. Resiliente: erro inesperado loga e retorna null (pula o post) para
 * nao derrubar o lote. Guard de especialista e tratada como "sem especialista".
 */
async function analyzeOnePost(
  raw: RawPost,
  username: string,
  platform: Platform,
  followers: number,
  opts: RunOptions,
): Promise<PostResult | null> {
  try {
    let postCost = 0;

    // Transcricao ANTES do Organizador (decide por mediatype/duracao do post cru),
    // para que nivel_tecnico/tem_prova/tema reflitam o AUDIO, nao so a legenda.
    let transcript: string | null = null;
    // Slideshow/carrossel nao tem audio de video -> nao tenta transcrever (evita
    // download desperdicado do yt-dlp e o "unable to obtain audio codec").
    const isVideoRaw =
      !raw.iscarousel &&
      (raw.mediatype === 'video' || (raw.duration_seconds != null && raw.duration_seconds > 0));
    if (raw.transcript && raw.transcript.trim().length > 0) {
      // Curto-circuito: o scraper ja salvou a legenda automatica (ex: YT via
      // yt-dlp --write-auto-subs). Usa direto e nao chama Whisper.
      transcript = raw.transcript;
      logger.info(
        `[${username}/${platform}] transcript reaproveitado de ${raw.transcript_source ?? 'sem source'} p/ ${raw.postid} (${transcript.length} chars)`,
        {},
      );
    } else if (isVideoRaw && (raw.videourl || raw.posturl)) {
      const t = await transcribeVideo({
        videourl: raw.videourl,
        pageurl: raw.posturl,
        durationSeconds: raw.duration_seconds,
      });
      if (t) {
        postCost += t.costUsd; // pagou a transcricao mesmo se vazia
        if (t.text.trim().length > 0) {
          transcript = t.text;
          logger.info(`[${username}/${platform}] transcrito ${raw.postid} (${t.text.length} chars)`, {});
        }
      }
    }

    // Camada 1 — Organizador (com a transcricao, quando houver)
    const org = await runOrganizador(raw, transcript);
    postCost += usdCost(org.usage);

    let analysis: PostAnalysis = {
      organizador: org.data,
      specialist: null,
      specialistName: null,
      specialistError: null,
      transcript,
    };
    let specModel: string | null = org.model;
    try {
      const spec = await runEspecialista(raw, org.data, transcript);
      postCost += usdCost(spec.usage);
      specModel = spec.model;
      analysis = {
        organizador: org.data,
        specialist: spec.data,
        specialistName: spec.name,
        specialistError: null,
        transcript,
      };
    } catch (err) {
      if (err instanceof AgentGuardError) {
        analysis.specialistError = err.code;
        logger.warn(`[${username}/${platform}] guard ${err.code} no post ${raw.postid}`, {});
      } else {
        throw err;
      }
    }

    if (!opts.dryRun) {
      await upsertPostAnalysis(
        buildPostAnalysisRow(raw, analysis, { model: specModel, costUsd: postCost }),
      );
    }

    return {
      analyzed: toAnalyzedPost(raw, org.data, followers),
      synthInput: { postid: raw.postid, posted_at: raw.posted_at, metrics: raw.metrics, analysis },
      costUsd: postCost,
    };
  } catch (err) {
    logger.error(`[${username}/${platform}] post ${raw.postid} falhou — pulado`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Processa UMA (perfil, rede): Camadas 1-2 por post + Camada 3 (sintese). */
export async function processProfilePlatform(
  username: string,
  platform: Platform,
  opts: RunOptions,
): Promise<PlatformResult> {
  const bio = await getProfileBio(username, platform);
  const posts = await getTopPosts(platform, username, opts.limit);
  logger.info(`[${username}/${platform}] ${posts.length} posts · ${bio.followers} seguidores`, {});

  if (posts.length === 0) {
    return {
      platform,
      synthesis: null,
      analyzed: [],
      metrics: computePlatformMetrics([], bio.followers),
      postCount: 0,
      costUsd: 0,
    };
  }

  if (!opts.dryRun) await setPipelineStatus(username, 'processando', platform);

  // Posts ja analisados (com linha em post_analysis) sao PULADOS e reaproveitados.
  const existing: Map<string, StoredAnalysis> = opts.skipExisting
    ? await getExistingAnalyses(platform, username)
    : new Map();
  const toAnalyze = posts.filter((p) => !existing.has(p.postid));
  if (existing.size > 0) {
    logger.info(
      `[${username}/${platform}] ${existing.size} ja analisados (pulados) · ${toAnalyze.length} novos`,
      {},
    );
  }

  // Camadas 1-2 em PARALELO — so os posts NOVOS.
  const newResults = await pMap(
    toAnalyze,
    (raw) => analyzeOnePost(raw, username, platform, bio.followers, opts),
    config.pipelineConcurrency,
  );
  const newByPost = new Map<string, PostResult | null>();
  toAnalyze.forEach((p, i) => newByPost.set(p.postid, newResults[i] ?? null));

  const analyzed: AnalyzedPost[] = [];
  const synthInputs: SintetizadorPostInput[] = [];
  let costUsd = 0;
  for (const raw of posts) {
    const stored = existing.get(raw.postid);
    if (stored) {
      analyzed.push(toAnalyzedPost(raw, stored.organizador, bio.followers));
      synthInputs.push({
        postid: raw.postid,
        posted_at: raw.posted_at,
        metrics: raw.metrics,
        analysis: {
          organizador: stored.organizador,
          specialist: stored.specialist,
          specialistName: stored.specialistName,
          specialistError: stored.specialistError,
          transcript: stored.transcript,
        },
      });
      continue;
    }
    const r = newByPost.get(raw.postid);
    if (r) {
      analyzed.push(r.analyzed);
      synthInputs.push(r.synthInput);
      costUsd += r.costUsd;
    }
  }

  // Camada 3 — sintese
  const signals = buildSynthesisSignals(analyzed);
  const synth = await runSintetizador({
    platform,
    username,
    posts: synthInputs,
    bio_metrics: {
      followers_count: bio.followers,
      posts_count: bio.posts_count,
      is_verified: bio.is_verified,
    },
    signals,
  });
  costUsd += usdCost(synth.usage);

  if (!opts.dryRun) {
    await upsertProfileSynthesis({
      platform,
      username,
      synthesis: synth.data,
      signals,
      postsAnalisados: posts.length,
      model: synth.model,
      costUsd,
    });
    await insertNarrativeShifts({ platform, username, synthesis: synth.data });
    await setPipelineStatus(username, 'completo', platform);
  }

  return {
    platform,
    synthesis: synth.data,
    analyzed,
    metrics: computePlatformMetrics(posts, bio.followers),
    postCount: posts.length,
    costUsd,
  };
}

export interface ProfileResult {
  username: string;
  costUsd: number;
  consolidated: boolean;
  score?: number;
  letra?: string;
}

/** Processa o perfil completo (3 redes -> consolidacao). Loop do PRD §9. */
export async function processProfile(username: string, opts: RunOptions): Promise<ProfileResult> {
  logger.info(`=== Perfil ${username} ===`, {});

  const perPlatform: PlatformResult[] = [];
  for (const platform of PLATFORMS) {
    try {
      perPlatform.push(await processProfilePlatform(username, platform, opts));
    } catch (err) {
      logger.error(`[${username}/${platform}] falhou`, {
        error: err instanceof Error ? err.message : String(err),
      });
      if (!opts.dryRun) await setPipelineStatus(username, 'erro', platform);
    }
  }

  let totalCost = perPlatform.reduce((s, p) => s + p.costUsd, 0);

  const withSynthesis = perPlatform.filter((p) => p.synthesis !== null);
  if (withSynthesis.length < opts.minSyntheses) {
    logger.warn(
      `[${username}] ${withSynthesis.length}/${opts.minSyntheses} sinteses — consolidacao adiada`,
      {},
    );
    return { username, costUsd: totalCost, consolidated: false };
  }

  // --- Camada 4: consolidacao ---
  const allAnalyzed = perPlatform.flatMap((p) => p.analyzed);
  const n = allAnalyzed.length || 1;
  const freqTecnico = allAnalyzed.filter((p) => p.organizador.nivel_tecnico === 'tecnico').length / n;
  const freqIntermediario =
    allAnalyzed.filter((p) => p.organizador.nivel_tecnico === 'intermediario').length / n;
  const freqProva = allAnalyzed.filter((p) => p.organizador.tem_prova).length / n;
  const fit = deriveFit(dominantTheme(allAnalyzed));

  const followersTotal = perPlatform.reduce((s, p) => s + p.metrics.followers, 0);
  const availMetrics = perPlatform.filter((p) => p.postCount > 0).map((p) => p.metrics);
  const engRate =
    availMetrics.length > 0
      ? availMetrics.reduce((s, m) => s + m.eng_rate_medio, 0) / availMetrics.length
      : 0;
  const posts30dTotal = perPlatform.reduce((s, p) => s + p.metrics.posts_30d, 0);
  const recorrencia = deriveRecorrencia(posts30dTotal);

  const sinteses: Partial<Record<Platform, SintetizadorOutput>> = {};
  const metricasPorRede: Partial<Record<Platform, PlatformMetrics>> = {};
  for (const p of perPlatform) {
    if (p.synthesis) sinteses[p.platform] = p.synthesis;
    if (p.postCount > 0) metricasPorRede[p.platform] = p.metrics;
  }

  const consol = await runConsolidador({
    username,
    sinteses,
    metricas_agregadas: { followers_total: followersTotal, ...metricasPorRede },
  });
  totalCost += usdCost(consol.usage);

  const scoreRes = computeScore({
    freqTecnico,
    freqIntermediario,
    freqProva,
    followersTotal,
    engRate,
    coerencia: consol.data.coerencia_cross_plat,
    fit,
    recorrencia,
  });

  const finalBrief = {
    ...consol.data,
    score_embaixador: scoreRes.score,
    veredicto_letra: scoreRes.letra,
    recomendacao_aborda: scoreRes.recomendacao,
  };

  if (!opts.dryRun) {
    await upsertCrossBrief({
      username,
      brief: finalBrief,
      costTotalUsd: totalCost,
      model: consol.model,
      rawOutput: { llm: consol.data, score: scoreRes, fit, recorrencia, freqTecnico, freqProva },
    });
  }

  logger.info(
    `[${username}] veredicto ${scoreRes.letra} (${scoreRes.score}) · rec=${scoreRes.recomendacao} · US$${totalCost.toFixed(4)}`,
    { breakdown: scoreRes.breakdown },
  );

  return { username, costUsd: totalCost, consolidated: true, score: scoreRes.score, letra: scoreRes.letra };
}
