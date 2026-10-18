import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';

import {
    ApiError,
    AuthenticationError,
    InvalidRequestError,
    NotFinishedError,
    PlanLimitError,
    QuotaExceededError,
    RateLimitedError,
    ServerError,
    TransportError,
    Validation,
    ValidationTimeoutError,
    Xmlvalid,
} from '../src/index.ts';
import { FakeFetch, fixture, validation } from './helpers.ts';

let api: FakeFetch;
let sleeps: number[];
let client: Xmlvalid;

beforeEach(() => {
    api = new FakeFetch();
    sleeps = [];
    client = new Xmlvalid({ apiKey: 'xv_test', fetch: api.fetch, sleep: async (seconds) => void sleeps.push(seconds) });
});

describe('sending documents', () => {
    it('sends a file as the body', async () => {
        api.json(200, validation('done', false, [{ line: 139, level: 'error', type: 'schematron', rule: 'BR-CO-16', message: 'Amount due' }]));

        const result = await client.validate(fixture('invoice.xml'), { schema: 'peppol-bis-3-invoice' });

        const sent = api.sent[0]!;
        assert.equal(sent.method, 'POST');
        assert.equal(sent.url.href, 'https://xmlvalid.com/api/v1/validations?wait=10&schema=peppol-bis-3-invoice&name=invoice.xml');
        assert.equal(sent.headers.get('Authorization'), 'Bearer xv_test');
        assert.equal(sent.headers.get('Content-Type'), 'application/xml');
        assert.equal(sent.headers.get('User-Agent'), 'xmlvalid-js/1.0.0');
        assert.equal(sent.body, readFileSync(fixture('invoice.xml'), 'utf8'));
        assert.equal(result.reportUrl, 'https://xmlvalid.com/api/v1/validations/val_1/report');
        assert.deepEqual(result.errors.map(String), ['Line 139: [BR-CO-16] Amount due']);
        assert.equal(result.isValid, false);
    });

    it('sends text, bytes, Files and streams', async () => {
        api.json(200, validation()).json(200, validation()).json(200, validation()).json(200, validation());

        await client.validate({ text: '<a/>' }, { doctype: true });
        await client.validate(new TextEncoder().encode('PK'), { name: 'batch.zip' });
        await client.validate(new File(['<b/>'], 'upload.xml'));
        await client.validate(new Blob(['<c/>']).stream(), { name: 'piped.xml' });

        assert.equal(api.sent[0]!.body, '<a/>');
        assert.equal(api.sent[0]!.url.searchParams.get('doctype'), '1');
        assert.equal(api.sent[0]!.url.searchParams.get('name'), 'document.xml');
        assert.equal(api.sent[1]!.url.searchParams.get('name'), 'batch.zip');
        assert.equal(api.sent[1]!.headers.get('Content-Type'), 'application/octet-stream');
        assert.equal(api.sent[2]!.url.searchParams.get('name'), 'upload.xml');
        assert.equal(api.sent[3]!.body, '<c/>');
        assert.equal(api.sent[3]!.streamed, true);
    });

    it('sends a URL as JSON', async () => {
        api.json(200, validation());

        await client.validate({ url: 'https://example.com/feed.xml' }, { schema: 'auto' });

        assert.equal(api.sent[0]!.headers.get('Content-Type'), 'application/json');
        assert.equal(api.sent[0]!.body, '{"url":"https://example.com/feed.xml","wait":10,"schema":"auto"}');
    });

    it('sends its own schema and rules as multipart', async () => {
        api.json(200, validation());

        await client.validate(
            { text: '<a/>' },
            { schemaFile: fixture('invoice.xsd'), rules: { 'main.sch': fixture('main.sch'), 'parts/totals.sch': fixture('totals.sch') }, doctype: true },
        );

        const { body, headers } = api.sent[0]!;
        assert.match(headers.get('Content-Type') ?? '', /^multipart\/form-data; boundary=/);
        assert.match(body, /name="document"; filename="document.xml"\r\nContent-Type: application\/xml\r\n\r\n<a\/>/);
        assert.match(body, /name="schema_file"; filename="invoice.xsd"/);
        assert.equal(body.match(/name="rules_file\[\]"/g)?.length, 2);
        assert.match(body, /name="rules_file\[\]"; filename="totals.sch"/);
        assert.match(body, /name="rules_path\[\]"\r\n\r\nmain.sch\r\n/);
        assert.match(body, /name="rules_path\[\]"\r\n\r\nparts\/totals.sch\r\n/);
        assert.match(body, /name="doctype"\r\n\r\n1\r\n/);
        assert.match(body, /name="wait"\r\n\r\n10\r\n/);
    });

    it('sends one rules file next to a URL', async () => {
        api.json(200, validation());

        await client.validate({ url: 'https://example.com/a.xml' }, { rules: new File(['<schema/>'], 'mine.sch') });

        assert.match(api.sent[0]!.body, /name="url"\r\n\r\nhttps:\/\/example.com\/a.xml\r\n/);
        assert.match(api.sent[0]!.body, /name="rules_file"; filename="mine.sch"/);
    });
});

