-- =====================================================================
-- 0004 · reference_profiles: dedupe + UNIQUE(username, platform)
-- ---------------------------------------------------------------------
-- CONTEXTO: a tabela reference_profiles NAO tem unique constraint em
-- (username, platform). Um processo externo (o scraper) re-semeia os perfis
-- periodicamente via INSERT simples, criando linhas duplicadas (em 2026-05-27
-- havia 104 linhas = 52 pares duplicados; a 2a copia vem vazia, sem
-- last_scraped_at). O pipeline deste repo NAO causa isso (so faz select/update).
--
-- Este script (1) deduplica mantendo a MELHOR linha por (username, platform)
-- — prioriza last_scraped_at preenchido, depois last_analysis_at, depois
-- analyzed_posts_count, e por fim a mais ANTIGA — e (2) adiciona a UNIQUE.
--
-- ⚠ DEPOIS DE APLICAR: o scraper externo PRECISA passar a usar UPSERT
--   (ON CONFLICT (username, platform) DO UPDATE ...) — senao o proximo
--   INSERT vai FALHAR com violacao de unique. Ajuste o scraper antes/junto.
--
-- Aplicar via Supabase SQL Editor (a service role key nao executa DDL).
-- =====================================================================

BEGIN;

-- (1) Dedupe — remove todas as copias menos a "melhor" de cada (username, platform)
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY username, platform
      ORDER BY
        (last_scraped_at  IS NOT NULL) DESC,
        (last_analysis_at IS NOT NULL) DESC,
        COALESCE(analyzed_posts_count, 0) DESC,
        created_at ASC
    ) AS rn
  FROM reference_profiles
)
DELETE FROM reference_profiles rp
USING ranked r
WHERE rp.id = r.id
  AND r.rn > 1;

-- (2) UNIQUE constraint (idempotente)
ALTER TABLE reference_profiles
  DROP CONSTRAINT IF EXISTS reference_profiles_username_platform_key;
ALTER TABLE reference_profiles
  ADD  CONSTRAINT reference_profiles_username_platform_key UNIQUE (username, platform);

COMMIT;
