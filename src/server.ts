/**
 * Servidor HTTP do Batalhão (Hono). Espelha o padrão de extração automática do
 * Concorrentes (`/webhooks/apify` + `/cron/*`) sem refatorar o resto do código:
 *
 *  - `POST /webhooks/apify`         → fim de scrape Apify (IG/TT). Busca os items
 *                                     do dataset, reusa o `mapPost*` do adapter
 *                                     correspondente e chama `upsertScrapedPost`.
 *                                     YouTube NÃO entra por aqui (yt-dlp local).
 *  - `GET  /cron/scrape-youtube`    → roda `runScraper({platform:'youtube'})` —
 *                                     yt-dlp local, processo do servidor.
 *  - `GET  /cron/run-pipeline`      → dispara `npm run pipeline -- --all` (spawn).
 *  - `GET  /healthz`                → 200 OK.
 */
import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { spawn } from 'node:child_process';
import { config, type Platform } from './config';
import { logger } from './lib/logger';
import { upsertScrapedPost, markScraped } from './db/scrappersContents';
import {
  extractInstagramPostsFromItems,
  extractInstagramUsername,
  mapPostInstagram,
} from './scrapers/instagram';
import { castTiktokItems, mapPostTiktok } from './scrapers/tiktok';
import { runScraper } from './scrapers/runner';

const APIFY_TOKEN = config.apifyToken;
const APIFY_SECRET = (process.env.APIFY_WEBHOOK_SECRET ?? '').trim();
const CRON_SECRET = (process.env.CRON_SECRET ?? '').trim();

const INSTAGRAM_HINT = /instagram-profile-scraper/i;
const TIKTOK_HINT = /tiktok-scraper/i;

interface ApifyWebhookBody {
  eventType?: string;
  // Alguns templates aninham em `resource`; outros têm no topo. Cobrimos os dois.
  resource?: { id?: string; actId?: string; defaultDatasetId?: string };
  actorId?: string;
  actorRunId?: string;
  defaultDatasetId?: string;
}

async function apifyGet<T = unknown>(path: string): Promise<T> {
  if (!APIFY_TOKEN) throw new Error('APIFY_TOKEN ausente');
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`https://api.apify.com/v2${path}${sep}token=${APIFY_TOKEN}`);
  if (!r.ok) throw new Error(`Apify ${path}: HTTP ${r.status}`);
  const json = (await r.json()) as { data?: T } & T;
  return (json?.data ?? json) as T;
}

function platformFromActor(actorFull: string | undefined): Platform | null {
  if (!actorFull) return null;
  if (INSTAGRAM_HINT.test(actorFull)) return 'instagram';
  if (TIKTOK_HINT.test(actorFull)) return 'tiktok';
  return null;
}

const app = new Hono();

app.get('/healthz', (c) => c.text('ok'));

app.post('/webhooks/apify', async (c) => {
  if (APIFY_SECRET && c.req.header('x-apify-secret') !== APIFY_SECRET) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const body = (await c.req.json().catch(() => ({}))) as ApifyWebhookBody;
  const runId = body.resource?.id ?? body.actorRunId;
  const actId = body.resource?.actId ?? body.actorId;
  const datasetId = body.resource?.defaultDatasetId ?? body.defaultDatasetId;
  if (!runId || !actId || !datasetId) {
    return c.json({ error: 'missing runId/actId/defaultDatasetId no payload' }, 400);
  }

  try {
    // 1. Identifica o actor (nome humano) → plataforma.
    const act = await apifyGet<{ username?: string; name?: string }>(`/acts/${actId}`);
    const actorFull = `${act?.username ?? '?'}/${act?.name ?? '?'}`;
    const platform = platformFromActor(actorFull);
    if (!platform) {
      logger.warn(`Apify webhook: actor não-suportado pelo Batalhão`, { actor: actorFull, runId });
      return c.json({ ok: true, skipped: true, reason: 'unsupported-actor', actor: actorFull });
    }

    // 2. Items do dataset (até 2000 por run — suficiente p/ um perfil).
    const itemsRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=2000`,
    );
    if (!itemsRes.ok) throw new Error(`dataset ${datasetId}: HTTP ${itemsRes.status}`);
    const items = (await itemsRes.json()) as unknown[];

    // 3. Parse + upsert.
    let username: string | null = null;
    let inserted = 0;

    if (platform === 'instagram') {
      username = extractInstagramUsername(items);
      if (username) {
        const posts = extractInstagramPostsFromItems(items)
          .map(mapPostInstagram)
          .filter((p) => p.postid.length > 0);
        for (const p of posts) await upsertScrapedPost(username, 'instagram', p);
        if (posts.length) await markScraped(username, 'instagram');
        inserted = posts.length;
      }
    } else if (platform === 'tiktok') {
      // O scraper do TikTok não devolve `username` por item — pega do input da run.
      const run = await apifyGet<{ options?: { input?: any }; input?: any }>(`/actor-runs/${runId}`);
      const input = run?.options?.input ?? run?.input ?? {};
      username = (Array.isArray(input.profiles) ? input.profiles[0] : input.username) ?? null;
      if (username) {
        const posts = castTiktokItems(items)
          .map(mapPostTiktok)
          .filter((p) => p.postid.length > 0);
        for (const p of posts) await upsertScrapedPost(username, 'tiktok', p);
        if (posts.length) await markScraped(username, 'tiktok');
        inserted = posts.length;
      }
    }

    if (!username) {
      logger.warn(`Apify webhook: username não-resolvido`, { actor: actorFull, runId });
      return c.json({ ok: true, skipped: true, reason: 'no-username', actor: actorFull });
    }

    logger.info(`Apify webhook processado`, { actor: actorFull, platform, username, inserted });
    return c.json({ ok: true, platform, username, inserted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('Apify webhook falhou', { error: msg });
    return c.json({ error: msg }, 500);
  }
});

app.get('/cron/scrape-youtube', async (c) => {
  if (CRON_SECRET && c.req.header('authorization') !== `Bearer ${CRON_SECRET}`) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  try {
    const results = await runScraper({
      limit: config.postsPerProfile,
      dryRun: false,
      force: false,
      platform: 'youtube',
    });
    const ok = results.filter((r) => !r.error).length;
    const inserted = results.reduce((s, r) => s + r.inserted, 0);
    return c.json({ ok: true, targets: results.length, sucesso: ok, inserted });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

app.get('/cron/run-pipeline', (c) => {
  if (CRON_SECRET && c.req.header('authorization') !== `Bearer ${CRON_SECRET}`) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  // Spawn em background — o cron diário não precisa do resultado síncrono.
  const child = spawn('npm', ['run', 'pipeline', '--', '--all'], { stdio: 'inherit', shell: true });
  child.on('close', (code) => logger.info('pipeline finalizado', { code }));
  child.on('error', (e) => logger.error('pipeline spawn falhou', { error: e.message }));
  return c.json({ ok: true, started: true });
});

const port = Number(process.env.PORT_BATALHAO ?? 4112);
serve({ fetch: app.fetch, port }, () => {
  logger.info(`Batalhão server pronto em :${port}`, {});
});
