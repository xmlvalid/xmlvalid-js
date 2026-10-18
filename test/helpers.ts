import { fileURLToPath } from 'node:url';

export const fixture = (name: string): string => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

export interface Sent {
    method: string;
    url: URL;
    headers: Headers;
    body: string;
    /** The body was a stream, not a Blob or a string. */
    streamed: boolean;
}

/** A fetch that answers from a queue and keeps the requests, bodies read. */
export class FakeFetch {
    readonly sent: Sent[] = [];
    readonly #queue: Array<Response | Error> = [];

    json(status: number, body: unknown, headers: Record<string, string> = {}): this {
        this.#queue.push(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } }));
        return this;
    }

    raw(status: number, body: string): this {
        this.#queue.push(new Response(body, { status }));
        return this;
    }

    fail(error: Error): this {
        this.#queue.push(error);
        return this;
    }

    readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        init?.signal?.throwIfAborted();
        const request = new Request(input, init);
        this.sent.push({
            method: request.method,
            url: new URL(request.url),
            headers: request.headers,
            body: await request.text(),
            streamed: init?.body instanceof ReadableStream,
        });
        const next = this.#queue.shift();
        if (next === undefined) throw new Error(`Unexpected request ${request.method} ${request.url}`);
        if (next instanceof Error) throw next;
        return next;
    };
}

/** A validation as the API returns it. */
export function validation(status = 'done', valid = true, errors: Array<Record<string, unknown>> = []): Record<string, unknown> {
    const finished = status !== 'queued' && status !== 'running';
    return {
        id: 'val_1',
        status,
        progress: finished ? 100 : 0,
        created_at: '2026-10-18T10:00:00+00:00',
        finished_at: finished ? '2026-10-18T10:00:01+00:00' : null,
        document: { source: 'upload', name: 'invoice.xml', size: 12 },
        schema: { kind: 'xsd', catalog: 'peppol-bis-3-invoice', name: 'Peppol BIS Billing 3.0 Invoice' },
        result: finished
            ? { valid, outcome: valid ? 'valid' : 'invalid', errors_total: errors.length, warnings_total: 0, errors_truncated: false, errors, warnings: [], bytes: 12, duration_ms: 5 }
            : null,
        error: null,
        links: { report: 'https://xmlvalid.com/api/v1/validations/val_1/report' },
    };
}
