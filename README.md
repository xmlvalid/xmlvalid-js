# xmlvalid for JavaScript and TypeScript

Client for the [xmlvalid API](https://xmlvalid.com/docs/api): validate XML documents and
e-invoices against XSD, DTD, RelaxNG and Schematron business rules. Peppol BIS, XRechnung,
Factur-X / ZUGFeRD, EN 16931, UBL, CII and national rules (France, Italy, Croatia, Romania and
more) are in the [schema catalog](https://xmlvalid.com/schemas); your own schemas work too.

- No dependencies: the platform's `fetch`. Node 20+, Bun, Deno, Cloudflare Workers, browsers
- TypeScript types, ESM and CommonJS
- Files are streamed from disk, not loaded into memory
- Waits for the result for you, retries when rate limited
- Typed results and errors, webhook signature checks

## Install

```bash
npm install @xmlvalid/sdk
```

Create an API key under [Dashboard → API keys](https://xmlvalid.com/dashboard/api). Keep it on
the server: in a browser, call your own backend rather than putting the key in the page.

## Validate

```ts
import { Xmlvalid } from '@xmlvalid/sdk';

const xmlvalid = new Xmlvalid({ apiKey: 'xv_…' }); // or set XMLVALID_API_KEY

const validation = await xmlvalid.validate('invoice.xml', { schema: 'peppol-bis-3-invoice' });

if (validation.isValid) {
    console.log('Valid');
} else {
    for (const error of validation.errors) {
        console.log(String(error)); // Line 139: [BR-CO-16] Amount due for payment (BT-115) = …
    }
}
```

The document can be:

```ts
await xmlvalid.validate('invoice.xml');                          // a file path (XML, .gz, .zip, EPUB, Factur-X PDF)
await xmlvalid.validate(file);                                   // a File or Blob (an upload, a form field)
await xmlvalid.validate(bytes, { name: 'invoice.xml' });         // a Uint8Array or ArrayBuffer
await xmlvalid.validate(stream, { name: 'invoice.xml' });        // a ReadableStream (not retried)
await xmlvalid.validate({ text: '<Invoice>…</Invoice>' });       // a string
await xmlvalid.validate({ url: 'https://example.com/feed.xml' }); // a public URL, downloaded by xmlvalid
```

The schema:

| Option | Validates against |
|---|---|
| `schema: 'peppol-bis-3-invoice'` | A [catalog](https://xmlvalid.com/schemas) entry, with its business rules |
| `schema: 'auto'` | The catalog profile an e-invoice names (BT-24), for mixed invoices |
| `schema: 'my-12'` | One of your saved schemas |
| `schemaFile: 'order.xsd'` | An XSD, DTD or RelaxNG file (a path or a Blob) sent with the document |
| `doctype: true` | The DOCTYPE the document declares |
| none | Well-formedness only |

Your own Schematron runs after the schema check: `rules: 'rules.sch'`, or for rules with
includes, relative path: file: `rules: { 'main.sch': '/path/main.sch', 'parts/totals.sch': '/path/parts/totals.sch' }`.

`signal: AbortSignal` aborts the requests and the waiting.

## The result

```ts
validation.status;              // done, failed (on xmlvalid's side) or cancelled
validation.result?.outcome;     // valid, warnings, invalid, schema, input or failed
validation.result?.errorsTotal; // all of them; the first 500 are listed
for (const error of validation.errors) {
    error.line; error.column; error.level; error.type; // xsd, schematron, …
    error.rule;                 // BR-CO-16 for a business rule
    error.message;
    error.ruleUrl;              // the rule's page on xmlvalid.com
    error.helpUrl;              // how to fix this kind of error
}
validation.warnings;
validation.raw;                 // the API's JSON
```

For a .zip, `validation.result.items` has one result per document; for a PDF,
`validation.result.pdf` names the invoice found in it.

## Long validations, reports and the account

`validate()` waits up to 15 minutes (`timeout`, in seconds); a `ValidationTimeoutError` carries
the validation, which goes on on the server. To queue and come back later:

```ts
const queued = await xmlvalid.submit('big.xml', { schema: 'ubl-2.1-invoice' });
// …
const done = await xmlvalid.waitFor(queued.id);  // or xmlvalid.validation(id), xmlvalid.cancel(id)

const html = await xmlvalid.report(done);        // the HTML report
const link = await xmlvalid.share([done]);       // a public link for 30 days (Pro): link.url

const usage = await xmlvalid.usage();            // usage.used, usage.limit, usage.remaining
const schemas = await xmlvalid.schemas();        // your saved schemas, then the catalog
```

## Errors

Every error extends `XmlvalidError`. API refusals are `ApiError`s with `statusCode`, `errorCode`
and, for `invalid_request`, `fields`:

| Error | When |
|---|---|
| `AuthenticationError` | 401: no key, a revoked key |
| `PlanLimitError` | 403: not in your plan |
| `NotFoundError` | 404: no such validation, or it expired (24 hours) |
| `NotFinishedError` | 409: the report of a validation still running |
| `DocumentTooLargeError` | 413: over your plan's size limit |
| `InvalidRequestError` | 422: unknown schema, a bad URL, … |
| `QuotaExceededError` | 429: this month's validations are used up |
| `RateLimitedError` | 429: still limited after the retries; `retryAfter` seconds |
| `ServerError` | 5xx |
| `TransportError` | The request could not be sent or its answer read |
| `ValidationTimeoutError` | Still running after `timeout` |

An aborted `signal` rejects with the platform's `AbortError`, as `fetch` does.

## Webhooks

On Pro, xmlvalid can call your endpoint when a validation finishes or a URL monitor changes
state. Check the signature with the endpoint's secret and the raw body:

```ts
import { verifyWebhook, WebhookEvent } from '@xmlvalid/sdk';

// Express: app.post('/xmlvalid/webhook', express.raw({ type: 'application/json' }), …)
const event = await verifyWebhook(
    req.body,                                 // the raw body (Buffer or string), as received
    req.get('Xmlvalid-Signature'),
    process.env.XMLVALID_WEBHOOK_SECRET!,
); // throws SignatureVerificationError

if (event.type === WebhookEvent.VALIDATION_COMPLETED) {
    const validation = event.validation;
}
```

A retried delivery has the same `event.id`. The other events are `monitor.failed`,
`monitor.recovered` (`event.data.monitor`, `event.data.check`) and `ping`.

## Options

```ts
new Xmlvalid({
    apiKey: 'xv_…',                  // default: XMLVALID_API_KEY
    baseUrl: 'https://xmlvalid.com/api/v1',
    timeout: 900,                    // seconds validate() waits in all
    wait: 10,                        // seconds the API holds a new request (0-60)
    maxRetries: 3,                   // retries of a 429 rate_limited
    fetch: myFetch,                  // proxies, tests
});
```

## Development

```bash
npm install
npm test             # node:test, on the TypeScript sources (Node 22.18+)
npm run typecheck
npm run build        # dist/: ESM, CommonJS and types
```

## License

MIT
