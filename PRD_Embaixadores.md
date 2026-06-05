# PRD — Pipeline de IA · Análise de Embaixadores (Auton Health)

> **Produto:** Pipeline de avaliação de embaixadores/criadores de conteúdo da **Auton Health**.
> **O que faz:** classifica e pontua perfis de Instagram, TikTok e YouTube em uma arquitetura hierárquica de **4 camadas / 7 agentes**, terminando num **veredicto S/A/B/C/D + score 0–100** por perfil.
> **Origem:** Board Miro `uXjVGif6fQ8=` → diagrama *Pipeline IA — Análise de Embaixadores (Auton)* + documento *PRD — 7 Agentes do Pipeline IA · Auton Embaixadores* (v1.0, 15/mai/2026).
> **Modelo:** **GPT-4.1 mini (OpenAI)** em todos os 7 agentes · **Output:** JSON estrito via **Structured Outputs** (`response_format` json_schema), idioma **pt-BR** · multi-plataforma via chave `platform` em todo input.
> **Custo (estimado):** ≈ **R$ 2,00 / perfil** (3 redes × 50 posts) · ≈ **R$ 64 / 32 perfis ativos** — estimativa por price-ratio; revalidar com tokens reais (ver §10).
> **Decisão de modelo:** o board especificava Claude (Sonnet 4.6 / Haiku 4.5); este projeto adota **GPT-4.1 mini** — ver §10.3.
> **Versão do documento:** 1.0 · **Data:** 2026-05-26 · **Idioma:** pt-BR.

---

## 1. Visão geral & contexto

### 1.1 O que é
Sistema de **inteligência de embaixadores**: dado um perfil de criador de conteúdo de saúde nas redes (Instagram, TikTok, YouTube), o pipeline ingere os posts coletados, analisa cada um, sintetiza a identidade do criador por rede e emite um **veredicto único cross-platform** — uma nota de letra (**S/A/B/C/D**) e um **score 0–100** que respondem a pergunta de negócio: *"vale abordar este criador como embaixador da Auton?"*.

A análise é **hierárquica em 4 camadas**, processada de cima (coleta) para baixo (veredicto), com paralelismo nas Camadas 2 e 3:

```
Coleta IG / TikTok / YouTube  (posts já scrapeados)
        │
   [Camada 1]  ORGANIZADOR (triagem)            ── classifica cada post em 9 dimensões
        │
   [Camada 2]  Especialistas de formato (paralelo)
        ├─ Imagem (IG estático)
        ├─ Carrossel / Slideshow (IG + TT)
        ├─ Vídeo curto (Reel + TT + YT Short ≤90s)
        └─ Vídeo longo (YT >90s)
        │            ▼  upsert → post_analysis (1 linha por post)
   [Camada 3]  Sintetizadores por plataforma (paralelo, 50 posts cada)
        ├─ IG  Synth
        ├─ TT  Synth
        └─ YT  Synth
        │            ▼  upsert → profile_synthesis (1 registro por perfil×rede)
   [Camada 4]  CONSOLIDADOR cross-platform (quando as 3 sínteses estão prontas)
        │            ▼  upsert → profile_cross_brief
        ▼
   Veredicto: letra S/A/B/C/D + score 0–100 + recomendação de abordagem
```

### 1.2 Problema
Avaliar manualmente se um criador é um bom embaixador é lento e subjetivo: depende de varrer dezenas de posts em três redes, perceber padrões de formato/tema/gancho, medir engajamento contra benchmarks e julgar fit com o avatar da Auton. Isso não escala para dezenas de perfis e produz vereditos inconsistentes entre analistas.

### 1.3 Objetivo
Automatizar a avaliação ponta-a-ponta com **custo baixo** (≈ R$ 16,60/perfil) e **saída determinística e auditável** (JSON estrito, score por rubrica fixa), de modo que o time de growth/parcerias receba um ranking acionável de embaixadores sem trabalho braçal de leitura.

### 1.4 Princípios de design (do board)
- **Hierarquia clara:** cada camada só consome o output da anterior; nenhum agente "pula" camada.
- **No Invention:** todo agente devolve **JSON estrito** via **Structured Outputs** (`response_format` json_schema da OpenAI), sempre dentro dos `enum` definidos (categoria desconhecida → `outros`), sem prosa fora do JSON, sem qualificadores subjetivos.
- **Determinismo onde dá:** agregações da Camada 3 e o score da Camada 4 seguem **rubricas determinísticas** — o LLM redige, mas a nota é calculada.
- **Multi-plataforma uniforme:** a chave `platform` viaja em todo input; campos exclusivos de uma rede ficam `null` nas demais.

---

## 2. Objetivos & métricas de sucesso

