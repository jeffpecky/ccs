// tests/unit/relay/netlify-zip.test.ts
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  NETLIFY_API, NETLIFY_FUNCTION_NAME, NETLIFY_FUNCTION_PATH,
  buildIndexFile, buildRelayFunctionZip, buildRelayUrl, buildStoredZip,
  crc32, netlifyHeaders, pollDeployReady, sha1Hex, sha256Hex,
} from '../../../src/relay/netlify-zip';
import { NETLIFY_INDEX_HTML, NETLIFY_RELAY_FUNCTION } from '../../../src/relay/worker-sources';

describe('netlify constants', () => {
  it('exposes the API base and function endpoint', () => {
    expect(NETLIFY_API).toBe('https://api.netlify.com/api/v1');
    expect(NETLIFY_FUNCTION_NAME).toBe('relay');
    expect(NETLIFY_FUNCTION_PATH).toBe('/.netlify/functions/relay');
  });
});

describe('crc32 / hashes', () => {
  it('crc32 matches the standard check vector', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });
  it('sha helpers match node:crypto', () => {
    expect(sha1Hex(Buffer.from('abc'))).toBe(createHash('sha1').update('abc').digest('hex'));
    expect(sha256Hex(Buffer.from('abc'))).toBe(createHash('sha256').update('abc').digest('hex'));
  });
});

describe('buildStoredZip', () => {
  it('emits local headers, stored method, and an end-of-central-directory record', () => {
    const zip = buildStoredZip([{ name: 'relay.js', data: 'exports.handler = 1;' }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);   // local file header signature
    expect(zip.readUInt16LE(8)).toBe(0);            // compression method: stored
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50); // EOCD (single entry)
    expect(zip.includes(Buffer.from('relay.js'))).toBe(true);
  });

  it('writes entry count, CRCs, and second-entry offset for multiple entries', () => {
    const a = Buffer.from('hello');
    const zip = buildStoredZip([
      { name: 'a.js', data: a },
      { name: 'dir/b.js', data: 'text' },
    ]);
    // Entry count in EOCD:
    expect(zip.readUInt16LE(zip.length - 22 + 10)).toBe(2);
    // First entry's CRC32 sits at local-header offset 14:
    expect(zip.readUInt32LE(14)).toBe(crc32(a));
    // Central directory offset lives in the EOCD at +16; first record there:
    const cd = zip.readUInt32LE(zip.length - 22 + 16);
    expect(zip.readUInt32LE(cd)).toBe(0x02014b50); // central dir signature
    // Walk past the first central record (46-byte header + name + extra + comment)
    // to reach the second entry's central header:
    const cd2 = cd + 46 + zip.readUInt16LE(cd + 28) + zip.readUInt16LE(cd + 30) + zip.readUInt16LE(cd + 32);
    expect(zip.readUInt32LE(cd2)).toBe(0x02014b50);
    // Second entry's local-header offset = first local record (30 + name + content):
    expect(zip.readUInt32LE(cd2 + 42)).toBe(30 + 'a.js'.length + a.length);
  });
});

describe('buildRelayFunctionZip / buildIndexFile', () => {
  it('relay function zip hashes to its sha256 and round-trips the function source', () => {
    const { zip, sha256 } = buildRelayFunctionZip();
    expect(sha256).toBe(createHash('sha256').update(zip).digest('hex'));
    expect(zip.includes(Buffer.from(`${NETLIFY_FUNCTION_NAME}.js`))).toBe(true);
    // Full-content round-trip: stored payload equals the deployed source byte-for-byte.
    const nameLen = zip.readUInt16LE(26);
    const extraLen = zip.readUInt16LE(28);
    const size = zip.readUInt32LE(18);
    const content = zip.subarray(30 + nameLen + extraLen, 30 + nameLen + extraLen + size);
    expect(content.equals(Buffer.from(NETLIFY_RELAY_FUNCTION))).toBe(true); // full-content match
    expect(zip.readUInt32LE(14)).toBe(crc32(content));   // local CRC vs actual content
    expect(zip.readUInt16LE(6)).toBe(0x0800);            // local UTF-8 filename flag
    const cd = zip.readUInt32LE(zip.length - 22 + 16);   // central dir offset from EOCD
    expect(zip.readUInt32LE(cd)).toBe(0x02014b50);       // central dir signature
    expect(zip.readUInt16LE(cd + 8)).toBe(0x0800);       // central UTF-8 flag
    expect(zip.readUInt32LE(cd + 42)).toBe(0);           // local header offset (single entry)
  });

  it('index file hashes to its sha1 and carries the CCS branding', () => {
    const { content, sha1 } = buildIndexFile();
    expect(sha1).toBe(createHash('sha1').update(content).digest('hex'));
    // Full-content match against the imported source constant:
    expect(content.equals(Buffer.from(NETLIFY_INDEX_HTML))).toBe(true);
    const text = content.toString('utf8');
    expect(text).toContain('CCS Relay');
    expect(text).toContain(NETLIFY_FUNCTION_PATH);
  });
});

describe('buildRelayUrl', () => {
  it('appends the function path, trimming a trailing slash from the site URL', () => {
    expect(buildRelayUrl('https://my.netlify.app')).toBe('https://my.netlify.app/.netlify/functions/relay');
    expect(buildRelayUrl('https://my.netlify.app/')).toBe('https://my.netlify.app/.netlify/functions/relay');
  });
});

describe('netlifyHeaders', () => {
  it('sets bearer auth and the CCS user agent', () => {
    expect(netlifyHeaders('tok')).toEqual({ Authorization: 'Bearer tok', 'User-Agent': 'CCS' });
  });
});

describe('pollDeployReady', () => {
  it('resolves when the deploy reaches ready', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ state: 'ready' }));
    };
    const data = await pollDeployReady('dp1', 't', fetchImpl as unknown as typeof fetch, 5000, 10);
    expect(data.state).toBe('ready');
    expect(calls).toEqual([`${NETLIFY_API}/deploys/dp1`]);
  });

  it('polls through in-progress states, then throws on error state', async () => {
    const states = ['building', 'uploading', 'error'];
    let i = 0;
    const fetchImpl = async () => new Response(JSON.stringify({
      state: states[Math.min(i++, states.length - 1)],
      error_message: 'function build failed',
    }));
    await expect(pollDeployReady('dp1', 't', fetchImpl as unknown as typeof fetch, 5000, 1))
      .rejects.toThrow('function build failed');
  });

  it('times out when the deploy never settles', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ state: 'building' }));
    await expect(pollDeployReady('dp1', 't', fetchImpl as unknown as typeof fetch, 50, 10))
      .rejects.toThrow(/timed out/i);
  });
});
