/**
 * Cryptographic webhook signature verification.
 *
 * Expected signature format: sha256=HMAC(secret, timestamp + '.' + payload)
 * Uses timing-safe comparison to prevent timing attacks.
 */

import { createHmac, timingSafeEqual } from 'crypto';

export class WebhookVerificationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
    this.code = code;
  }
}

/**
 * Verify an HMAC-SHA256 webhook signature.
 *
 * @returns true when the signature is valid
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string,
  secret: string,
  timestamp: string
): boolean {
  const body = typeof payload === 'string' ? payload : payload.toString('utf8');
  const expected = 'sha256=' + createHmac('sha256', secret)
    .update(timestamp + '.' + body)
    .digest('hex');

  if (expected.length !== signature.length) return false;

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Returns true when the timestamp is older than the tolerance window.
 */
export function isTimestampStale(timestamp: string, toleranceSeconds: number): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return true;
  const age = Math.abs(Date.now() / 1000 - ts);
  return age > toleranceSeconds;
}