| Métrica | Alvo |
|---|---|
| Cobertura | Avaliar os perfis ativos de `reference_profiles` (MVP: 32 perfis) |
| Custo por perfil (3 redes × 50 posts) | ≤ **R$ 16,60** (≈ **$2,77**) |
| Custo dos 32 perfis ativos | ≈ **R$ 530** |
| Volume processado por síntese | **50 posts/vídeos** por (perfil, rede) |
| Determinismo do veredicto | Score calculado por rubrica fixa; **letra sempre bate a faixa** |
| Validade do output | 100% das saídas validam como JSON estrito dentro dos `enum` |
| Idempotência | 0 duplicatas — todo `upsert` com `onConflict` composto |
| Resiliência de parsing | 1 retry com `temperature=0` quando o JSON volta inválido |
| Completude do pipeline | `reference_profiles.pipeline_status = 'completo'` ao fim do perfil |

---

## 3. Escopo

### 3.1 Dentro do escopo
- Os **7 agentes** do pipeline (1 triagem + 4 especialistas + 1 sintetizador + 1 consolidador).
- Escrita nas tabelas **`post_analysis`**, **`profile_synthesis`**, **`profile_narrative_shifts`** e na tabela nova **`profile_cross_brief`**.
- **Orquestração** por perfil×rede (loop de posts → síntese → consolidação) com idempotência e retry.
- **Migrations** Supabase (colunas novas em `post_analysis` + criação de `profile_cross_brief`).
- **Rubricas determinísticas** de agregação (Camada 3) e de score (Camada 4).

### 3.2 Fora do escopo
- **Coleta/scraping** dos posts (a tabela `scrappers_contents` já é populada por outro processo; aqui só consumimos os top-N por perfil/rede).
- **Frontend / dashboard** de visualização do ranking de embaixadores.
- **Análise de mídia pesada** (vídeo frame-a-frame, transcrição de áudio): os agentes de vídeo **inferem** ritmo/dinâmica a partir de thumb + legenda + duração + metadados, sem assistir ao vídeo.
- Demais blocos do board (Capítulos de estratégia, schema financeiro Tria, Backend AIOX/Concorrentes — este último é coberto por [PRD.md](PRD.md)).

---

## 4. Usuários & casos de uso

| Persona | Uso |
|---|---|
| **Time de parcerias / embaixadores** | Lê `profile_cross_brief` (veredicto + score + `recomendacao_aborda`) para priorizar quem abordar |
| **Growth / marketing** | Usa `profile_synthesis` (formato/tema/gancho que "printa") para entender o que funciona em cada rede |
| **Estratégia** | Usa `gaps_oportunidade` e `rede_mais_escalavel` para desenhar a entrada do criador com co-branding Auton |
| **Operação de dados** | Acompanha `pipeline_status` em `reference_profiles` e o custo por perfil |

**Contexto Auton (para o veredicto):** plataforma de IA para profissionais integrativos no Brasil. **Avatar ideal:** médica integrativa/funcional faturando R$ 12–25k+/mês. **Embaixador "S"** = autoridade + alcance + tema funcional + recorrência alta + escalável em ≥1 rede com co-branding Auton.

---

## 5. Arquitetura do pipeline (4 camadas)

| Camada | Agente(s) | Roda | Modelo | Entrada | Saída (tabela) |
|---|---|---|---|---|---|
| **1 · Triagem** | ORGANIZADOR | 1× por post | GPT-4.1 mini | 1 post cru | classificação em 9 dimensões → `post_analysis` |
| **2 · Especialistas** *(paralelo)* | Imagem · Carrossel/Slideshow · Vídeo curto · Vídeo longo | 1× por post (1 dos 4, por `tipo`) | GPT-4.1 mini | post + `organizador_output` | campos específicos → `post_analysis` (merge) |
| **3 · Síntese** *(paralelo)* | Sintetizador por plataforma | 1× por (perfil, rede) | GPT-4.1 mini | até 50 análises + métricas + bio | identidade na rede → `profile_synthesis` + `profile_narrative_shifts` |
| **4 · Consolidação** | Consolidador cross-platform | 1× por perfil (3 sínteses prontas) | GPT-4.1 mini | 3 sínteses + métricas agregadas | veredicto → `profile_cross_brief` |

**Roteamento da Camada 2 (`match(organizador_output.tipo)`):**

| `tipo` (saída do Organizador) | Agente especialista | Plataformas |
|---|---|---|
| `imagem` | **Agente 2 · Imagem** | apenas Instagram estático |
| `carrossel` / `slideshow` | **Agente 3 · Carrossel/Slideshow** | IG carrossel + TikTok slideshow |
| `video_curto` | **Agente 4 · Vídeo curto** | Reel + TikTok + YT Short (≤90s) |
| `video_longo` | **Agente 5 · Vídeo longo** | YouTube (>90s) |

---

## 6. Os 7 agentes (especificação)

