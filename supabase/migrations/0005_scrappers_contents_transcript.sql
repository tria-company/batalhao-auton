-- Adiciona transcript pre-extraido em scrappers_contents para evitar
-- transcricao via Whisper quando ja temos a legenda automatica do YouTube.
--
-- Quando preenchida, o analisador (orchestrator.ts) usa esse texto direto
-- e pula a chamada ao gpt-4o-transcribe — economia significativa em canais
-- de YT (Whisper custa ~US$ 0,006/min de audio).

ALTER TABLE public.scrappers_contents
  ADD COLUMN IF NOT EXISTS transcript text NULL,
  ADD COLUMN IF NOT EXISTS transcript_source text NULL;

COMMENT ON COLUMN public.scrappers_contents.transcript IS
  'Texto transcrito do video (ex: legenda automatica do YouTube via yt-dlp). Quando NOT NULL, o analisador pula o Whisper.';

COMMENT ON COLUMN public.scrappers_contents.transcript_source IS
  'Origem da transcricao: youtube_auto_subs:<lang> | whisper | manual.';
