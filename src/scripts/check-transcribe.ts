import { config } from '../config';
import { logger } from '../lib/logger';
import { transcribeVideo } from '../lib/transcribe';

/**
 * Smoke test da transcricao: baixa 1 MP4 do storage, extrai audio, transcreve
 * via Azure e mostra o texto + custo. Nao grava nada no storage.
 *   npx tsx src/scripts/check-transcribe.ts [videourl] [duration]
 *
 * Default: video real de 128s do doutorbarakat (o que batia na guard).
 */
const DEFAULT_URL =
  'https://lasobiogakvjokomhsib.supabase.co/storage/v1/object/public/instagram-media/doutorbarakat/DX7k-_HyCxR.mp4';

async function main(): Promise<void> {
  const url = process.argv[2] ?? DEFAULT_URL;
  const dur = Number(process.argv[3] ?? 128.366);
  // URL de .mp4 (storage) = videourl direto; pagina (tiktok/youtube/instagram) = via yt-dlp.
  const isMp4 = /\.mp4(\?|$)/i.test(url);
  logger.info('Transcrevendo', {
    deployment: config.azureTranscribeDeployment,
    apiVersion: config.azureTranscribeApiVersion,
    via: isMp4 ? 'videourl (download)' : 'yt-dlp (pageurl)',
    url: url.slice(0, 80) + '…',
  });

  const t0 = Date.now();
  const r = await transcribeVideo({
    videourl: isMp4 ? url : null,
    pageurl: isMp4 ? null : url,
    durationSeconds: dur,
  });
  if (!r) {
    logger.error('Sem transcript (desligado ou falhou).');
    process.exit(1);
  }
  logger.info(`✅ Transcrito em ${((Date.now() - t0) / 1000).toFixed(1)}s`, {
    custo_usd: Number(r.costUsd.toFixed(5)),
    chars: r.text.length,
  });
  logger.info('--- TRANSCRIÇÃO (primeiros 800 chars) ---');
  // eslint-disable-next-line no-console
  console.log(r.text.slice(0, 800));
}

main().catch((e) => {
  logger.error('check-transcribe falhou', {
    error: e instanceof Error ? e.stack ?? e.message : String(e),
  });
  process.exit(1);
});
