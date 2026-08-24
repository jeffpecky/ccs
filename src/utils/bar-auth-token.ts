import crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getCcsDir } from '../config/config-loader-facade';

export const BAR_AUTH_TOKEN_HEADER = 'x-ccs-bar-token';
export const BAR_AUTH_NONCE_HEADER = 'x-ccs-bar-nonce';
const TOKEN_BYTE_LENGTH = 32;
const NONCE_MIN_LENGTH = 16;
const BAR_AUTH_DOMAIN = 'ccs-bar-auth-v2';
export type BarAuthDirection = 'request' | 'response';

export function createBarAuthNonce(): string {
  return crypto.randomBytes(TOKEN_BYTE_LENGTH).toString('hex');
}

export function isValidBarAuthNonce(nonce: string): boolean {
  return /^[a-f0-9]+$/i.test(nonce) && nonce.length >= NONCE_MIN_LENGTH && nonce.length <= 128;
}

export function normalizeBarAuthPath(value: string): string {
  const url = new URL(value.startsWith('/') ? value : `/${value}`, 'http://localhost');
  url.searchParams.sort();
  return `${url.pathname}${url.search}`;
}

export function createBarAuthProof(token: string, direction: BarAuthDirection, method: string, requestPath: string, nonce: string): string {
  const message = [BAR_AUTH_DOMAIN, direction, method.toUpperCase(), normalizeBarAuthPath(requestPath), nonce].join('\n');
  return crypto.createHmac('sha256', token).update(message).digest('hex');
}

export function isMatchingBarAuthProof(token: string, direction: BarAuthDirection, method: string, requestPath: string, nonce: string, proof: string): boolean {
  if (!isValidBarAuthNonce(nonce) || !/^[a-f0-9]{64}$/i.test(proof)) {
    return false;
  }
  const expected = createBarAuthProof(token, direction, method, requestPath, nonce);
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(proof, 'hex'));
}

export class BarAuthNonceCache {
  private readonly nonces = new Map<string, number>();
  constructor(private readonly maxSize = 2048, private readonly ttlMs = 5 * 60_000, private readonly now = Date.now) {}
  get size(): number { return this.nonces.size; }
  consume(nonce: string): boolean {
    const now = this.now();
    for (const [key, expires] of this.nonces) if (expires <= now) this.nonces.delete(key);
    if (this.nonces.has(nonce)) return false;
    this.nonces.set(nonce, now + this.ttlMs);
    while (this.nonces.size > this.maxSize) this.nonces.delete(this.nonces.keys().next().value!);
    return true;
  }
}

export function getBarAuthTokenPath(ccsDir = getCcsDir()): string {
  return path.join(ccsDir, 'bar', '.auth-token');
}

function isValidToken(token: string): boolean {
  return /^[a-f0-9]{64}$/i.test(token);
}

export function getOrCreateBarAuthToken(ccsDir = getCcsDir()): string {
  const tokenPath = getBarAuthTokenPath(ccsDir);

  try {
    const token = fs.readFileSync(tokenPath, 'utf8').trim();
    if (isValidToken(token)) {
      return token;
    }
  } catch {
    // Missing or unreadable tokens are regenerated below.
  }

  const token = crypto.randomBytes(TOKEN_BYTE_LENGTH).toString('hex');
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  return token;
}
