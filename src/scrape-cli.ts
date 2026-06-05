import { PLATFORMS, config, type Platform } from './config';
import { logger } from './lib/logger';
import { runScraper, type RunScraperOptions } from './scrapers/runner';

interface Args {
  username?: string;
  platform?: Platform;
  all: boolean;
  limit: number;
  dryRun: boolean;
  force: boolean;
}

function printHelp(): void {
  logger.info(
    [
      'Scraper de Embaixadores (Auton) — uso:',
      '  npm run scrape -- --all                      raspa perfis ativos cujo last_scraped_at venceu',
      '  npm run scrape -- --username <handle>        raspa 1 perfil em todas as redes elegiveis',
      '  npm run scrape -- --platform youtube --all   roda so a rede informada',
      'Flags:',
      '  --limit <n>      posts por (perfil, rede). Default: POSTS_PER_PROFILE (50)',
      '  --force          ignora last_scraped_at e raspa todos selecionados',
      '  --dry-run        chama APIs mas NAO grava nem marca last_scraped_at',
    ].join('\n'),
  );
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    all: false,
    limit: config.postsPerProfile,
    dryRun: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--username':
      case '-u':
        args.username = argv[++i];
        break;
      case '--platform':
        args.platform = argv[++i] as Platform;
        break;
      case '--all':
        args.all = true;
        break;
      case '--limit':
        args.limit = Number(argv[++i]);
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.all && !args.username) {
    printHelp();
    process.exit(1);
  }
  if (args.platform && !PLATFORMS.includes(args.platform)) {
    logger.error(`--platform deve ser um de: ${PLATFORMS.join(', ')}`);
    process.exit(1);
  }

  const opts: RunScraperOptions = {
    limit: args.limit,
    dryRun: args.dryRun,
    force: args.force,
    username: args.username,
    platform: args.platform,
  };

  const results = await runScraper(opts);

  const ok = results.filter((r) => !r.error);
  const fail = results.filter((r) => r.error);
  const totalPosts = ok.reduce((s, r) => s + r.inserted, 0);

  logger.info('=== Resumo Scraper ===', {
    targets: results.length,
    sucesso: ok.length,
    falha: fail.length,
    posts_total: totalPosts,
    dryRun: args.dryRun,
  });

  if (fail.length > 0) {
    for (const f of fail) {
      logger.warn(`falhou: ${f.username}/${f.platform}`, { error: f.error });
    }
    process.exit(2);
  }
}

main().catch((err) => {
  logger.error('Erro fatal no scraper', {
    error: err instanceof Error ? (err.stack ?? err.message) : String(err),
  });
  process.exit(1);
});
