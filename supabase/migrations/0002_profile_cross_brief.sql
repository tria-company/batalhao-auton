-- =====================================================================
-- 0002 · profile_cross_brief — veredicto final por perfil (Camada 4)
-- Reproduz o SQL do PRD §11 (Agente 7 · Consolidador).
-- =====================================================================
CREATE TABLE IF NOT EXISTS profile_cross_brief (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  rede_mais_escalavel text CHECK (rede_mais_escalavel IN ('instagram','tiktok','youtube')),
  rede_dominante_hoje text,
  coerencia_cross_plat text CHECK (coerencia_cross_plat IN ('alta','media','baixa')),
  ajuste_auton text,
  recomendacao_aborda text CHECK (recomendacao_aborda IN ('sim','esperar','nao')),
  veredicto_letra text CHECK (veredicto_letra IN ('S','A','B','C','D')),
  score_embaixador integer CHECK (score_embaixador BETWEEN 0 AND 100),
  justificativa text,
  gaps_oportunidade jsonb,
  custo_total numeric,
  modelo_usado text,
  raw_output jsonb,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pcb_score ON profile_cross_brief(score_embaixador DESC);
