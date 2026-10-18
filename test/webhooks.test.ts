import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';

import { SignatureVerificationError, WebhookEvent, verifyWebhook } from '../src/index.ts';
import { validation } from './helpers.ts';

const SECRET = 'whsec_test';
const NOW = 1_800_000_000;

const sign = (body: string, timestamp = NOW, secret = SECRET): string =>
    `t=${timestamp},v1=` + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

const body = (type = 'validation.completed'): string =>
    JSON.stringify({ id: 'evt_1', type, created_at: '2026-10-18T10:00:00+00:00', data: type === 'validation.completed' ? validation() : { message: 'A test event from xmlvalid.com.' } });

describe('webhooks', () => {
    it('reads a signed event', async () => {
        const event = await verifyWebhook(body(), sign(body()), SECRET, { now: NOW });

        assert.equal(event.id, 'evt_1');
        assert.equal(event.type, WebhookEvent.VALIDATION_COMPLETED);
        assert.equal(event.validation?.isValid, true);
        assert.equal(event.createdAt?.getUTCFullYear(), 2026);
    });

    it('takes bytes, and a ping has no validation', async () => {
        const raw = body('ping');

        const event = await verifyWebhook(new TextEncoder().encode(raw), sign(raw), SECRET, { now: NOW });

        assert.equal(event.type, WebhookEvent.PING);
        assert.equal(event.validation, null);
    });

    it('accepts any matching v1 signature', async () => {
        const raw = body();
        const signature = `t=${NOW},v1=${'0'.repeat(64)},${sign(raw).split(',')[1]}`;

        assert.equal((await verifyWebhook(raw, signature, SECRET, { now: NOW })).id, 'evt_1');
    });

    const refused: Array<[string, string, string | null, RegExp]> = [
        ['no header', body(), null, /missing or malformed/],
        ['no time', body(), 'v1=abc', /missing or malformed/],
        ['an old signature', body(), sign(body(), NOW - 301), /too old/],
        ['another secret', body(), sign(body(), NOW, 'whsec_other'), /does not match/],
        ['a body that is not JSON', 'not json', sign('not json'), /not JSON/],
        ['a body that is not an object', '[1]', sign('[1]'), /not a JSON object/],
    ];
    for (const [what, raw, signature, message] of refused) {
        it(`refuses ${what}`, async () => {
            await assert.rejects(verifyWebhook(raw, signature, SECRET, { now: NOW }), (error: unknown) => error instanceof SignatureVerificationError && message.test(error.message));
        });
    }

    it('can skip the age check', async () => {
        const raw = body();

        assert.equal((await verifyWebhook(raw, sign(raw, 1), SECRET, { tolerance: 0 })).id, 'evt_1');
    });
});
