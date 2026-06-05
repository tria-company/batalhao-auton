import type { Platform } from '../config';
import { runOrganizador } from '../agents/organizador';
import { mapRawRow } from '../db/posts';
import { logger } from '../lib/logger';
import { getSupabase } from '../lib/supabase';
import { transcribeVideo } from '../lib/transcribe';

/**
 * Prova A/B do efeito da transcricao no Organizador: classifica o MESMO post
 * COM e SEM transcricao e compara nivel_tecnico / tem_prova / tema.
 *   npx tsx src/scripts/check-organizador.ts [postid]
 * Default: TikTok tecnico do doutorbarakat (autismo/risperidona).
 */
async function main(): Promise<void> {
  const postid = process.argv[2] ?? '7636046504926530824';
  const sb = getSupabase();
  const { data, error } = await sb.from('scrappers_contents').select('*').eq('postid', postid).limit(1);
  if (error) throw new Error(error.message);
  const row = data?.[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error(`post ${postid} nao encontrado`);

  const raw = mapRawRow(row, row['platform'] as Platform, String(row['username']));
  logger.info('Post', {
    postid,
    platform: raw.platform,
    mediatype: raw.mediatype,
    duration: raw.duration_seconds,
    legenda: raw.alttext.slice(0, 120),
  });

  const t = await transcribeVideo({
    videourl: raw.videourl,
    pageurl: raw.posturl,
    durationSeconds: raw.duration_seconds,
  });
  logger.info('Transcricao', { chars: t?.text.length ?? 0, trecho: t?.text.slice(0, 140) ?? null });

  const sem = await runOrganizador(raw, null);
  logger.info('Organizador SEM transcricao', {
    nivel_tecnico: sem.data.nivel_tecnico,
    tem_prova: sem.data.tem_prova,
    tema_principal: sem.data.tema_principal,
  });

  const com = await runOrganizador(raw, t?.text ?? null);
  logger.info('Organizador COM transcricao', {
    nivel_tecnico: com.data.nivel_tecnico,
    tem_prova: com.data.tem_prova,
    tema_principal: com.data.tema_principal,
  });
}

main().catch((e) => {
  logger.error('check-organizador falhou', {
    error: e instanceof Error ? e.stack ?? e.message : String(e),
  });
  process.exit(1);
});
