/**
 * Netlify stored-zip writer + digest-deploy helpers for the edge relay.
 *
 * Netlify digest-deploy flow (per
 * https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api):
 *   1. POST {NETLIFY_API}/sites                                   → { id, ssl_url }
 *   2. POST {NETLIFY_API}/sites/{site_id}/deploys { files, functions }
 *      → { id, required[], required_functions[] }
 *      (SHA1 digests for files, SHA256 digests for functions)
 *   3. PUT  {NETLIFY_API}/deploys/{id}/files/{path}               — only the SHAs
 *      PUT  {NETLIFY_API}/deploys/{id}/functions/{name}?runtime=js
 *      listed in `required` / `required_functions`
 *   4. GET  {NETLIFY_API}/deploys/{id} — poll until state === "ready" (pollDeployReady).
 *
 * Manual digest deploys run no build step, so the function is served from its
 * default endpoint: <site>/.netlify/functions/relay (NETLIFY_FUNCTION_PATH).
 * The Lambda-compatible runtime requires the CommonJS single-file bundle
 * (`exports.handler(event)` with a string response body) — see the inline
 * comment on the `NETLIFY_RELAY_FUNCTION` constant in worker-sources.ts for
 * the live-verified failure modes of the alternatives.
 *
 * The function upload expects a stored (uncompressed) ZIP of that bundle; the
 * relay is ~1.5 KB so buildStoredZip writes CRC32 + headers by hand instead of
 * pulling in a compression dependency.
 */

import { createHash } from 'node:crypto';
import { NETLIFY_INDEX_HTML, NETLIFY_RELAY_FUNCTION } from './worker-sources';

export const NETLIFY_API = 'https://api.netlify.com/api/v1';
export const NETLIFY_FUNCTION_NAME = 'relay';
export const NETLIFY_FUNCTION_PATH = '/.netlify/functions/relay';

export function sha1Hex(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex');
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// ─── Minimal stored (uncompressed) ZIP writer ──────────────────────────
// No compression dependency needed: the relay bundle is ~1.5 KB. Stored
// entries are plain CRC32 + headers, verifiable with any unzip tool.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildStoredZip(files: Array<{ name: string; data: Uint8Array | string }>): Buffer {
  const encoder = new TextEncoder();
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBytes = encoder.encode(name);
    const content = data instanceof Uint8Array ? data : encoder.encode(String(data ?? ''));
    const crc = crc32(content);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header signature
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 filename flag
    local.setUint16(8, 0, true); // method: stored
    local.setUint32(14, crc, true);
    local.setUint32(18, content.length, true);
    local.setUint32(22, content.length, true);
    local.setUint16(26, nameBytes.length, true);
    chunks.push(Buffer.from(local.buffer), Buffer.from(nameBytes), Buffer.from(content));

    const centralHeader = new DataView(new ArrayBuffer(46));
    centralHeader.setUint32(0, 0x02014b50, true); // central directory signature
    centralHeader.setUint16(8, 0x0800, true); // UTF-8 flag
    centralHeader.setUint16(10, 0, true); // method: stored
    centralHeader.setUint32(16, crc, true);
    centralHeader.setUint32(20, content.length, true);
    centralHeader.setUint32(24, content.length, true);
    centralHeader.setUint16(28, nameBytes.length, true);
    centralHeader.setUint32(42, offset, true); // local header offset
    central.push(Buffer.from(centralHeader.buffer), Buffer.from(nameBytes));

    offset += 30 + nameBytes.length + content.length;
  }

  const centralStart = offset;
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory signature
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, centralStart, true);

  return Buffer.concat([...chunks, ...central, Buffer.from(end.buffer)]);
}

/** Zipped single-file bundle Netlify expects for `runtime=js` function uploads. */
export function buildRelayFunctionZip(): { zip: Buffer; sha256: string } {
  const content = new TextEncoder().encode(NETLIFY_RELAY_FUNCTION);
  const zip = buildStoredZip([{ name: `${NETLIFY_FUNCTION_NAME}.js`, data: content }]);
  return { zip, sha256: sha256Hex(zip) };
}

export function buildIndexFile(): { content: Buffer; sha1: string } {
  const content = Buffer.from(new TextEncoder().encode(NETLIFY_INDEX_HTML));
  return { content, sha1: sha1Hex(content) };
}

export function buildRelayUrl(siteUrl: string): string {
  return `${String(siteUrl || '').replace(/\/$/, '')}${NETLIFY_FUNCTION_PATH}`;
}

export function netlifyHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'CCS',
  };
}

interface NetlifyDeployState {
  state?: string;
  error_message?: string;
}

/** Injectable fetch signature for pollDeployReady (testability). */
type FetchLike = typeof fetch;

export async function pollDeployReady(
  deployId: string,
  token: string,
  fetchImpl: FetchLike = fetch,
  maxMs = 120000,
  intervalMs = 3000,
): Promise<NetlifyDeployState> {
  const start = Date.now();
  for (;;) {
    const res = await fetchImpl(`${NETLIFY_API}/deploys/${deployId}`, {
      headers: netlifyHeaders(token),
    });
    const data = (await res.json().catch(() => ({}))) as NetlifyDeployState;
    if (data.state === 'ready') return data;
    if (data.state === 'error') {
      throw new Error(data.error_message || 'Netlify deploy failed');
    }
    if (Date.now() - start > maxMs) throw new Error('Netlify deploy timed out');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
