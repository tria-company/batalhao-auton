import { PLATFORMS } from '../config';
import { getActiveUsernames, getProfileBio } from '../db/profiles';
import { getTopPosts } from '../db/posts';
import { logger } from '../lib/logger';

/**
 * Validacao READ-ONLY contra o Supabase real: confirma que o mapeamento
 * (reference_profiles -> profile_bio -> scrappers_contents) le os dados.
 * NAO grava nada e NAO chama a OpenAI.
 *   npx tsx src/scripts/check-db.ts [username]
 */
async function main(): Promise<void> {
  const arg = process.argv[2];
  const usernames = await getActiveUsernames();
  logger.info(`reference_profiles ativos: ${usernames.length}`, {
    amostra: usernames.slice(0, 8),
  });

  const target = arg ?? usernames[0];
  if (!target) {
    logger.warn('Nenhum perfil para inspecionar.');
    return;
  }

  logger.info(`Inspecionando ${target} nas 3 redes…`, {});
  for (const platform of PLATFORMS) {
    const bio = await getProfileBio(target, platform);
    const posts = await getTopPosts(platform, target, 3);
    logger.info(`  ${platform}: ${posts.length} posts · ${bio.followers} seguidores`, {});
    const p = posts[0];
    if (p) {
      logger.info(`    exemplo`, {
        postid: p.postid,
        mediatype: p.mediatype,
        iscarousel: p.iscarousel,
        duration_seconds: p.duration_seconds,
        mediaurl: p.mediaurl ? p.mediaurl.slice(0, 70) + '…' : null,
        likes: p.metrics.likes_count,
        views: p.metrics.views_count,
        posted_at: p.posted_at,
      });
    }
  }
}

main().catch((err) => {
  logger.error('check-db falhou', { error: err instanceof Error ? err.stack ?? err.message : String(err) });
  process.exit(1);
});
