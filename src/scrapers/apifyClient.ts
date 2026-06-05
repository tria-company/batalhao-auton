import { config } from '../config';

/**
 * Roda um actor da Apify pelo endpoint sincrono `run-sync-get-dataset-items`
 * — bloqueia ate o actor terminar e devolve o array de itens do dataset.
 * Timeout padrao do Apify e 5 min; ok pros 31 perfis x 50 posts.
 *
 * O actor ID e no formato `username~actor-name` (ex.: `apify~instagram-profile-scraper`).
 */
export async function runApifyActor(
  actorId: string,
  input: Record<string, unknown>,
): Promise<unknown[]> {
  if (!config.apifyToken) {
    throw new Error('APIFY_TOKEN nao configurado no .env (necessario p/ Instagram/TikTok)');
  }
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(
    actorId,
  )}/run-sync-get-dataset-items?token=${encodeURIComponent(config.apifyToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Apify ${actorId} HTTP ${res.status}: ${txt.slice(0, 400)}`);
  }
  return (await res.json()) as unknown[];
}
