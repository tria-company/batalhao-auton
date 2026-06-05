import type { Platform } from '../config';
import { getSupabase } from '../lib/supabase';

export type PipelineStatus = 'pendente' | 'processando' | 'completo' | 'erro';

/** Lista os usernames ativos (distintos) de reference_profiles. */
export async function getActiveUsernames(): Promise<string[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('reference_profiles')
    .select('username')
    .eq('is_active', true);
  if (error) throw new Error(`Erro lendo reference_profiles: ${error.message}`);
  const set = new Set<string>();
  for (const r of data ?? []) {
    const u = (r as { username?: string }).username;
    if (u) set.add(u);
  }
  return [...set];
}

export interface ProfileBio {
  followers: number;
  posts_count: number;
  is_verified: boolean;
}

/**
 * Metricas de bio por (perfil, rede), de profile_bio. Para YouTube usa
 * subscribers_count quando followers_count nao se aplica.
 */
export async function getProfileBio(username: string, platform: Platform): Promise<ProfileBio> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('profile_bio')
    .select('followers_count, subscribers_count, posts_count, is_verified')
    .eq('username', username)
    .eq('platform', platform)
    .limit(1);
  if (error) throw new Error(`Erro lendo profile_bio: ${error.message}`);
  const row = (data?.[0] ?? {}) as {
    followers_count?: number | null;
    subscribers_count?: number | null;
    posts_count?: number | null;
    is_verified?: boolean | null;
  };
  return {
    followers: Number(row.followers_count ?? row.subscribers_count ?? 0),
    posts_count: Number(row.posts_count ?? 0),
    is_verified: Boolean(row.is_verified ?? false),
  };
}

/**
 * Atualiza pipeline_status em reference_profiles. Como a tabela e
 * por (username, platform), atualiza so a linha da rede quando `platform`
 * e informado; senao todas as linhas do username.
 */
export async function setPipelineStatus(
  username: string,
  status: PipelineStatus,
  platform?: Platform,
): Promise<void> {
  const sb = getSupabase();
  let q = sb.from('reference_profiles').update({ pipeline_status: status }).eq('username', username);
  if (platform) q = q.eq('platform', platform);
  const { error } = await q;
  if (error) throw new Error(`Erro atualizando pipeline_status de ${username}: ${error.message}`);
}
