import { config } from './config';
import { getActiveUsernames } from './db/profiles';
import { usdToBrl } from './lib/cost';
import { logger } from './lib/logger';
import { processProfile, type ProfileResult, type RunOptions } from './pipeline/orchestrator';

interface Args {
  username?: string;
  all: boolean;
  limit: number;
  dryRun: boolean;
  minSyntheses: number;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    all: false,
    limit: config.postsPerProfile,
    dryRun: false,
    minSyntheses: 3,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--username':
      case '-u':
        args.username = argv[++i];
        break;
      case '--all':
        args.all = true;
        break;
      case '--limit':
        args.limit = Number(argv[++i]);
        break;
      case '--min-syntheses':
        args.minSyntheses = Number(argv[++i]);
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--force':
        args.force = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }
  return args;
}

function printHelp(): void {
  logger.info(
    [
      'Pipeline de Embaixadores (Auton) — uso:',
      '  npm run pipeline -- --username <handle>     processa 1 perfil (3 redes -> veredicto)',
      '  npm run pipeline -- --all                   processa todos os perfis ativos (reference_profiles)',
      'Flags:',
      '  --limit <n>           posts por (perfil, rede). Default: POSTS_PER_PROFILE (50)',
      '  --min-syntheses <n>   sinteses necessarias p/ consolidar. Default: 3 (PRD)',
      '  --dry-run             roda os agentes mas NAO grava no Supabase',
      '  --force               re-analisa TODOS os posts (default: pula os ja em post_analysis)',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.username && !args.all) {
    printHelp();
    process.exit(1);
  }

  const opts: RunOptions = {
    limit: args.limit,
    dryRun: args.dryRun,
    minSyntheses: args.minSyntheses,
    skipExisting: !args.force,
  };

  const targets = args.all ? await getActiveUsernames() : [args.username as string];

  logger.info(`Processando ${targets.length} perfil(is)`, { dryRun: args.dryRun, limit: args.limit });

  const results: ProfileResult[] = [];
  for (const username of targets) {
    try {
      results.push(await processProfile(username, opts));
    } catch (err) {
      logger.error(`Falha no perfil ${username}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const totalUsd = results.reduce((s, r) => s + r.costUsd, 0);
  logger.info('=== Resumo ===', {
    perfis: results.length,
    consolidados: results.filter((r) => r.consolidated).length,
    custo_usd: Number(totalUsd.toFixed(4)),
    custo_brl: Number(usdToBrl(totalUsd).toFixed(2)),
  });
}

main().catch((err) => {
  logger.error('Erro fatal no pipeline', {
    error: err instanceof Error ? err.stack ?? err.message : String(err),
  });
  process.exit(1);
});
