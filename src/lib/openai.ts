import OpenAI, { AzureOpenAI } from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import type { z } from 'zod';
import { config } from '../config';
import type { Usage } from './cost';

let _client: OpenAI | undefined;
function client(): OpenAI {
  if (!_client) {
    _client = config.useAzure
      ? new AzureOpenAI({
          endpoint: config.azureEndpoint!,
          apiKey: config.azureApiKey,
          apiVersion: config.azureApiVersion,
        })
      : new OpenAI({ apiKey: config.openaiApiKey });
  }
  return _client;
}

export interface StructuredResult<T> {
  data: T;
  usage: Usage;
  model: string;
}

/**
 * Chamada unica e tipada ao LLM com Structured Outputs (json_schema via Zod).
 * Centraliza a integracao com o SDK da OpenAI — se a assinatura do SDK mudar
 * entre versoes, ajusta-se so aqui.
 *
 * `images` (URLs) sao anexadas como partes de conteudo de visao (agentes 2/3
 * e thumbnails de 4/5). Texto-only quando `images` vazio.
 */
export async function parseStructured<S extends z.ZodTypeAny>(params: {
  system: string;
  user: string;
  schema: S;
  schemaName: string;
  images?: string[];
  model?: string;
  temperature?: number;
}): Promise<StructuredResult<z.infer<S>>> {
  // No Azure o "model" e o nome do deployment (1 deployment p/ todos os agentes).
  const model = config.useAzure ? config.azureDeployment : params.model ?? config.openaiModel;
  const images = params.images ?? [];

  const userContent =
    images.length > 0
      ? [
          { type: 'text' as const, text: params.user },
          ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
        ]
      : params.user;

  const completion = await client().beta.chat.completions.parse({
    model,
    temperature: params.temperature ?? 0,
    messages: [
      { role: 'system', content: params.system },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { role: 'user', content: userContent as any },
    ],
    response_format: zodResponseFormat(params.schema, params.schemaName),
  });

  const message = completion.choices[0]?.message;
  if (!message || message.parsed == null) {
    throw new Error(
      message?.refusal ? `LLM refusal: ${message.refusal}` : 'LLM nao retornou output parseado',
    );
  }

  const u = completion.usage;
  return {
    data: message.parsed as z.infer<S>,
    model,
    usage: {
      promptTokens: u?.prompt_tokens ?? 0,
      completionTokens: u?.completion_tokens ?? 0,
      cachedTokens: u?.prompt_tokens_details?.cached_tokens ?? 0,
    },
  };
}