> Convenções comuns: **output = JSON estrito** em bloco ```json```, **pt-BR**, dentro dos `enum`; categoria desconhecida → `outros`; campos exclusivos de uma rede ficam `null` fora dela. Cada especialista herda os "9 campos universais" do Organizador e acrescenta os seus.

### Agente 1 · ORGANIZADOR (Camada 1 — triagem)
- **Modelo:** GPT-4.1 mini · **Custo (est.):** ≈ R$ 0,001/post · **Plataformas:** todas.
- **Função:** classificar 1 post em **9 dimensões objetivas**. É o primeiro a tocar o post — todo o downstream depende da sua precisão.
- **Tabela:** `post_analysis` (`platform`, `postid`) → **upsert**.

**Input:**
```json
{
  "platform": "instagram | tiktok | youtube",
  "username": "string",
  "postid": "string",
  "alttext": "legenda/título",
  "hashtags": ["..."],
  "mediatype": "image | video | short | slideshow",
  "iscarousel": false,
  "duration_seconds": 47
}
```

**Output (9 campos universais):**
```json
{
  "tipo": "imagem | carrossel | slideshow | video_curto | video_longo",
  "tema_principal": "jejum | microbiota | inflamacao | hormonios | saude_mental | neurologia | obesidade | suplementacao | nutricao | exercicio | sono | longevidade | detox | autoimune | intestino | metabolismo | outros",
  "temas_secundarios": ["até 3"],
  "perfil_alvo": "paciente_final | profissional_saude | ambos",
  "nivel_tecnico": "leigo | intermediario | tecnico",
  "tom": "educativo | provocativo | acolhedor | autoridade | pessoal",
  "tem_prova": true,
  "tem_cta": false,
  "qualidade_legenda": "alta | media | baixa"
}
```

**System Prompt:**
> Você é o Organizador — agente 1 do pipeline de análise de embaixadores da Auton Health. Sua função: classificar 1 post em 9 dimensões objetivas. Você é o primeiro a tocar o post — todos os agentes downstream dependem da sua precisão.
>
> **REGRAS INVIOLÁVEIS:** Nunca inventa categoria fora do enum (escolhe `outros`). Nunca retorna prosa fora do bloco JSON. Nunca usa qualificadores subjetivos.
>
> **FAILURE MODES:** Salada de temas (máx 3 secundários). Tom-default-educativo (avalie de fato). Falsa prova (só `tem_prova:true` com fonte/credencial/caso concreto).
>
> **CONTEXTO PLATAFORMA:** IG = legenda longa = educação. TT = legenda curta, conteúdo no vídeo. YT = título é SEO em CAPS.

---

### Agente 2 · ESPECIALISTA IMAGEM (Camada 2)
- **Modelo:** GPT-4.1 mini · **Plataforma:** apenas Instagram estática · **Custo (est.):** ≈ R$ 0,008/imagem (+ tokens de visão).
- **Função:** único agente que avalia **composição visual e texto-sobre-imagem** do IG estático.

**Input:**
```json
{
  "platform": "instagram",
  "username": "...", "postid": "...",
  "alttext": "legenda",
  "mediaurl": "url",
  "organizador_output": { }
}
```

**Output (universais + 3 específicos):**
```json
{
  "gancho_principal_texto": "≤80c",
  "tipo_gancho": "pergunta | claim | numero | historia | aviso | listagem | curiosidade",
  "promessa_central": "frase única ≤140c",
  "prova_mostrada": "credencial | estudo | cliente | pessoal | nenhuma",
  "estrutura": "lista | tutorial | comparativo | storytelling | misto",
  "cta": "comentario | salvar | compartilhar | clique_bio | nenhum",
  "gancho_visual": "antes_depois | citacao | dado | meme | retrato | infografico | bastidor | ilustracao | outro",
  "composicao": "limpa | caotica | texto_pesado | minimalista",
  "texto_sobreposto_ratio": 0.6
}
```

**System Prompt:**
> Você é o Especialista Imagem — agente 2. Único que avalia composição visual e texto-sobre-imagem do IG estático.
>
> **REGRAS:** Nunca roda fora de IG (retorne `{"error":"platform_not_supported"}`). Nunca inventa texto que não existe (cite literal). `credencial` só com Dr./Dra./CRM no visual.
>
> **FAILURE MODES:** Hallucinated text → transcreva LITERAL os primeiros 80c. Composição-default-limpa → avalie (>40% texto = pesado, <20% elementos = minimalista). Promessa-vazia → frase específica que responde "o que leva embora?".

---

### Agente 3 · ESPECIALISTA CARROSSEL/SLIDESHOW (Camada 2)
- **Modelo:** GPT-4.1 mini · **Plataformas:** IG carrossel + TikTok slideshow · **Custo (est.):** ≈ R$ 0,02/carrossel (+ visão, várias imagens).

