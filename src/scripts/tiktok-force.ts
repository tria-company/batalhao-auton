import 'dotenv/config';
// Re-analise FORCED (do zero) do TikTok dos 5 perfis que tem material.
// - OpenAI direta (o filtro do Azure da falso-positivo em conteudo de saude).
// - Transcricao DESLIGADA: o Azure (deployment de transcricao) esta off neste
//   run e seriam ~250 downloads yt-dlp desperdicados.
// Setamos as envs ANTES de importar config (dinamico), pois config.transcribeVideos
// e calculado no load do modulo (nao e getter).
process.env.TRANSCRIBE_VIDEOS = 'false';
delete process.env.AZURE_OPENAI_ENDPOINT;

const USERS = ['doutorbarakat', 'farmaconapratica', 'amandafitas', 'isabellalacerda_nutri', 'eslen.delanogare'];

async function main() {
  const { config } = await import('../config');
  const { processProfile, processProfilePlatform } = await import('../pipeline/orchestrator');
  const { usdToBrl } = await import('../lib/cost');
  const { logger } = await import('../lib/logger');

  logger.info(
    `Provider=${config.useAzure ? 'AZURE(ERRO!)' : 'OpenAI direta'} · modelo=${config.openaiModel} · transcribe=${config.transcribeVideos}`,
    {},
  );
  const base = { limit: 50, dryRun: false, minSyntheses: 1 };
  let total = 0;
  const out: string[] = [];
  for (const u of USERS) {
    // 1) Force: re-analisa TODOS os posts de TikTok do zero + re-sintetiza TikTok.
    const tt = await processProfilePlatform(u, 'tiktok', { ...base, skipExisting: false });
    total += tt.costUsd;
    logger.info(`[${u}] TikTok re-analisado FORCED: ${tt.postCount} posts`, {});
    // 2) Re-consolida o perfil (le IG/YT existentes sem re-analisar; usa o TikTok fresco).
    const res = await processProfile(u, { ...base, skipExisting: true });
    total += res.costUsd;
    out.push(`${u}:${res.letra ?? '—'}(${res.score ?? '—'})`);
  }
  logger.info('=== Resumo tiktok-force ===', {
    perfis: USERS.length,
    vereditos: out,
    custo_usd: Number(total.toFixed(4)),
    custo_brl: Number(usdToBrl(total).toFixed(2)),
  });
}
main().catch((e) => {
  console.error('tiktok-force falhou:', e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
