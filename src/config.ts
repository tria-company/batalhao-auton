import 'dotenv/config';

/**
 * Configuracao central do pipeline. Le variaveis de ambiente (.env).
 * Valores sensiveis (chaves) nunca devem ir ao cliente — este pipeline
 * roda server-side com a service-role do Supabase.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name} (veja .env.example)`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== '' ? v : fallback;
}

export const config = {
  // OpenAI
  get openaiApiKey() {
    return required('OPENAI_API_KEY');
  },
  /** Modelo default de todos os agentes (PRD §10). */
  openaiModel: optional('OPENAI_MODEL', 'gpt-4.1-mini'),
  /** Override opcional do Organizador (ex.: gpt-4.1-nano) — so OpenAI; no Azure use 1 deployment. */
  openaiModelOrganizador: process.env.OPENAI_MODEL_ORGANIZADOR?.trim() || undefined,

  // Azure OpenAI — usado automaticamente quando AZURE_OPENAI_ENDPOINT estiver definido.
  /** True quando rodando via Azure OpenAI (em vez da OpenAI direta). */
  get useAzure() {
    return !!process.env.AZURE_OPENAI_ENDPOINT?.trim();
  },
  /** Endpoint base do recurso Azure (ex.: https://project-ai-tria.cognitiveservices.azure.com). */
  azureEndpoint: process.env.AZURE_OPENAI_ENDPOINT?.trim() || undefined,
  get azureApiKey() {
    return required('AZURE_OPENAI_API_KEY');
  },
  azureApiVersion: optional('AZURE_OPENAI_API_VERSION', '2025-01-01-preview'),
  /** Nome do deployment no Azure (= "model" nas chamadas). */
  azureDeployment: optional('AZURE_OPENAI_DEPLOYMENT', 'gpt-4.1-mini'),

  // Transcricao de audio (Azure gpt-4o-transcribe-diarize) — para videos longos.
  /** Liga a transcricao de video (audio -> texto) antes da analise dos especialistas. */
  transcribeVideos: optional('TRANSCRIBE_VIDEOS', 'true') === 'true',
  azureTranscribeDeployment: optional(
    'AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT',
    'gpt-4o-transcribe-diarize',
  ),
  azureTranscribeApiVersion: optional('AZURE_OPENAI_TRANSCRIBE_API_VERSION', '2025-03-01-preview'),

  // Supabase (service role)
  get supabaseUrl() {
    return required('SUPABASE_URL');
  },
  get supabaseServiceRoleKey() {
    return required('SUPABASE_SERVICE_ROLE_KEY');
  },

  // Pipeline
  postsPerProfile: Number(optional('POSTS_PER_PROFILE', '50')),
  usdBrlRate: Number(optional('USD_BRL_RATE', '6.0')),
  /** Quantos posts processar em paralelo por (perfil, rede). */
  pipelineConcurrency: Number(optional('PIPELINE_CONCURRENCY', '5')),
} as const;

/** As 3 redes suportadas pelo pipeline. */
export const PLATFORMS = ['instagram', 'tiktok', 'youtube'] as const;
export type Platform = (typeof PLATFORMS)[number];