**Input:**
```json
{
  "platform": "instagram | tiktok",
  "username": "...", "postid": "...",
  "alttext": "legenda",
  "n_slides": 8,
  "mediaurl": "capa",
  "carouselimages": ["url1","url2","url3"],
  "organizador_output": { }
}
```

**Output (universais + 6 específicos):**
```json
{
  "gancho_principal_texto": "≤80c (texto literal slide 1)",
  "tipo_gancho": "...", "promessa_central": "...",
  "prova_mostrada": "...", "estrutura": "...", "cta": "...",
  "arco_narrativo": "problema_solucao | lista_itens | passo_a_passo | mito_verdade | comparativo | storytelling",
  "n_slides": 8,
  "slide_payoff": 6,
  "n_claims": 3,
  "qualidade_design": "alta | media | baixa",
  "consistencia_visual": "alta | media | baixa"
}
```

**System Prompt:**
> Você é o Especialista Carrossel — agente 3.
>
> **REGRAS:** Nunca em vídeo (retorne `{"error":"wrong_format"}`). Nunca inventa `n_claims`. Nunca `slide_payoff > n_slides`.
>
> **FAILURE MODES:** Capa-como-payoff (payoff costuma estar nos 30% finais). Design-default-media (avalie tipografia + paleta + hierarquia). Mito-verdade não classificado (detecte mesmo sem a palavra).

---

### Agente 4 · ESPECIALISTA VÍDEO CURTO (Camada 2)
- **Modelo:** GPT-4.1 mini · **Plataformas:** Reel + TikTok + YouTube Short (≤90s) · **Custo (est.):** ≈ R$ 0,01/vídeo.
- **Função:** infere ritmo/dinâmica **sem ver o vídeo** (só thumb + legenda + duração + metadados).

**Input:**
```json
{
  "platform": "instagram | tiktok | youtube",
  "username": "...", "postid": "...",
  "alttext": "legenda/título",
  "mediaurl": "thumb",
  "duration_seconds": 47,
  "music_info": { "musicOriginal": true, "musicName": "..." },
  "organizador_output": { }
}
```

**Output (universais + 6 específicos):**
```json
{
  "gancho_principal_texto": "≤80c", "tipo_gancho": "...",
  "promessa_central": "...", "prova_mostrada": "...",
  "estrutura": "talking_head | cenas_misturadas | tela_dividida | tutorial | bastidor",
  "cta": "...",
  "gancho_3s": "descrição do que abre o vídeo (≤200c)",
  "ritmo": "lento | medio | rapido",
  "densidade_corte": "baixa | media | alta",
  "densidade_jargao": "leigo | misto | tecnico",
  "som_origem": "original | trending | remix | silent",
  "loop_potencial": "alto | medio | baixo"
}
```
> `som_origem` é **TT-only** → `null` nas outras redes.

**System Prompt:**
> Você é o Especialista Vídeo Curto — agente 4. Infere ritmo/dinâmica SEM ver o vídeo (só thumb + legenda + duração + metadados).
>
> **REGRAS:** Nunca em `duration>90` (erro `too_long`). Nunca preenche `som_origem` fora de TT (use `null`). Nunca `loop_potencial:alto` sem evidência.
>
> **FAILURE MODES:** Talking-head-default (olhe enquadramento). Ritmo-default-medio (avalie de fato). Hook-de-legenda (`gancho_3s` é o que ABRE o vídeo, não a legenda).

---

### Agente 5 · ESPECIALISTA VÍDEO LONGO (Camada 2)
- **Modelo:** GPT-4.1 mini · **Plataforma:** YouTube longo (>90s) · **Custo (est.):** ≈ R$ 0,013/vídeo.

**Input:**
```json
{
  "platform": "youtube",
  "username": "...", "postid": "...",
  "alttext": "TÍTULO",
  "description": "descrição",
  "mediaurl": "thumb",
  "duration_seconds": 1245,
  "organizador_output": { }
}
```

**Output (universais + 6 específicos):**
```json
{
  "gancho_principal_texto": "primeiros 80c do título",
  "tipo_gancho": "...", "promessa_central": "...",
  "prova_mostrada": "...",
  "estrutura": "talking_head | entrevista | tutorial | mesa_redonda | bastidor",
  "cta": "...",
  "titulo_seo_score": "alto | medio | baixo",
  "titulo_padrao": "pergunta | listagem | claim | tutorial | entrevista",
  "thumb_clickability": "alta | media | baixa",
  "evergreen_vs_hype": "evergreen | hype | misto",
  "densidade_jargao": "leigo | misto | tecnico",
  "gancho_3s": "descrição inferida"
}
```

**System Prompt:**
> Você é o Especialista Vídeo Longo — agente 5.
>
> **REGRAS:** Nunca em `duration<=90` ou platform≠youtube. Nunca `titulo_seo_score:alto` sem 4 critérios: CAPS + número + promessa específica + ≤70c.
>
> **FAILURE MODES:** Evergreen-default (tema datado = hype). Thumb-default-media (sem rosto = baixa). Titulo-com-CAPS-é-alto (só CAPS sem promessa = medio).

