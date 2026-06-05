import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config';
import { logger } from './logger';

const execFileAsync = promisify(execFile);

/**
 * Transcricao de audio de videos via Azure (gpt-4o-transcribe-diarize).
 * Origem do video:
 *  - Instagram: `videourl` (MP4 ja no storage) -> download direto.
 *  - TikTok/YouTube: `videourl` e null -> baixa o audio com yt-dlp a partir da
 *    `posturl` (pagina do post).
 * Fluxo: baixa para TEMP local -> ffmpeg extrai audio (mono 16kHz) -> envia ao
 * endpoint -> apaga os temporarios. NENHUM video e salvo no storage.
 */

/** Estimativa de custo (USD) por minuto de audio transcrito (aprox.). */
const TRANSCRIBE_USD_PER_MIN = 0.006;
/** Acima disto, pula a transcricao para nao estourar custo/tempo (segundos). */
const MAX_TRANSCRIBE_SECONDS = 1800;

export interface TranscriptResult {
  text: string;
  costUsd: number;
  durationSeconds: number;
}

export interface TranscribeInput {
  videourl: string | null;
  pageurl: string | null;
  durationSeconds: number | null;
}

function transcribeUrl(): string {
  const ep = config.azureEndpoint!.replace(/\/$/, '');
  return `${ep}/openai/deployments/${config.azureTranscribeDeployment}/audio/transcriptions?api-version=${config.azureTranscribeApiVersion}`;
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${res.statusText}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

/** Baixa o audio (mp3) de uma pagina (TikTok/YouTube/etc.) via yt-dlp.
 * Usa o BINARIO yt-dlp (`config.ytDlpBin`) em vez de `python -m yt_dlp` — o
 * binario standalone esta no VPS, evita dep Python e fica consistente com o
 * adapter `src/scrapers/youtube.ts`. */
async function ytdlpAudio(pageurl: string, dir: string): Promise<string> {
  const out = join(dir, 'src.%(ext)s');
  await execFileAsync(
    config.ytDlpBin,
    ['-x', '--audio-format', 'mp3', '--no-playlist', '--quiet', '--no-warnings', '-o', out, pageurl],
    { timeout: 180_000, maxBuffer: 1024 * 1024 * 16 },
  );
  return join(dir, 'src.mp3');
}

/** Extrai/normaliza o audio com ffmpeg: mono, 16kHz, mp3 32kbps. */
async function extractAudio(inputPath: string, audioPath: string): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', '-f', 'mp3', audioPath, '-y',
  ]);
}

/** Erro que significa apenas "o video nao tem faixa de audio" (nao e falha real). */
function isNoAudio(msg: string): boolean {
  return /does not contain any stream|Output file does not contain|no audio|unable to obtain.*audio codec/i.test(
    msg,
  );
}

/** Envia o arquivo de audio ao Azure e retorna o texto transcrito. */
async function transcribeAudioFile(audioPath: string): Promise<string> {
  const bytes = await readFile(audioPath);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'audio/mpeg' }), 'audio.mp3');
  // Modelos de diarizacao (gpt-4o-transcribe-diarize) exigem chunking_strategy.
  form.append('chunking_strategy', 'auto');

  const res = await fetch(transcribeUrl(), {
    method: 'POST',
    headers: { 'api-key': config.azureApiKey },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`transcribe ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }

  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const j = (await res.json()) as {
      text?: string;
      segments?: { text?: string; speaker?: string }[];
    };
    if (typeof j.text === 'string') return j.text;
    if (Array.isArray(j.segments)) {
      return j.segments
        .map((s) => (s.speaker ? `${s.speaker}: ${s.text ?? ''}` : (s.text ?? '')))
        .join('\n')
        .trim();
    }
    return JSON.stringify(j);
  }
  return (await res.text()).trim();
}

/**
 * Transcreve o video de um post. Retorna null (sem lancar) se desligado, sem
 * fonte, longo demais, ou se algo falhar — para nao derrubar o pipeline.
 */
export async function transcribeVideo(input: TranscribeInput): Promise<TranscriptResult | null> {
  if (!config.transcribeVideos) return null;
  if (!input.videourl && !input.pageurl) return null;

  const dur = input.durationSeconds ?? 0;
  if (dur > MAX_TRANSCRIBE_SECONDS) {
    logger.warn(`transcricao pulada (video de ${Math.round(dur)}s > ${MAX_TRANSCRIBE_SECONDS}s)`, {});
    return null;
  }

  const dir = await mkdtemp(join(tmpdir(), 'auton-vid-'));
  const audioPath = join(dir, `${randomUUID()}.mp3`);
  try {
    let mediaPath: string;
    if (input.videourl) {
      mediaPath = join(dir, 'src.mp4');
      await download(input.videourl, mediaPath);
    } else {
      mediaPath = await ytdlpAudio(input.pageurl as string, dir);
    }
    await extractAudio(mediaPath, audioPath);
    const text = await transcribeAudioFile(audioPath);
    return { text, durationSeconds: dur, costUsd: (dur / 60) * TRANSCRIBE_USD_PER_MIN };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isNoAudio(msg)) {
      logger.info('video sem audio — analisando sem transcricao', {});
    } else {
      logger.warn('transcricao falhou (seguindo sem transcript)', { error: msg.slice(0, 200) });
    }
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
