import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { config } from '../config';

let _client: SupabaseClient | undefined;

/**
 * Cliente Supabase com a SERVICE ROLE (escrita server-side, bypassa RLS).
 * Lazy: so exige as env vars quando realmente usado (testes unitarios das
 * rubricas nao tocam o banco).
 *
 * Em Node < 22 nao ha WebSocket nativo e o RealtimeClient do supabase-js
 * quebra na construcao mesmo sem usarmos Realtime. Por isso passamos `ws`
 * como transport — vale tanto no VPS (Node 20.x) quanto local.
 */
export function getSupabase(): SupabaseClient {
  if (!_client) {
    _client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      realtime: { transport: WebSocket as any },
    });
  }
  return _client;
}