describe('waiting', () => {
    it('polls until finished', async () => {
        api.json(202, validation('queued')).json(200, validation('running')).json(200, validation());

        const result = await client.validate({ text: '<a/>' });

        assert.ok(result.isFinished && result.isValid);
        assert.deepEqual(sleeps, [1, 1.5]);
        assert.equal(api.sent[2]!.url.pathname, '/api/v1/validations/val_1');
    });

    it('gives up after the timeout with the validation', async () => {
        api.json(202, validation('queued'));

        await assert.rejects(client.validate({ text: '<a/>' }, { timeout: 0 }), (error: unknown) => {
            assert.ok(error instanceof ValidationTimeoutError);
            assert.equal(error.validation.status, 'queued');
            assert.match(error.message, /val_1 was still queued after 0 seconds/);
            return true;
        });
    });

    it('submits without waiting', async () => {
        api.json(202, validation('queued'));

        const result = await client.submit({ text: '<a/>' }, { schema: 'ubl-2.1-invoice' });

        assert.equal(result.isFinished, false);
        assert.equal(api.sent[0]!.url.searchParams.get('wait'), '0');
    });
});

describe('errors and retries', () => {
    const limited = { error: { code: 'rate_limited', message: 'Too many requests.' } };

    it('retries a rate limited request after Retry-After', async () => {
        api.json(429, limited, { 'Retry-After': '7' }).json(200, validation());

        assert.ok((await client.validate(fixture('invoice.xml'))).isValid);

        assert.deepEqual(sleeps, [7]);
        assert.equal(api.sent[1]!.body, readFileSync(fixture('invoice.xml'), 'utf8'));
    });

    it('stops retrying, and never retries a stream', async () => {
        client = new Xmlvalid({ apiKey: 'xv_test', maxRetries: 1, fetch: api.fetch, sleep: async (seconds) => void sleeps.push(seconds) });
        api.json(429, limited, { 'Retry-After': '3' }).json(429, limited, { 'Retry-After': '3' }).json(429, limited);

        await assert.rejects(client.usage(), (error: unknown) => error instanceof RateLimitedError && error.retryAfter === 3);
        assert.deepEqual(sleeps, [3]);

        await assert.rejects(client.validate(new Blob(['<a/>']).stream()), RateLimitedError);
        assert.deepEqual(sleeps, [3]);
    });

    it('does not retry a used up quota', async () => {
        api.json(429, { error: { code: 'quota_exceeded', message: "This month's validations are used up." } });

        await assert.rejects(client.usage(), QuotaExceededError);
        assert.deepEqual(sleeps, []);
    });

    for (const [status, Kind] of [[401, AuthenticationError], [403, PlanLimitError], [409, NotFinishedError], [418, ApiError]] as const) {
        it(`maps ${status} to ${Kind.name}`, async () => {
            api.json(status, { error: { code: 'some_code', message: 'No.' } });

            await assert.rejects(client.usage(), (error: unknown) => {
                assert.ok(error instanceof Kind);
                assert.equal(error.statusCode, status);
                assert.equal(error.errorCode, 'some_code');
                assert.equal(error.message, 'No.');
                return true;
            });
        });
    }

    it('lists the fields of an invalid request and names a server error', async () => {
        api.json(422, { error: { code: 'invalid_request', message: 'Check the fields.', fields: { schema: ['Unknown.'] } } });
        api.raw(502, '<html>Bad gateway</html>');

        await assert.rejects(client.validate({ text: '<a/>' }, { schema: 'nope' }), (error: unknown) => error instanceof InvalidRequestError && error.fields['schema']?.[0] === 'Unknown.');
        await assert.rejects(client.usage(), (error: unknown) => error instanceof ServerError && error.message === 'xmlvalid answered HTTP 502.' && error.errorCode === 'server_error');
    });

    it('wraps network failures and answers that are not JSON', async () => {
        api.fail(new TypeError('fetch failed')).raw(200, 'not json');

        await assert.rejects(client.usage(), (error: unknown) => error instanceof TransportError && /fetch failed/.test(error.message));
        await assert.rejects(client.usage(), (error: unknown) => error instanceof TransportError && /other than JSON/.test(error.message));
    });

    it('passes an abort through as it is', async () => {
        const controller = new AbortController();
        controller.abort();

        await assert.rejects(client.validation('val_1', { signal: controller.signal }), { name: 'AbortError' });
    });
});

