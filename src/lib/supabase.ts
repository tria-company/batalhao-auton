import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

let _client: SupabaseClient | undefined;

/**
 * Cliente Supabase com a SERVICE ROLE (escrita server-side, bypassa RLS).
 * Lazy: so exige as env vars quando realmente usado (testes unitarios das
 * rubricas nao tocam o banco).
 */
export function getSupabase(): SupabaseClient {
  if (!_client) {
    _client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}
