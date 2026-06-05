# Pipeline de IA — Análise de Embaixadores (Auton Health)

Implementação em **TypeScript (Node)** do pipeline de 7 agentes / 4 camadas descrito em [PRD_Embaixadores.md](PRD_Embaixadores.md). Avalia perfis de Instagram, TikTok e YouTube e emite um **veredicto S/A/B/C/D + score 0–100** por perfil.

- **LLM:** OpenAI **GPT-4.1 mini** com **Structured Outputs** (json_schema via Zod).
- **Persistência:** Supabase (service role, server-side).

## Arquitetura (resumo)

| Camada | Agente(s) | Saída |
|---|---|---|
| 1 · Triagem | ORGANIZADOR | `post_analysis` (9 campos) |
| 2 · Especialistas | Imagem · Carrossel/Slideshow · Vídeo curto · Vídeo longo | `post_analysis` (merge) |
| 3 · Síntese | Sintetizador por plataforma | `profile_synthesis` + `profile_narrative_shifts` |
| 4 · Consolidação | Consolidador cross-platform | `profile_cross_brief` |

```
src/
├── config.ts            # env + plataformas
├── prompts.ts           # system prompts (verbatim do PRD §6)
├── domain.ts            # tipos de dominio
├── lib/                 # openai (Structured Outputs), supabase, cost, retry, logger
├── schemas/             # Zod por agente (No Invention) — compativel com Structured Outputs
├── agents/              # runners: organizador, especialistas (+router/guards), sintetizador, consolidador
├── rubrics/             # DETERMINISTICO: aggregation (top/bottom) + score (6 criterios + letra)
├── db/                  # leitura de scrappers_contents + upserts
├── pipeline/            # orchestrator.ts (o loop do PRD §9)
└── cli.ts               # entrypoint
supabase/migrations/     # 0001 post_analysis · 0002 profile_cross_brief · 0003 tabelas de apoio
tests/                   # vitest (rubricas, router/guards, schemas, custo)
```

## Determinismo (PRD §13)

O LLM **não** decide as notas. As partes calculáveis são feitas em código:

- **Sintetizador:** `src/rubrics/aggregation.ts` calcula formato/tema/gancho "que printa/morre" (engajamento médio por categoria) e os passa ao LLM como `SINAIS_CALCULADOS`. O LLM só redige.
- **Consolidador:** `src/rubrics/score.ts` calcula os 6 critérios (25/20/20/15/10/10), o **score**, a **letra** (S/A/B/C/D) e a **recomendação**. Esses 3 campos **sobrescrevem** o que o LLM devolver — garantindo que "a letra sempre bate a faixa". As fórmulas intermediárias são interpretações documentadas (ajustáveis no topo de `score.ts`).
- **Guardas dos especialistas** (`platform_not_supported` / `wrong_format` / `too_long`) são checadas em código (`src/agents/especialistas.ts`), não dependem do LLM.

## Setup

```bash
npm install
cp .env.example .env   # preencha o LLM (Azure OU OpenAI) + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
```

### 1. Migrations
A camada de dados (`src/db/*.ts`) **já está alinhada ao schema real** deste projeto Supabase (introspectado em 2026-05). A única tabela que falta é a do veredicto:
- ✅ **`0002_profile_cross_brief.sql`** — **rode esta** (cria a tabela nova `profile_cross_brief`).
- ⏭️ `0001_post_analysis_columns.sql` — **opcional**: `post_analysis` já existe; os campos sem coluna dedicada (composicao, texto_sobreposto_ratio, loop_potencial, titulo_*, thumb_clickability, evergreen_vs_hype, densidade_corte textual) são gravados em `raw_outputs` (jsonb). Só rode se preferir colunas dedicadas.
- ⏭️ `0003_support_tables.sql` — **não rode**: `reference_profiles`, `profile_synthesis`, `profile_narrative_shifts` já existem.

### 2. Alinhamento ao schema real (já feito)
- **`scrappers_contents`**: `mapRawRow` usa as colunas reais (postid, mediaurl=jpg em storage, carouselimages, duration_seconds, *_count, posted_at…).
- **`reference_profiles`** é por **(username, platform)**; `pipeline_status` é atualizado por rede.
- **Seguidores** vêm de **`profile_bio`** (`followers_count` / `subscribers_count`), não de `reference_profiles`.
- **`profile_synthesis`** é **flat**: gravamos `formato/tema/gancho_que_printa`, `*_que_morre` etc.; o resto (evolução narrativa, assuntos novos) vai em `raw_synthesis`.
- **`profile_narrative_shifts`** usa `de_discurso`/`para_discurso`.
- Escrita idempotente via `upsertByKeys` (SELECT→UPDATE/INSERT), sem depender de constraint UNIQUE.

