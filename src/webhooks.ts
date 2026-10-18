import { SignatureVerificationError } from './errors.ts';
import { WebhookEvent } from './models.ts';

export interface VerifyOptions {
    /** Seconds a signature stays valid, against replays (0 to skip the check). Default 300. */
    tolerance?: number | undefined;
    /** The current Unix time, for tests. */
    now?: number | undefined;
}

/**
 * Checks a webhook's `Xmlvalid-Signature` header and returns its event.
 *
 * The header is `t=<unix time>,v1=<HMAC-SHA256 of "t.body" keyed with the endpoint's secret>`.
 * Pass the raw body as received. Works wherever Web Crypto does (Node 20+, Deno, Bun, Workers).
 *
 * @throws {SignatureVerificationError}
 */
export async function verifyWebhook(
    payload: string | Uint8Array,
    signature: string | null | undefined,
    secret: string,
    options: VerifyOptions = {},
): Promise<WebhookEvent> {
    const body = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
    const timestamp = /(?:^|,)\s*t=(\d+)/.exec(signature ?? '');
    const hashes = [...(signature ?? '').matchAll(/(?:^|,)\s*v1=([0-9a-f]+)/g)].map((match) => match[1] ?? '');
    if (timestamp === null || hashes.length === 0) {
        throw new SignatureVerificationError('The Xmlvalid-Signature header is missing or malformed.');
    }

    const sent = Number(timestamp[1]);
    const tolerance = options.tolerance ?? 300;
    const now = options.now ?? Math.floor(Date.now() / 1000);
    if (tolerance > 0 && Math.abs(now - sent) > tolerance) {
        throw new SignatureVerificationError('The webhook signature is too old.');
    }

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const prefix = encoder.encode(`${sent}.`);
    const signed = new Uint8Array(prefix.length + body.length);
    signed.set(prefix);
    signed.set(body, prefix.length);
    const expected = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, signed))]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    if (!hashes.some((hash) => equal(expected, hash))) {
        throw new SignatureVerificationError("The webhook signature does not match: check the endpoint's secret and pass the raw body.");
    }

    let data: unknown;
    try {
        data = JSON.parse(new TextDecoder().decode(body));
    } catch {
        throw new SignatureVerificationError('The webhook body is not JSON.');
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        throw new SignatureVerificationError('The webhook body is not a JSON object.');
    }

    return new WebhookEvent(data as Record<string, unknown>);
}

/** Compares in constant time for strings of the same length. */
function equal(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let difference = 0;
    for (let i = 0; i < a.length; i++) {
        difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return difference === 0;
}