---

### Agente 6 · SINTETIZADOR POR PLATAFORMA (Camada 3)
- **Modelo:** GPT-4.1 mini · **Roda:** 1× por (perfil, rede) · **Custo (est.):** ≈ R$ 0,03/síntese.
- **Função:** agrega 30–50 análises de **uma** plataforma e produz a **identidade do criador nessa rede**.
- **Tabela:** `profile_synthesis` (`platform`, `username`) + **INSERTs** em `profile_narrative_shifts`.

**Input:**
```json
{
  "platform": "instagram | tiktok | youtube",
  "username": "...",
  "posts_analisados": [
    { "postid": "...", "posted_at": "...", "likes_count": 0, "views_count": 0,
      "shares_count": 0, "saves_count": 0, "analysis": { } }
  ],
  "bio_metrics": { "followers_count": 0, "posts_count": 0, "is_verified": true }
}
```

**Output:**
```json
{
  "posicionamento": "1 frase",
  "promessa_principal": "1 frase",
  "voz_tom": "≤2 frases",
  "publico_alvo": "...",
  "diferencial": "1-2 frases",
  "padroes_fortes": {
    "formato_que_printa": "tipo + descrição + evidência",
    "tema_que_printa": "tema + evidência",
    "gancho_que_printa": "tipo + exemplo"
  },
  "padroes_fracos": {
    "formato_que_morre": "...",
    "tema_que_morre": "..."
  },
  "evolucao_narrativa": [
    { "quando": "2024-Q3 → 2025-Q1", "de": "...", "para": "...", "evidencia": "..." }
  ],
  "assuntos_novos": [
    { "tema": "...", "apareceu_em": "2025-08", "peso_atual_pct": 12 }
  ],
  "resumo_executivo": "5-10 linhas"
}
```

**Rubrica de agregação (determinística):**
- `formato_que_printa` = `tipo` com engagement_rate médio no **top 25%**.
- `tema_que_printa` = idem por `tema_principal`.
- `gancho_que_printa` = idem por `tipo_gancho`.
- `formato/tema_que_morre` = **bottom 25%**.
- `evolucao_narrativa` = mudança de tema dominante entre trimestres.
- `assuntos_novos` = primeira ocorrência nos últimos 6 meses.

**System Prompt:**
> Você é o Sintetizador — agente 6. Agrega 30-50 análises de UMA plataforma e produz a identidade do criador NESSA rede.
>
> **REGRAS:** Nunca mistura sinais cross-plat. Nunca inventa padrão sem evidência (top 25% percentil). Nunca resumo sem números.
>
> **FAILURE MODES:** Generic-resume (proibidas frases vagas). Padrão-fraco-vazio (sempre preencha). Evolução-inventada (mín 6m de janela).
>
> **BENCHMARKS:** IG eng 3-5% bom, >7% alto. TT views >100k em <500k fans = viral. YT views/subs <5% fraco, 10-30% saudável.

---

### Agente 7 · CONSOLIDADOR CROSS-PLATFORM (Camada 4)
- **Modelo:** GPT-4.1 mini · **Roda:** 1× por perfil (quando as **3 sínteses** estão prontas) · **Custo (est.):** ≈ R$ 0,015/perfil.
- **Função:** recebe as 3 sínteses + métricas agregadas e emite o **veredicto único**.
- **Tabela:** `profile_cross_brief` (`username` PRIMARY KEY) — ver §11.

**Input:**
```json
{
  "username": "...",
  "sinteses": {
    "instagram": { },
    "tiktok": { },
    "youtube": { }
  },
  "metricas_agregadas": {
    "followers_total": 1500000,
    "instagram": { "followers": 0, "eng_rate_medio": 0.04, "posts_30d": 0 },
    "tiktok":    { "followers": 0, "views_medio": 0, "posts_30d": 0 },
    "youtube":   { "subs": 0, "views_medio": 0, "posts_30d": 0 }
  }
}
```

**Output:**
```json
{
  "rede_mais_escalavel": "instagram | tiktok | youtube",
  "rede_dominante_hoje": "...",
  "coerencia_cross_plat": "alta | media | baixa",
  "ajuste_auton": "2-3 frases sobre fit com avatar Camila",
  "recomendacao_aborda": "sim | esperar | nao",
  "veredicto_letra": "S | A | B | C | D",
  "score_embaixador": 84,
  "justificativa": "3-5 frases com números",
  "gaps_oportunidade": [
    { "rede": "tiktok", "lacuna": "ausente", "acao": "convidar p/ começar com Auton" }
  ]
}
```

**Rubrica de score (DETERMINÍSTICA) — total 100 pts:**