Valide a leitura (read-only, não chama OpenAI):
```bash
npx tsx src/scripts/check-db.ts            # 1º perfil ativo
npx tsx src/scripts/check-db.ts <username> # perfil especifico
```

## Uso

```bash
# 1 perfil (processa as 3 redes e consolida o veredicto)
npm run pipeline -- --username nome_do_perfil

# todos os perfis ativos de reference_profiles
npm run pipeline -- --all

# preview sem gravar no banco (ainda chama o LLM)
npm run pipeline -- --username nome_do_perfil --dry-run

# flags: --limit <n> (posts/rede, default 50) · --min-syntheses <n> (default 3)
```

> **Criadores de uma rede só:** o default `--min-syntheses 3` (fiel ao PRD) só consolida quem tem IG+TT+YT. Como a maioria dos perfis aqui é só Instagram, use `--min-syntheses 1` para gerar o veredicto a partir das redes disponíveis:
> ```bash
> npm run pipeline -- --username michelevalentinutri --min-syntheses 1
> ```

> ⚠️ Rodar os agentes exige `OPENAI_API_KEY` no `.env` (ainda não preenchida) e **grava no Supabase real**. Use `--dry-run` para testar sem gravar.

Ao final, o resumo imprime custo em **USD e BRL** (taxa de `USD_BRL_RATE`, só exibição; o custo gravado em `profile_cross_brief.custo_total` fica em USD).

## Provedor LLM (Azure OpenAI ou OpenAI direta)

O código suporta os dois e escolhe automaticamente: **se `AZURE_OPENAI_ENDPOINT` estiver preenchido, usa Azure**; senão, OpenAI direta. A troca fica isolada em [src/lib/openai.ts](src/lib/openai.ts) (classe `AzureOpenAI` do próprio SDK). Structured Outputs funcionam igual nos dois.

Valide o provedor ativo com uma chamada real:
```bash
npx tsx src/scripts/check-llm.ts
```

## Transcrição de vídeo (áudio → texto)

Vídeos são transcritos e o texto **falado** alimenta os especialistas de vídeo (gancho real, prova, jargão, tema). Cadeia: baixa o vídeo p/ **temp local** → `ffmpeg` extrai áudio (mono 16kHz) → Azure **`gpt-4o-transcribe-diarize`** → apaga o temp. **Nenhum vídeo é salvo no storage** (só o texto, em `raw_outputs.transcricao`).

Fonte do vídeo por rede:
- **Instagram:** `videourl` (MP4 já no storage) → download direto.
- **TikTok / YouTube:** `videourl` é null → baixa o áudio com **yt-dlp** a partir da `posturl`.

Dependências de sistema (locais): **ffmpeg** e **yt-dlp** (`pip install yt-dlp`, invocado via `python -m yt_dlp`). Liga/desliga com `TRANSCRIBE_VIDEOS`. Vídeos acima de 30 min são pulados (custo). Custo ≈ US$0,006/min.

Valide a transcrição isolada:
```bash
npx tsx src/scripts/check-transcribe.ts "<url .mp4 do storage | página do tiktok/youtube>" <duracao_s>
```

## Modelo & custo

- Default `gpt-4.1-mini` (deployment no Azure ou `OPENAI_MODEL` na OpenAI direta) + `gpt-4o-transcribe-diarize` para áudio.
- No Azure usa-se **1 deployment para todos os agentes**; o override `OPENAI_MODEL_ORGANIZADOR` (gpt-4.1-nano) só vale na OpenAI direta.
- Preços e custos estimados: ver PRD §10. As estimativas em BRL **não** modelam tokens de visão dos agentes 2/3 e thumbnails de 4/5 — meça com payloads reais.

## Testes

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest (30 testes: rubricas, router/guards, schemas, custo)
```

Os testes cobrem o **núcleo determinístico** (sem rede). A execução ponta-a-ponta exige `OPENAI_API_KEY`, acesso ao Supabase e o mapeamento de `scrappers_contents` alinhado ao seu schema.
