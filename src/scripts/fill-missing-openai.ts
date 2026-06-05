import 'dotenv/config';
// Os 6 posts faltantes sao bloqueados pelo FILTRO DE CONTEUDO do Azure OpenAI
// (falso-positivo em conteudo de saude). Forcamos a OpenAI DIRETA — fallback ja
// suportado pelo projeto (README / .env OPENAI_API_KEY) — removendo o endpoint
// Azure ANTES da 1a chamada (o cliente em src/lib/openai.ts e lazy e le
// config.useAzure, que e getter de process.env).
delete process.env.AZURE_OPENAI_ENDPOINT;

import { config } from '../config';
import { usdToBrl } from '../lib/cost';
import { logger } from '../lib/logger';
import { processProfile, type ProfileResult } from '../pipeline/orchestrator';

// Aceita usernames por argv; default = os 6 perfis com lacuna original.
const USERS =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : [
        'fernandalandeiro',
        'odontologiadicas',
        'aleluglio',
        'universosaudeintegrativa',
        'eslen.delanogare',
        'patriciadavidson.nutri',
      ];

async function main() {
  logger.info(`Provider forcado: ${config.useAzure ? 'Azure (ERRO!)' : 'OpenAI direta'} · modelo=${config.openaiModel}`, {});
  const opts = { limit: 50, dryRun: false, minSyntheses: 1, skipExisting: true };
  const results: ProfileResult[] = [];
  for (const u of USERS) {
    try {
      results.push(await processProfile(u, opts));
    } catch (err) {
      logger.error(`Falha no perfil ${u}`, { error: err instanceof Error ? err.message : String(err) });
    }
  }
  const totalUsd = results.reduce((s, r) => s + r.costUsd, 0);
  logger.info('=== Resumo fill-missing-openai ===', {
    perfis: results.length,
    consolidados: results.filter((r) => r.consolidated).length,
    vereditos: results.map((r) => `${r.username}:${r.letra ?? '—'}(${r.score ?? '—'})`),
    custo_usd: Number(totalUsd.toFixed(4)),
    custo_brl: Number(usdToBrl(totalUsd).toFixed(2)),
  });
}

main().catch((err) => {
  logger.error('fill-missing-openai falhou', { error: err instanceof Error ? err.stack ?? err.message : String(err) });
  process.exit(1);
});
