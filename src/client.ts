import {
    ApiError,
    AuthenticationError,
    DocumentTooLargeError,
    InvalidRequestError,
    NotFinishedError,
    NotFoundError,
    PlanLimitError,
    QuotaExceededError,
    RateLimitedError,
    RulesVersionMismatchError,
    ServerError,
    TransportError,
    ValidationTimeoutError,
} from './errors.ts';
import { ReportLink, Schema, Usage, Validation } from './models.ts';

export const VERSION = '1.2.0';
export const DEFAULT_BASE_URL = 'https://xmlvalid.com/api/v1';

/**
 * The document to validate:
 * - a file path (Node, Bun, Deno), streamed from disk
 * - a `Blob` or `File` (browsers; a `File` keeps its name)
 * - its bytes (`Uint8Array`, `ArrayBuffer`)
 * - a `ReadableStream` (sent as it comes; not retried)
 * - `{ text }`: the XML as a string
 * - `{ url }`: a public http(s) address xmlvalid downloads itself
 */
export type DocumentInput =
    | string
    | Blob
    | Uint8Array
    | ArrayBuffer
    | ReadableStream<Uint8Array>
    | { text: string }
    | { url: string };

/** A file path or a Blob. */
export type FileInput = string | Blob;

export interface ValidateOptions {
    /** The document's name in results and reports (default: the file's, or document.xml). */
    name?: string | undefined;
    /**
     * A catalog slug (peppol-bis-3-invoice), a saved schema (my-12), "auto" for the profile an
     * e-invoice names, or nothing to check well-formedness only.
     */
    schema?: string | undefined;
    /** An XSD, DTD or RelaxNG file to validate against instead. */
    schemaFile?: FileInput | undefined;
    /** Your own Schematron, run after the schema check: a .sch file, or { relative path: file } with includes. */
    rules?: FileInput | Record<string, FileInput> | undefined;
    /** Validate against the DTD the DOCTYPE names. */
    doctype?: boolean | undefined;
    /**
     * Pins the schema's rule sets to releases, as rule-set@version (peppol-bis-3-ubl@3.0.21); when one
     * runs another release, the request fails with a RulesVersionMismatchError before anything runs.
     */
    rulesVersion?: string | string[] | undefined;
    /** Aborts the requests (and the waiting). */
    signal?: AbortSignal | undefined;
}

export interface WaitOptions {
    /** Seconds to wait in all (default: the client's `timeout`). */
    timeout?: number | undefined;
    signal?: AbortSignal | undefined;
}

export interface ClientOptions {
    /** An API key (xv_…) from https://xmlvalid.com/dashboard/api; default: XMLVALID_API_KEY. */
    apiKey?: string | undefined;
    baseUrl?: string | undefined;
    /** Seconds `validate()` waits for a result in all. Default 900. */
    timeout?: number | undefined;
    /** Seconds the API holds a new validation's request before answering with its status (0-60). Default 10. */
    wait?: number | undefined;
    /** Times a request refused with 429 rate_limited is retried, after Retry-After. Default 3. */
    maxRetries?: number | undefined;
    /** A fetch of your own (proxies, tests). */
    fetch?: typeof fetch | undefined;
    /** Replaces the waits between polls and retries (tests). */
    sleep?: ((seconds: number) => Promise<void>) | undefined;
}

interface Body {
    body: BodyInit | null;
    headers: Record<string, string>;
    /** It can be sent again for a retry. */
    reusable: boolean;
}

interface Call {
    method: string;
    path: string;
    query?: Record<string, string>;
    accept?: string;
    body?: () => Promise<Body>;
    signal?: AbortSignal | undefined;
}

const XML_EXTENSION = /\.(xml|xsd|sch|rng|xsl|xslt|svg|xhtml|gpx|kml)$/i;

/**
 * Client for the xmlvalid API (https://xmlvalid.com/docs/api).
 *
 * ```ts
 * const xmlvalid = new Xmlvalid({ apiKey: 'xv_…' });
 * const validation = await xmlvalid.validate('invoice.xml', { schema: 'peppol-bis-3-invoice' });
 * for (const error of validation.errors) console.log(String(error)); // Line 139: [BR-CO-16] …
 * ```
 */
