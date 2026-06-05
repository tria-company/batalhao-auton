-- =====================================================================
-- 0003 · Tabelas de apoio (create-if-missing)
-- ---------------------------------------------------------------------
-- *** NAO RODE neste projeto ***
-- reference_profiles, profile_synthesis e profile_narrative_shifts JA EXISTEM
-- (com shapes proprios: profile_synthesis e FLAT, narrative usa de_discurso/
-- para_discurso, reference_profiles e por (username, platform) e os seguidores
-- vem de profile_bio). O codigo (src/db/*.ts) ja foi alinhado a esses shapes.
-- Mantido apenas como referencia para ambientes limpos.
-- ---------------------------------------------------------------------
-- O PRD trata `reference_profiles`, `profile_synthesis` e
-- `profile_narrative_shifts` como JA EXISTENTES. Este arquivo so as cria
-- SE estiverem ausentes, no formato que o pipeline espera, para que a
-- implementacao rode num ambiente limpo. Se as suas tabelas ja existem
-- com outro shape, NAO rode este arquivo — reconcilie manualmente o
-- mapeamento em src/db/*.ts.
-- `scrappers_contents` (fonte de posts) NAO e criada aqui: e populada por
-- outro processo (fora de escopo) — ver mapeamento em src/db/posts.ts.
-- =====================================================================

-- Registro de perfis ativos + status do pipeline
CREATE TABLE IF NOT EXISTS reference_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  is_active boolean DEFAULT true,
  followers_total bigint,
  pipeline_status text DEFAULT 'pendente',  -- pendente | processando | completo | erro
  updated_at timestamptz DEFAULT NOW()
);

-- Identidade do criador por (perfil, rede) — saida do Agente 6
CREATE TABLE IF NOT EXISTS profile_synthesis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  username text NOT NULL,
  posicionamento text,
  promessa_principal text,
  voz_tom text,
  publico_alvo text,
  diferencial text,
  padroes_fortes jsonb,
  padroes_fracos jsonb,
  evolucao_narrativa jsonb,
  assuntos_novos jsonb,
  resumo_executivo text,
  sinais_calculados jsonb,   -- rubrica deterministica usada na sintese
  modelo_usado text,
  custo_usd numeric,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  UNIQUE (platform, username)
);

-- Mudancas narrativas (append) — INSERTs do Agente 6
CREATE TABLE IF NOT EXISTS profile_narrative_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  username text NOT NULL,
  quando text,
  de text,
  para text,
  evidencia text,
  created_at timestamptz DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pns_username ON profile_narrative_shifts(username);
