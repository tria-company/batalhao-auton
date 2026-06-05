import { z } from 'zod';
import { config } from '../config';
import { usdCost, usdToBrl } from '../lib/cost';
import { logger } from '../lib/logger';
import { parseStructured } from '../lib/openai';

/**
 * Smoke test do LLM: faz UMA chamada com Structured Outputs e mostra
 * resposta + uso + custo. Valida o provedor ativo (Azure ou OpenAI).
 *   npx tsx src/scripts/check-llm.ts
 */
const Schema = z.object({
  saudacao: z.string(),
  numero: z.number().int(),
  ok: z.boolean(),
});

async function main(): Promise<void> {
  logger.info('Provedor LLM ativo', {
    provider: config.useAzure ? 'Azure OpenAI' : 'OpenAI direta',
    endpoint: config.useAzure ? config.azureEndpoint : '(api.openai.com)',
    deployment_ou_modelo: config.useAzure ? config.azureDeployment : config.openaiModel,
    apiVersion: config.useAzure ? config.azureApiVersion : undefined,
  });

  const r = await parseStructured({
    system: 'Você responde em português do Brasil, apenas no formato pedido.',
    user: 'Devolva: uma saudacao curta, o numero 7 e ok=true.',
    schema: Schema,
    schemaName: 'smoke',
  });

  logger.info('Resposta estruturada', { data: r.data, model: r.model });
  const usd = usdCost(r.usage);
  logger.info('Uso & custo', {
    usage: r.usage,
    usd: Number(usd.toFixed(6)),
    brl: Number(usdToBrl(usd).toFixed(5)),
  });
  logger.info('✅ LLM respondeu e validou o schema.');
}

main().catch((e) => {
  logger.error('smoke do LLM falhou', {
    error: e instanceof Error ? e.stack ?? e.message : String(e),
  });
  process.exit(1);
});
