import type { Platform } from '../config';
import type { AnalyzedPost, PostMetrics, RawPost } from '../domain';

/**
 * Rubrica de agregacao DETERMINISTICA do Sintetizador (Agente 6 — PRD §6).
 * O LLM nao recalcula nada disto: recebe estes sinais como verdade e redige.
 *
 * Interpretacoes documentadas (o PRD da o criterio, nao a formula exata):
 *  - "que_printa" = categoria com MAIOR engajamento medio (>= MIN_SUPPORT posts).
 *  - "que_morre"  = categoria com MENOR engajamento medio (>= MIN_SUPPORT posts).
 *  - "assuntos_novos" = temas cuja PRIMEIRA aparicao esta dentro dos ultimos 6
 *    meses (relativo ao post mais recente); peso = % de posts dos ultimos 3
 *    meses com aquele tema.
 *  - "evolucao_narrativa" = mudanca do tema dominante entre trimestres.
 */

const MIN_SUPPORT = 2;
const NEW_TOPIC_WINDOW_MONTHS = 6;
const RECENT_WEIGHT_WINDOW_MONTHS = 3;

/**
 * Engajamento comparavel por plataforma (escalar relativo, nao percentual
 * absoluto). Usado so para ranquear posts/categorias dentro de UMA rede.
 */
export function computeEngagement(
  metrics: PostMetrics,
  platform: Platform,
  followers: number,
): number {
  const interactions =
    metrics.likes_count + metrics.shares_count + metrics.saves_count + metrics.comments_count;
  if (platform === 'instagram') {
    return followers > 0 ? interactions / followers : interactions;
  }
  // tiktok / youtube: alcance medido por views; soma interacoes como reforco.
  const base = metrics.views_count > 0 ? metrics.views_count : interactions;
  return followers > 0 ? base / followers : base;
}

function monthsBetween(a: Date, b: Date): number {
  return (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth());
}

