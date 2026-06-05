import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
type Row = Record<string, unknown>;

async function main() {
  // Todos os tiktok ativos em reference_profiles
  const { data: rp } = await sb
    .from('reference_profiles')
    .select('username, pipeline_status, last_scraped_at')
    .eq('platform', 'tiktok')
    .eq('is_active', true);

  // Sinteses tiktok existentes
  const { data: syn } = await sb.from('profile_synthesis').select('username').eq('platform', 'tiktok');
  const synSet = new Set((syn ?? []).map((r) => String((r as Row).username)));

  console.log(`reference_profiles tiktok ativos: ${(rp ?? []).length}\n`);
  console.log('username | #posts_scrappers | synth? | status | last_scraped');
  let comMaterial = 0;
  for (const r of (rp ?? []) as Row[]) {
    const u = String(r.username);
    const { count } = await sb
      .from('scrappers_contents')
      .select('*', { count: 'exact', head: true })
      .eq('platform', 'tiktok')
      .eq('username', u);
    const n = count ?? 0;
    if (n > 0) comMaterial++;
    console.log(
      `${u} | ${n} | ${synSet.has(u) ? 'sim' : 'NAO'} | ${r.pipeline_status} | ${r.last_scraped_at ?? 'null'}`,
    );
  }
  console.log(`\nTikTok com material: ${comMaterial} · sem material: ${(rp ?? []).length - comMaterial}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