describe('the rest of the API', () => {
    it('fetches, cancels, reports and shares', async () => {
        api.json(200, validation()).json(200, validation('cancelled')).raw(200, '<html>Report</html>');
        api.json(201, { url: 'https://xmlvalid.com/reports/01abc', expires_at: '2026-11-17T10:00:00+00:00' });

        assert.ok((await client.validation('val_1')).isValid);
        assert.equal((await client.cancel('val_1')).status, 'cancelled');
        assert.equal(await client.report('val_1'), '<html>Report</html>');
        const link = await client.share(['val_1', new Validation({ ...validation(), id: 'val_2' })]);

        assert.deepEqual(api.sent.map((sent) => [sent.method, sent.url.pathname]), [
            ['GET', '/api/v1/validations/val_1'],
            ['DELETE', '/api/v1/validations/val_1'],
            ['GET', '/api/v1/validations/val_1/report'],
            ['POST', '/api/v1/reports'],
        ]);
        assert.equal(api.sent[2]!.headers.get('Accept'), 'text/html');
        assert.equal(api.sent[3]!.body, '{"validations":["val_1","val_2"]}');
        assert.equal(link.url, 'https://xmlvalid.com/reports/01abc');
        assert.equal(link.expiresAt?.getUTCFullYear(), 2026);
    });

    it('reads usage and schemas', async () => {
        api.json(200, { plan: 'pro', period: { start: '2026-10-01T00:00:00+00:00' }, validations: { used: 3, limit: 10000 }, limits: { requests_per_minute: 120 } });
        api.json(200, {
            saved: [{ schema: 'my-12', name: 'order.xsd', kind: 'xsd', namespace: 'urn:example:order' }],
            catalog: [{ schema: 'peppol-bis-3-invoice', name: 'Peppol BIS Billing 3.0 Invoice', kind: 'xsd', namespace: null, version: '3.0.20', rules: ['EN 16931'] }],
        });

        const usage = await client.usage();
        const schemas = await client.schemas();

        assert.deepEqual([usage.plan, usage.remaining, usage.requestsPerMinute], ['pro', 9997, 120]);
        assert.deepEqual(schemas.map((schema) => [schema.schema, schema.saved, schema.rules]), [
            ['my-12', true, []],
            ['peppol-bis-3-invoice', false, ['EN 16931']],
        ]);
    });

    it('needs a key and a readable file', async () => {
        const saved = process.env['XMLVALID_API_KEY'];
        delete process.env['XMLVALID_API_KEY'];
        assert.throws(() => new Xmlvalid(), /API key/);
        process.env['XMLVALID_API_KEY'] = 'xv_env';
        await assert.rejects(new Xmlvalid({ fetch: api.fetch }).validate('missing.xml'), /Cannot read the file missing.xml/);
        if (saved === undefined) delete process.env['XMLVALID_API_KEY'];
        else process.env['XMLVALID_API_KEY'] = saved;
    });
});