function quarterKey(d: Date): string {
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

interface CategoryStat {
  categoria: string;
  count: number;
  eng_medio: number;
}

function meanEngagementBy(
  posts: AnalyzedPost[],
  keyFn: (p: AnalyzedPost) => string,
): CategoryStat[] {
  const groups = new Map<string, number[]>();
  for (const p of posts) {
    const k = keyFn(p);
    const arr = groups.get(k) ?? [];
    arr.push(p.engagement);
    groups.set(k, arr);
  }
  return [...groups.entries()].map(([categoria, vals]) => ({
    categoria,
    count: vals.length,
    eng_medio: vals.reduce((s, v) => s + v, 0) / vals.length,
  }));
}

function pickTop(stats: CategoryStat[]): CategoryStat | null {
  const eligible = stats.filter((s) => s.count >= MIN_SUPPORT);
  const pool = eligible.length > 0 ? eligible : stats;
  return pool.reduce<CategoryStat | null>((best, s) => (!best || s.eng_medio > best.eng_medio ? s : best), null);
}

function pickBottom(stats: CategoryStat[]): CategoryStat | null {
  const eligible = stats.filter((s) => s.count >= MIN_SUPPORT);
  const pool = eligible.length > 0 ? eligible : stats;
  return pool.reduce<CategoryStat | null>((worst, s) => (!worst || s.eng_medio < worst.eng_medio ? s : worst), null);
}

export interface SynthesisSignals {
  n_posts: number;
  eng_medio_geral: number;
  por_formato: CategoryStat[];
  por_tema: CategoryStat[];
  por_gancho: CategoryStat[];
  formato_que_printa: CategoryStat | null;
  formato_que_morre: CategoryStat | null;
  tema_que_printa: CategoryStat | null;
  tema_que_morre: CategoryStat | null;
  gancho_que_printa: CategoryStat | null;
  assuntos_novos: { tema: string; apareceu_em: string; peso_atual_pct: number }[];
  evolucao_narrativa: { quando: string; de: string; para: string }[];
}

/** Constroi os sinais deterministicos a partir das analises de uma rede. */
export function buildSynthesisSignals(posts: AnalyzedPost[]): SynthesisSignals {
  const porFormato = meanEngagementBy(posts, (p) => p.organizador.tipo);
  const porTema = meanEngagementBy(posts, (p) => p.organizador.tema_principal);
  const porGancho = meanEngagementBy(posts, (p) => p.organizador.tipo); // gancho real vem do especialista; fallback tipo

  const engMedioGeral =
    posts.length > 0 ? posts.reduce((s, p) => s + p.engagement, 0) / posts.length : 0;

  // datas
  const dated = posts.filter((p) => p.posted_at).map((p) => ({ ...p, d: new Date(p.posted_at as string) }));
  const latest = dated.reduce<Date | null>((mx, p) => (!mx || p.d > mx ? p.d : mx), null);

  const assuntos_novos: SynthesisSignals['assuntos_novos'] = [];
  const evolucao_narrativa: SynthesisSignals['evolucao_narrativa'] = [];

  if (latest && dated.length > 0) {
    // primeira aparicao por tema
    const firstSeen = new Map<string, Date>();
    for (const p of dated) {
      const t = p.organizador.tema_principal;
      const prev = firstSeen.get(t);
      if (!prev || p.d < prev) firstSeen.set(t, p.d);
    }
    const recentPosts = dated.filter((p) => monthsBetween(latest, p.d) < RECENT_WEIGHT_WINDOW_MONTHS);
    for (const [tema, first] of firstSeen.entries()) {
      if (monthsBetween(latest, first) < NEW_TOPIC_WINDOW_MONTHS) {
        const withTheme = recentPosts.filter((p) => p.organizador.tema_principal === tema).length;
        const peso = recentPosts.length > 0 ? Math.round((withTheme / recentPosts.length) * 100) : 0;
        assuntos_novos.push({
          tema,
          apareceu_em: `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}`,
          peso_atual_pct: peso,
        });
      }
    }

    // tema dominante por trimestre -> diffs
    const byQuarter = new Map<string, Map<string, number>>();
    for (const p of dated) {
      const q = quarterKey(p.d);
      const counts = byQuarter.get(q) ?? new Map<string, number>();
      const t = p.organizador.tema_principal;
      counts.set(t, (counts.get(t) ?? 0) + 1);
      byQuarter.set(q, counts);
    }
    const quarters = [...byQuarter.keys()].sort();
    const dominantes = quarters.map((q) => {
      const counts = byQuarter.get(q)!;
      const dom = [...counts.entries()].reduce((b, e) => (e[1] > b[1] ? e : b))[0];
      return { q, dom };
    });
    for (let i = 1; i < dominantes.length; i++) {
      const prev = dominantes[i - 1]!;
      const cur = dominantes[i]!;
      if (prev.dom !== cur.dom) {
        evolucao_narrativa.push({ quando: `${prev.q} -> ${cur.q}`, de: prev.dom, para: cur.dom });
      }
    }
  }

  return {
    n_posts: posts.length,
    eng_medio_geral: engMedioGeral,
    por_formato: porFormato,
    por_tema: porTema,
    por_gancho: porGancho,
    formato_que_printa: pickTop(porFormato),
    formato_que_morre: pickBottom(porFormato),
    tema_que_printa: pickTop(porTema),
    tema_que_morre: pickBottom(porTema),
    gancho_que_printa: pickTop(porGancho),
    assuntos_novos,
    evolucao_narrativa,
  };
}

/** Constroi AnalyzedPost a partir de um RawPost + classificacao do Organizador. */
export function toAnalyzedPost(
  raw: RawPost,
  organizador: AnalyzedPost['organizador'],
  followers: number,
): AnalyzedPost {
  return {
    postid: raw.postid,
    posted_at: raw.posted_at,
    engagement: computeEngagement(raw.metrics, raw.platform, followers),
    organizador,
  };
}
