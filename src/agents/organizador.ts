import { config } from '../config';
import type { RawPost } from '../domain';
import { parseStructured, type StructuredResult } from '../lib/openai';
import { withRetry } from '../lib/retry';
import { ORGANIZADOR_PROMPT } from '../prompts';
import {
  organizadorOutputSchema,
  type OrganizadorInput,
  type OrganizadorOutput,
} from '../schemas/organizador';

/**
 * Agente 1 · ORGANIZADOR (Camada 1 — triagem). Classifica 1 post em 9
 * dimensoes. Texto-only (sem visao). Usa OPENAI_MODEL_ORGANIZADOR se definido
 * (ex.: gpt-4.1-nano), senao o modelo default.
 */
export async function runOrganizador(
  raw: RawPost,
  transcript: string | null = null,
): Promise<StructuredResult<OrganizadorOutput>> {
  const input: OrganizadorInput = {
    platform: raw.platform,
    username: raw.username,
    postid: raw.postid,
    alttext: raw.alttext,
    hashtags: raw.hashtags,
    mediatype: raw.mediatype,
    iscarousel: raw.iscarousel,
    duration_seconds: raw.duration_seconds,
  };

  return withRetry(
    () =>
      parseStructured({
        // transcricao (quando houver) entra no payload para guiar nivel_tecnico/tem_prova/tema
        system: ORGANIZADOR_PROMPT,
        user: JSON.stringify({ ...input, transcricao: transcript }),
        schema: organizadorOutputSchema,
        schemaName: 'organizador_output',
        model: config.openaiModelOrganizador ?? config.openaiModel,
      }),
    { label: 'organizador' },
  );
}
