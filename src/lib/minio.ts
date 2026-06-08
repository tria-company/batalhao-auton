import crypto from 'node:crypto';
import { config } from '../config';

/**
 * Cliente S3 minimo pro MinIO (apenas PUT/HEAD de objeto), com assinatura
 * AWS SigV4 feita na mao via `node:crypto` — assim NAO adicionamos um SDK de
 * storage so pra subir arquivo. Usado pelo espelhamento de midia (mediaMirror).
 */

type Body = Uint8Array;

const sha256hex = (b: Body | string): string => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (key: Buffer | string, s: string): Buffer => crypto.createHmac('sha256', key).update(s).digest();

/** Encoda 1 segmento de path conforme RFC3986 (unreserved: A-Za-z0-9-_.~). */
function encSeg(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/** `<username>/<arquivo>` -> path encodado `/bucket/username/arquivo`. */
function objectPath(key: string): string {
  const encoded = key.split('/').map(encSeg).join('/');
  return `/${config.minioBucket}/${encoded}`;
}

/** True quando o espelhamento esta ligado E ha credenciais. */
export function minioEnabled(): boolean {
  return config.mirrorMedia && !!config.minioAccessKey && !!config.minioSecretKey;
}

/** URL publica (leitura anonima) de um objeto no MinIO. */
export function publicUrl(key: string): string {
  return `${config.minioEndpoint}${objectPath(key)}`;
}

function stamp(): { date: string; amz: string } {
  const d = new Date();
  const z = (n: number): string => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}${z(d.getUTCMonth() + 1)}${z(d.getUTCDate())}`;
  const amz = `${date}T${z(d.getUTCHours())}${z(d.getUTCMinutes())}${z(d.getUTCSeconds())}Z`;
  return { date, amz };
}

async function s3Request(
  method: 'PUT' | 'HEAD',
  encodedPath: string,
  body?: Body,
  contentType?: string,
): Promise<Response> {
  const endpoint = config.minioEndpoint;
  const host = new URL(endpoint).host;
  const payload: Body = body ?? new Uint8Array(0);
  const payloadHash = sha256hex(payload);
  const { date, amz } = stamp();

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amz,
  };
  if (contentType) headers['content-type'] = contentType;

  const sortedKeys = Object.keys(headers).sort();
  const signedHeaders = sortedKeys.join(';');
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${headers[k]}`).join('\n') + '\n';
  const canonicalRequest = [method, encodedPath, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${date}/${config.minioRegion}/s3/aws4_request`;
  const sts = ['AWS4-HMAC-SHA256', amz, scope, sha256hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac('AWS4' + config.minioSecretKey, date), config.minioRegion), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(sts).digest('hex');
  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${config.minioAccessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  // Opcoes via `any`: o tipo BodyInit (lib DOM) nao esta no tsconfig deste repo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const init: any = { method, headers };
  if (method === 'PUT') init.body = payload;
  return fetch(endpoint + encodedPath, init);
}

/** True se o objeto ja existe no bucket (HEAD 200). */
export async function objectExists(key: string): Promise<boolean> {
  const res = await s3Request('HEAD', objectPath(key));
  return res.status === 200;
}

/** Sobe um objeto no bucket. Lanca se o MinIO recusar. */
export async function putObject(key: string, body: Body, contentType: string): Promise<void> {
  const res = await s3Request('PUT', objectPath(key), body, contentType);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`MinIO PUT ${key} -> HTTP ${res.status} ${txt.slice(0, 200)}`);
  }
}