| Critério | Peso | Cálculo |
|---|---|---|
| Autoridade técnica | 25 | freq média `nivel_tecnico=tecnico` × `tem_prova=true` |
| Alcance | 20 | log10(followers_total): 100k=10, 1M=15, 10M=20 |
| Engajamento | 20 | eng_rate vs benchmark: 3%=10, 7%=15, >10%=20 |
| Coerência cross-plat | 15 | similaridade entre 3 `posicionamento`: alta=15 · media=8 · baixa=3 |
| Fit Auton | 10 | tema dominante alinha funcional/integrativo: sim=10 · parcial=5 · não=0 |
| Recorrência | 10 | posts_30d consistentes: constante=10 · esporádico=5 · dormente=0 |

**Faixas de letra:** **S = 90+** · **A = 75–89** · **B = 60–74** · **C = 45–59** · **D < 45**.

**System Prompt:**
> Você é o Consolidador — agente 7 (final). Recebe 3 sínteses + métricas e emite veredicto único.
>
> **REGRAS:** Score 0-100 com letra batendo a faixa. Justificativa mín 3 frases COM números. Sempre preencher `gaps_oportunidade`.
>
> **FAILURE MODES:** Score-redondo (calcule, não chute). Letra-default-B (calcule). Recomendação-sim-default (só `sim` se score≥70 E coerencia≥media E fit≥parcial).
>
> **CONTEXTO AUTON:** Plataforma de IA p/ profissionais integrativos BR. Avatar ideal: médica integrativa/funcional R$ 12-25k+/mês. Embaixador S = autoridade + alcance + tema funcional + recorrência alta + escalável em 1+ rede com Auton co-branding.

---

## 7. Mapeamento agente → tabela

| Camada | Agente | Escreve em |
|---|---|---|
| 1 | ORGANIZADOR | `post_analysis` (upsert por `platform`,`postid`) |
| 2 | Imagem / Carrossel / Vídeo curto / Vídeo longo | `post_analysis` (merge dos campos específicos) |
| 3 | Sintetizador por plataforma | `profile_synthesis` (upsert por `platform`,`username`) + `profile_narrative_shifts` (insert) |
| 4 | Consolidador cross-platform | `profile_cross_brief` (upsert por `username`) |

---

## 8. Arquitetura de dados

| Tabela | Papel | Escrita por | Chave de conflito |
|---|---|---|---|
| `scrappers_contents` | posts crus coletados (fonte) | scraping (externo) | — (somente leitura aqui) |
| `reference_profiles` | perfis ativos + `pipeline_status` | orquestração | `username` |
| `post_analysis` | 1 linha por post (Camada 1 + 2 mescladas) | Agentes 1–5 | (`platform`, `postid`) |
| `profile_synthesis` | identidade do perfil por rede | Agente 6 | (`platform`, `username`) |
| `profile_narrative_shifts` | mudanças narrativas (histórico) | Agente 6 | insert (append) |
| `profile_cross_brief` *(novo)* | veredicto final por perfil | Agente 7 | `username` |

> `post_analysis` é o ponto de junção: o Organizador grava os 9 campos universais e o especialista de formato faz **merge** dos campos específicos na mesma linha.

---

## 9. Orquestração & idempotência

**Pseudocódigo (fiel ao board):**
```
PARA CADA (username, platform) ATIVO:
  posts = top_N(scrappers_contents WHERE platform AND username, N=50)
  PARA CADA post:
    org_out  = Agente_1(post)
    spec_out = match(org_out.tipo) → Agente_2|3|4|5(post, org_out)
    upsert post_analysis ← merge(org_out, spec_out)
  synth = Agente_6(username, platform, posts+analyses)
  upsert profile_synthesis ← synth
  insert profile_narrative_shifts ← synth.evolucao_narrativa

QUANDO username tem 3 sínteses:
  brief = Agente_7(username, 3_synth, metricas_agg)
  upsert profile_cross_brief ← brief
  update reference_profiles SET pipeline_status='completo'
```

- **Idempotência:** todos os `upsert` usam `onConflict` composto (`platform`+`postid`, `platform`+`username`, `username`). Reprocessar não duplica.
- **Retry:** **1 retry** com `temperature=0` quando o JSON volta inválido. Com **Structured Outputs** o schema já é garantido pela API; o retry cobre erros de rede/refusal.
- **Volume:** 50 posts por (perfil, rede); 3 redes ⇒ até 150 posts/perfil + 3 sínteses + 1 consolidação.

---

## 10. Custos (GPT-4.1 mini)

> ⚠️ **Estimativas.** O board orçou em Claude (Haiku/Sonnet). Como este projeto usa **GPT-4.1 mini**, os valores abaixo foram **reestimados por price-ratio** sobre os números do board — **não** são medições reais. Validar com tokens reais antes de fechar orçamento (ver §10.3).

### 10.1 Preço de tabela — GPT-4.1 mini (OpenAI)