export class Xmlvalid {
    readonly #apiKey: string;
    readonly #baseUrl: string;
    readonly #timeout: number;
    readonly #wait: number;
    readonly #maxRetries: number;
    readonly #fetch: typeof fetch;
    readonly #sleep: (seconds: number) => Promise<void>;

    constructor(options: ClientOptions = {}) {
        const apiKey = options.apiKey ?? globalThis.process?.env?.['XMLVALID_API_KEY'] ?? '';
        if (apiKey === '') {
            throw new TypeError('An API key (xv_…) from https://xmlvalid.com/dashboard/api is needed.');
        }
        this.#apiKey = apiKey;
        this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
        this.#timeout = options.timeout ?? 900;
        this.#wait = Math.max(0, Math.min(60, options.wait ?? 10));
        this.#maxRetries = options.maxRetries ?? 3;
        this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
        this.#sleep = options.sleep ?? ((seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000)));
    }

    /**
     * Validates a document and waits for the result.
     *
     * @throws {ValidationTimeoutError} when it is still running after `timeout` seconds
     */
    async validate(document: DocumentInput, options: ValidateOptions & { timeout?: number } = {}): Promise<Validation> {
        const timeout = options.timeout ?? this.#timeout;
        const deadline = Date.now() + timeout * 1000;
        const validation = await this.submit(document, { ...options, wait: Math.floor(Math.min(this.#wait, Math.max(0, timeout))) });
        return this.waitFor(validation, { timeout: Math.max(0, (deadline - Date.now()) / 1000), signal: options.signal });
    }

    /** Queues a validation and answers at once (or after `wait` seconds, if it is done by then). */
    async submit(document: DocumentInput, options: ValidateOptions & { wait?: number } = {}): Promise<Validation> {
        const wait = String(Math.max(0, Math.min(60, options.wait ?? 0)));
        const url = typeof document === 'object' && 'url' in document ? document.url : null;
        const pins = pinsOf(options.rulesVersion);

        if (options.schemaFile !== undefined || options.rules !== undefined) {
            return new Validation(await this.#json({ method: 'POST', path: '/validations', signal: options.signal, body: () => multipart(document, options, wait) }));
        }
        if (url !== null) {
            const body = {
                url,
                wait: Number(wait),
                ...(options.schema !== undefined && { schema: options.schema }),
                ...(options.doctype === true && { doctype: true }),
                ...(pins.length > 0 && { rules_version: pins }),
            };
            return new Validation(await this.#json({ method: 'POST', path: '/validations', signal: options.signal, body: json(body) }));
        }

        const query: Record<string, string> = { wait };
        if (options.schema !== undefined) query['schema'] = options.schema;
        if (options.doctype === true) query['doctype'] = '1';
        if (pins.length > 0) query['rules_version'] = pins.join(',');
        return new Validation(
            await this.#json({
                method: 'POST',
                path: '/validations',
                query,
                signal: options.signal,
                body: async () => {
                    const { data, name } = await documentData(document, options.name);
                    query['name'] = name;
                    return raw(data, name);
                },
            }),
        );
    }

    /**
     * Waits until a validation has finished, polling its status.
     *
     * @throws {ValidationTimeoutError} when it is still running after `timeout` seconds
     */
    async waitFor(validation: Validation | string, options: WaitOptions = {}): Promise<Validation> {
        const timeout = options.timeout ?? this.#timeout;
        const deadline = Date.now() + timeout * 1000;
        let current = typeof validation === 'string' ? await this.validation(validation, options) : validation;
        let interval = 1;
        while (!current.isFinished) {
            const left = (deadline - Date.now()) / 1000;
            if (left <= 0) throw new ValidationTimeoutError(current, timeout);
            options.signal?.throwIfAborted();
            await this.#sleep(Math.min(interval, left));
            interval = Math.min(5, interval * 1.5);
            current = await this.validation(current.id, options);
        }
        return current;
    }

    /** A validation by its id (val_…). */
    async validation(id: string, options: { signal?: AbortSignal | undefined } = {}): Promise<Validation> {
        return new Validation(await this.#json({ method: 'GET', path: path(id), signal: options.signal }));
    }

    /** Cancels a queued or running validation. */
    async cancel(validation: Validation | string): Promise<Validation> {
        return new Validation(await this.#json({ method: 'DELETE', path: path(idOf(validation)) }));
    }

    /** The result as an HTML page. */
    async report(validation: Validation | string): Promise<string> {
        return (await this.#send({ method: 'GET', path: path(idOf(validation), '/report'), accept: 'text/html' })).text();
    }

    /** A public link to the report of one or more validations, for 30 days (Pro). */
    async share(validations: Array<Validation | string>): Promise<ReportLink> {
        return new ReportLink(await this.#json({ method: 'POST', path: '/reports', body: json({ validations: validations.map(idOf) }) }));
    }

    /** This month's validations and the plan's limits. */
    async usage(): Promise<Usage> {
        return new Usage(await this.#json({ method: 'GET', path: '/usage' }));
    }

    /** The account's saved schemas, then the public catalog. */
    async schemas(): Promise<Schema[]> {
        const data = await this.#json({ method: 'GET', path: '/schemas' });
        const list = (key: string, saved: boolean): Schema[] => {
            const value = data[key];
            return Array.isArray(value)
                ? value.filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object').map((item) => new Schema(item, saved))
                : [];
        };
        return [...list('saved', true), ...list('catalog', false)];
    }

    async #json(call: Call): Promise<Record<string, unknown>> {
        const response = await this.#send(call);
        let data: unknown;
        try {
            data = await response.json();
        } catch (error) {
            throw new TransportError('xmlvalid answered with something other than JSON.', { cause: error });
        }
        if (data === null || typeof data !== 'object' || Array.isArray(data)) {
            throw new TransportError('xmlvalid answered with something other than a JSON object.');
        }
        return data as Record<string, unknown>;
    }

    /** Sends a request, retrying a 429 rate_limited after Retry-After, and turns an error answer into an error. */
    async #send(call: Call): Promise<Response> {
        for (let attempt = 0; ; attempt++) {
            const body = call.body ? await call.body() : { body: null, headers: {}, reusable: true };
            const query = call.query ? `?${new URLSearchParams(call.query)}` : '';
            let response: Response;
            try {
                response = await this.#fetch(`${this.#baseUrl}${call.path}${query}`, {
                    method: call.method,
                    headers: {
                        Authorization: `Bearer ${this.#apiKey}`,
                        Accept: call.accept ?? 'application/json',
                        'User-Agent': `xmlvalid-js/${VERSION}`,
                        ...body.headers,
                    },
                    body: body.body,
                    signal: call.signal ?? null,
                    ...(body.body instanceof ReadableStream && { duplex: 'half' }),
                } as RequestInit);
            } catch (error) {
                if (call.signal?.aborted) throw error;
                throw new TransportError(`Request to xmlvalid failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
            }

            if (response.status < 400) return response;
            const error = await apiError(response);
            if (error instanceof RateLimitedError && attempt < this.#maxRetries && body.reusable) {
                await this.#sleep(Math.max(1, Math.min(60, error.retryAfter)));
                continue;
            }
            throw error;
        }
    }
}

const path = (id: string, suffix = ''): string => `/validations/${encodeURIComponent(id)}${suffix}`;
const idOf = (validation: Validation | string): string => (typeof validation === 'string' ? validation : validation.id);
const basename = (file: string): string => file.split(/[\\/]/).pop() || file;
const contentType = (name: string): string => (XML_EXTENSION.test(name) ? 'application/xml' : 'application/octet-stream');
const pinsOf = (rulesVersion: string | string[] | undefined): string[] => (rulesVersion === undefined ? [] : typeof rulesVersion === 'string' ? [rulesVersion] : rulesVersion);

function json(value: unknown): () => Promise<Body> {
    return async () => ({ body: JSON.stringify(value), headers: { 'Content-Type': 'application/json' }, reusable: true });
}

function raw(data: Blob | ReadableStream<Uint8Array>, name: string): Body {
    return { body: data, headers: { 'Content-Type': contentType(name) }, reusable: !(data instanceof ReadableStream) };
}

/** A file path as a Blob read from disk as it is sent (Node 20+, Bun, Deno). */
async function fromPath(file: string): Promise<Blob> {
    const fs = await import('node:fs');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        throw new TypeError(`Cannot read the file ${file}.`);
    }
    return typeof fs.openAsBlob === 'function' ? fs.openAsBlob(file) : new Blob([fs.readFileSync(file)]);
}

async function fileBlob(file: FileInput): Promise<{ blob: Blob; name: string }> {
    if (typeof file === 'string') return { blob: await fromPath(file), name: basename(file) };
    return { blob: file, name: 'name' in file && typeof file.name === 'string' ? file.name : 'schema' };
}

async function documentData(document: DocumentInput, name: string | undefined): Promise<{ data: Blob | ReadableStream<Uint8Array>; name: string }> {
    if (typeof document === 'string') return { data: await fromPath(document), name: name ?? basename(document) };
    if (document instanceof ReadableStream) return { data: document, name: name ?? 'document.xml' };
    if (document instanceof Blob) {
        const own = 'name' in document && typeof document.name === 'string' && document.name !== '' ? document.name : undefined;
        return { data: document, name: name ?? own ?? 'document.xml' };
    }
    if (document instanceof Uint8Array || document instanceof ArrayBuffer) {
        return { data: new Blob([document as BlobPart]), name: name ?? 'document.xml' };
    }
    if ('text' in document) return { data: new Blob([document.text]), name: name ?? 'document.xml' };
    throw new TypeError('A URL is not sent as a body.');
}

async function multipart(document: DocumentInput, options: ValidateOptions, wait: string): Promise<Body> {
    const form = new FormData();
    if (typeof document === 'object' && 'url' in document) {
        form.append('url', document.url);
    } else {
        const { data, name } = await documentData(document, options.name);
        const blob = data instanceof ReadableStream ? await new Response(data).blob() : data;
        form.append('document', new Blob([blob], { type: contentType(name) }), name);
    }
    if (options.schema !== undefined) form.append('schema', options.schema);
    if (options.schemaFile !== undefined) {
        const { blob, name } = await fileBlob(options.schemaFile);
        form.append('schema_file', blob, name);
    }
    if (options.doctype === true) form.append('doctype', '1');
    for (const pin of pinsOf(options.rulesVersion)) form.append('rules_version[]', pin);
    const rules = options.rules;
    if (typeof rules === 'string' || rules instanceof Blob) {
        const { blob, name } = await fileBlob(rules);
        form.append('rules_file', blob, name);
    } else if (rules !== undefined) {
        for (const [relative, file] of Object.entries(rules)) {
            form.append('rules_file[]', (await fileBlob(file)).blob, basename(relative));
            form.append('rules_path[]', relative);
        }
    }
    form.append('wait', wait);
    return { body: form, headers: {}, reusable: true };
}

async function apiError(response: Response): Promise<ApiError> {
    const status = response.status;
    let data: unknown = null;
    try {
        data = await response.json();
    } catch {
        // not JSON: a proxy's error page
    }
    const error = data !== null && typeof data === 'object' && 'error' in data && typeof data.error === 'object' && data.error !== null ? (data.error as Record<string, unknown>) : {};
    const code = typeof error['code'] === 'string' ? error['code'] : status >= 500 ? 'server_error' : 'http_error';
    const message = typeof error['message'] === 'string' && error['message'] !== '' ? error['message'] : `xmlvalid answered HTTP ${status}.`;
    const fields: Record<string, string[]> = {};
    if (error['fields'] !== null && typeof error['fields'] === 'object') {
        for (const [field, problems] of Object.entries(error['fields'] as Record<string, unknown>)) {
            fields[field] = Array.isArray(problems) ? problems.map(String) : [];
        }
    }

    const Kind =
        status === 401 ? AuthenticationError
        : status === 403 ? PlanLimitError
        : status === 404 ? NotFoundError
        : status === 409 && code === 'rules_version_mismatch' ? RulesVersionMismatchError
        : status === 409 ? NotFinishedError
        : status === 413 ? DocumentTooLargeError
        : status === 422 ? InvalidRequestError
        : status === 429 && code === 'quota_exceeded' ? QuotaExceededError
        : status === 429 ? RateLimitedError
        : status >= 500 ? ServerError
        : ApiError;

    const exception = new Kind(message, status, code, fields);
    if (exception instanceof RateLimitedError) {
        exception.retryAfter = Number.parseInt(response.headers.get('Retry-After') ?? '', 10) || 0;
    }
    if (exception instanceof RulesVersionMismatchError) {
        exception.ruleSet = typeof error['rule_set'] === 'string' ? error['rule_set'] : '';
        exception.pinned = typeof error['pinned'] === 'string' ? error['pinned'] : '';
        exception.current = typeof error['current'] === 'string' ? error['current'] : '';
    }
    return exception;
}
