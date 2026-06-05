-- =====================================================================
-- 0001 · post_analysis — colunas dos especialistas (Camadas 1 e 2)
-- =====================================================================
-- *** OPCIONAL / NAO NECESSARIO neste projeto ***
-- A tabela `post_analysis` JA EXISTE com colunas proprias (gancho_legenda_80c,
-- agentes_executados, custo_total, raw_outputs, etc.). O pipeline grava nelas e
-- joga os campos sem coluna dedicada (composicao, texto_sobreposto_ratio,
-- loop_potencial, titulo_*, thumb_clickability, evergreen_vs_hype,
-- densidade_corte textual) dentro de `raw_outputs` (jsonb) — SEM ALTER.
-- Rode este arquivo SO se preferir colunas dedicadas a guardar tudo em jsonb.
-- =====================================================================
-- Bloco A: EXATAMENTE as 8 colunas listadas no PRD §11.
-- Bloco B: demais colunas que ESTA implementacao grava (Organizador +
--          universais dos especialistas), todas com IF NOT EXISTS — se ja
--          existirem na sua tabela `post_analysis`, viram no-op.
-- Idempotente: pode rodar mais de uma vez sem efeito colateral.
-- ---------------------------------------------------------------------

-- Bloco A — conforme PRD §11 -------------------------------------------
ALTER TABLE post_analysis
  ADD COLUMN IF NOT EXISTS gancho_principal_texto text,
  ADD COLUMN IF NOT EXISTS composicao text,
  ADD COLUMN IF NOT EXISTS texto_sobreposto_ratio numeric,
  ADD COLUMN IF NOT EXISTS loop_potencial text,
  ADD COLUMN IF NOT EXISTS titulo_seo_score text,
  ADD COLUMN IF NOT EXISTS titulo_padrao text,
  ADD COLUMN IF NOT EXISTS thumb_clickability text,
  ADD COLUMN IF NOT EXISTS evergreen_vs_hype text;

-- Bloco B — colunas adicionais usadas pelo pipeline --------------------
-- Chaves / identidade
ALTER TABLE post_analysis
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS postid text,
  ADD COLUMN IF NOT EXISTS username text;

-- Organizador (9 campos universais)
ALTER TABLE post_analysis
  ADD COLUMN IF NOT EXISTS tipo text,
  ADD COLUMN IF NOT EXISTS tema_principal text,
  ADD COLUMN IF NOT EXISTS temas_secundarios jsonb,
  ADD COLUMN IF NOT EXISTS perfil_alvo text,
  ADD COLUMN IF NOT EXISTS nivel_tecnico text,
  ADD COLUMN IF NOT EXISTS tom text,
  ADD COLUMN IF NOT EXISTS tem_prova boolean,
  ADD COLUMN IF NOT EXISTS tem_cta boolean,
  ADD COLUMN IF NOT EXISTS qualidade_legenda text;

-- Especialistas (universais "criativos" + especificos)
ALTER TABLE post_analysis
  ADD COLUMN IF NOT EXISTS tipo_gancho text,
  ADD COLUMN IF NOT EXISTS promessa_central text,
  ADD COLUMN IF NOT EXISTS prova_mostrada text,
  ADD COLUMN IF NOT EXISTS estrutura text,
  ADD COLUMN IF NOT EXISTS cta text,
  ADD COLUMN IF NOT EXISTS gancho_visual text,        -- Agente 2
  ADD COLUMN IF NOT EXISTS arco_narrativo text,       -- Agente 3
  ADD COLUMN IF NOT EXISTS n_slides integer,          -- Agente 3
  ADD COLUMN IF NOT EXISTS slide_payoff integer,      -- Agente 3
  ADD COLUMN IF NOT EXISTS n_claims integer,          -- Agente 3
  ADD COLUMN IF NOT EXISTS qualidade_design text,     -- Agente 3
  ADD COLUMN IF NOT EXISTS consistencia_visual text,  -- Agente 3
  ADD COLUMN IF NOT EXISTS gancho_3s text,            -- Agentes 4/5
  ADD COLUMN IF NOT EXISTS ritmo text,                -- Agente 4
  ADD COLUMN IF NOT EXISTS densidade_corte text,      -- Agente 4
  ADD COLUMN IF NOT EXISTS densidade_jargao text,     -- Agentes 4/5
  ADD COLUMN IF NOT EXISTS som_origem text;           -- Agente 4 (TT-only, null nas outras)

-- Auditoria do pipeline
ALTER TABLE post_analysis
  ADD COLUMN IF NOT EXISTS specialist text,
  ADD COLUMN IF NOT EXISTS specialist_error text,
  ADD COLUMN IF NOT EXISTS modelo_usado text,
  ADD COLUMN IF NOT EXISTS analysis_cost_usd numeric,
  ADD COLUMN IF NOT EXISTS analyzed_at timestamptz;

-- Idempotencia do upsert: precisa de UNIQUE (platform, postid).
-- Se a sua `post_analysis` ainda nao tiver, descomente:
-- ALTER TABLE post_analysis
--   ADD CONSTRAINT post_analysis_platform_postid_key UNIQUE (platform, postid);