| Token | Preço |
|---|---|
| Input | **$0,40** / 1M |
| Input em cache | $0,10 / 1M |
| Output | **$1,60** / 1M |

> Tabela OpenAI (abr/2025) — confirmar versão vigente. Câmbio usado nas conversões: **≈ R$ 6,00 / US$**.

### 10.2 Estimativa por perfil (3 redes × 50 posts)

| Etapa | Calls | Orçado no board (Claude) | Fator¹ | **Est. GPT-4.1 mini** |
|---|---|---|---|---|
| Agente 1 · Organizador | 150 | $0,075 (Haiku) | ~0,35× | **~$0,026** |
| Agentes 2–5 · Especialistas | 150 | $2,55 (Sonnet) | ~0,12× | **~$0,29** |
| Agente 6 · Sintetizador | 3 | $0,12 (Sonnet) | ~0,12× | **~$0,014** |
| Agente 7 · Consolidador | 1 | $0,022 (Sonnet) | ~0,12× | **~$0,003** |
| **TOTAL por perfil** | **304** | **$2,77 ≈ R$ 16,60** | | **~$0,33 ≈ R$ 2,00** |
| **32 perfis ativos** | | **≈ R$ 530** | | **~$10,7 ≈ R$ 64** |

¹ Fator = preço *blended* do GPT-4.1 mini ÷ preço *blended* do modelo Claude original (mix assumido ~70% input / 30% output). **Não inclui** tokens de imagem (visão) dos agentes 2/3 e dos thumbnails de 4/5 — ver §10.3.

### 10.3 Decisão de modelo & ressalvas
- **Decisão:** o board especifica Claude; por decisão deste projeto **todos os 7 agentes usam GPT-4.1 mini**. Schema garantido via **Structured Outputs** (`response_format` json_schema).
- **Custo de visão não modelado:** os agentes 2 (imagem) e 3 (carrossel, várias imagens) e os thumbnails de 4/5 enviam imagens; os tokens de visão do 4.1 mini **não** entram no fator de texto — o custo real desses agentes tende a ser maior. **Medir com payloads reais.**
- **Otimização opcional:** a triagem (Agente 1) roda 150×/perfil; trocá-la por **GPT-4.1 nano** ($0,10/$0,40 por 1M) reduz ainda mais o custo — espelha o uso de Haiku no board.
- **Trade-off de qualidade:** o 4.1 mini é mais barato, porém menos capaz que o Sonnet em raciocínio visual fino (composição/design/SEO) — ver risco em §15.

---

## 11. Migrations necessárias (Supabase)

```sql
-- Colunas novas em post_analysis (campos específicos dos especialistas)
ALTER TABLE post_analysis
  ADD COLUMN IF NOT EXISTS gancho_principal_texto text,
  ADD COLUMN IF NOT EXISTS composicao text,
  ADD COLUMN IF NOT EXISTS texto_sobreposto_ratio numeric,
  ADD COLUMN IF NOT EXISTS loop_potencial text,
  ADD COLUMN IF NOT EXISTS titulo_seo_score text,
  ADD COLUMN IF NOT EXISTS titulo_padrao text,
  ADD COLUMN IF NOT EXISTS thumb_clickability text,
  ADD COLUMN IF NOT EXISTS evergreen_vs_hype text;

-- Tabela nova: veredicto final por perfil
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
CREATE INDEX idx_pcb_score ON profile_cross_brief(score_embaixador DESC);
```

---

## 12. Princípios de engenharia

1. **No Invention** — JSON estrito, sempre dentro dos `enum`; categoria desconhecida → `outros`; nunca prosa fora do bloco; nunca qualificadores subjetivos. Implementado com **Structured Outputs (json_schema)** do GPT-4.1 mini.
2. **Hierarquia estrita** — cada camada só consome o output da anterior; especialista só roda no `tipo`/plataforma que lhe cabe (caso contrário retorna `{"error": ...}`).
3. **Determinismo onde possível** — rubrica de agregação (top/bottom 25%) e rubrica de score (6 critérios ponderados) são calculadas, não "chutadas"; a letra **sempre** bate a faixa do score.
4. **Idempotência & resiliência** — `upsert` com `onConflict` composto em toda escrita; 1 retry `temperature=0` para JSON inválido.
5. **Evidência obrigatória** — sínteses e veredictos exigem números/citações literais; proibido `default` preguiçoso (tom-educativo, design-media, talking-head, letra-B, recomendação-sim).

---

## 13. Critérios de aceite & testes

- **Triagem:** Organizador classifica os 9 campos só com `enum` válidos; tema fora da lista → `outros`; saída é JSON puro.
- **Roteamento:** cada `tipo` cai no especialista certo; especialista fora da sua plataforma/formato retorna o `error` previsto (`platform_not_supported` / `wrong_format` / `too_long`).
- **Campos exclusivos:** `som_origem` só preenchido em TikTok (`null` nas demais).
- **Merge em `post_analysis`:** universais (Camada 1) + específicos (Camada 2) na mesma linha por (`platform`,`postid`).
- **Síntese:** percentis top/bottom 25% respeitados; `evolucao_narrativa` só com janela ≥ 6 meses; nenhum `padroes_fracos` vazio; resumo com números.
- **Veredicto:** `score_embaixador` calculado pela rubrica; `veredicto_letra` consistente com a faixa; `recomendacao_aborda='sim'` apenas se score≥70 **E** coerência≥media **E** fit≥parcial; `gaps_oportunidade` sempre presente.
- **Idempotência:** reprocessar o mesmo perfil não cria linhas duplicadas (upserts compostos).
- **Pipeline completo:** ao consolidar, `reference_profiles.pipeline_status='completo'`.
- **Custo:** custo por perfil ≈ R$ 16,60 registrado em `profile_cross_brief.custo_total`.

---

## 14. Roadmap / próximos passos

**Fase 0 — Migrations**
1. Rodar as migrations do §11 (colunas em `post_analysis` + `profile_cross_brief` + índice).

**Fase 1 — Camada 1 (triagem)**
2. Implementar o Organizador (GPT-4.1 mini) + upsert em `post_analysis`; validar os 9 campos.

**Fase 2 — Camada 2 (especialistas)**
3. Implementar os 4 especialistas (GPT-4.1 mini, com visão) + roteamento por `tipo` + merge em `post_analysis`; cobrir os `error` de plataforma/formato.

**Fase 3 — Camada 3 (síntese)**
4. Implementar o Sintetizador + rubrica determinística de agregação + INSERT em `profile_narrative_shifts`.

**Fase 4 — Camada 4 (consolidação)**
5. Implementar o Consolidador + rubrica de score + faixas de letra; upsert em `profile_cross_brief`.

**Fase 5 — Orquestração & qualidade**
6. Loop por (perfil, rede) com idempotência e retry `temperature=0`; atualizar `pipeline_status`.
7. Backfill dos **32 perfis ativos** (custo ≈ R$ 530); validar veredictos contra revisão manual de uma amostra.

---

## 15. Riscos & decisões em aberto

| Risco / decisão | Nota |
|---|---|
| **Inferência de vídeo sem assistir** | Agentes 4 e 5 inferem ritmo/dinâmica de thumb+legenda+duração — risco de imprecisão; mitigar com `gancho_3s` descritivo e `loop_potencial` só com evidência. |
| **JSON inválido do LLM** | 1 retry `temperature=0`; se persistir, registrar falha e seguir (não travar o perfil). |
| **Disponibilidade de mídia** | `mediaurl`/`carouselimages` podem expirar — capturar antes da análise. |
| **Volume vs custo** | N=50 posts é o teto por rede; aumentar N eleva linearmente o custo (os 4 especialistas, 150 calls/perfil, dominam). |
| **Percentis com poucos posts** | Rubrica top/bottom 25% precisa de massa mínima; perfis com <~12 posts/rede podem gerar padrões frágeis. |
| **Qualidade GPT-4.1 mini vs Sonnet** | Especialistas (composição visual, design de carrossel, SEO de título) exigem raciocínio fino; o 4.1 mini é mais barato porém menos capaz que o Sonnet do board — validar acurácia numa amostra antes do backfill dos 32 perfis. |
| **Custo de visão não modelado** | O fator de price-ratio do §10 é só de texto; os agentes 2/3 (e thumbnails de 4/5) enviam imagens — tokens de visão do 4.1 mini elevam o custo real desses agentes. Medir. |
| **Preço/câmbio** | Estimativas usam preços OpenAI GPT-4.1 mini ($0,40/$1,60 por 1M, tabela abr/2025) e câmbio ~R$ 6,00/US$; revalidar periodicamente. |
| **Coerência da letra com o score** | Garantir no código que a letra é derivada do score (não pedida ao LLM livremente). |

---

### Apêndice — fonte
Conteúdo derivado do board Miro `uXjVGif6fQ8=`: diagrama *Pipeline IA — Análise de Embaixadores (Auton)* (widget `3458764673178114806`) e documento *PRD — 7 Agentes do Pipeline IA · Auton Embaixadores* v1.0 de 15/mai/2026 (widget `3458764673178682456`) — schemas de input/output, system prompts, rubricas, migrations e orquestração reproduzidos fielmente. Este é um produto **distinto** do *Backend AIOX · Painel de Concorrentes* coberto por [PRD.md](PRD.md).

**Decisão de modelo (2026-05-26):** o board especifica Claude (Sonnet 4.6 / Haiku 4.5); por decisão deste projeto, todos os agentes usam **GPT-4.1 mini (OpenAI)** com **Structured Outputs**. Os custos foram reestimados por price-ratio (§10) e devem ser validados com tokens reais.
