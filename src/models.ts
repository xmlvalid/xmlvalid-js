/** What the API returns, as typed, read-only objects. Each keeps the JSON it came from in `raw` where useful. */

type Json = Record<string, unknown>;

const object = (data: Json, key: string): Json | null => {
    const value = data[key];
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
};
const objects = (data: Json, key: string): Json[] => {
    const value = data[key];
    return Array.isArray(value) ? value.filter((item): item is Json => item !== null && typeof item === 'object' && !Array.isArray(item)) : [];
};
const string = (data: Json, key: string, fallback = ''): string => (typeof data[key] === 'string' ? (data[key] as string) : fallback);
const optionalString = (data: Json, key: string): string | null => (typeof data[key] === 'string' ? (data[key] as string) : null);
const int = (data: Json, key: string): number => (typeof data[key] === 'number' ? Math.trunc(data[key] as number) : 0);
const bool = (data: Json, key: string): boolean => data[key] === true;
const date = (data: Json, key: string): Date | null => {
    const value = data[key];
    if (typeof value !== 'string') return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** A set of business rules a catalog schema runs, at the release in use. */
export class RuleSet {
    /** What rulesVersion pins: peppol-bis-3-ubl. */
    readonly key: string;
    readonly name: string;
    /** The release: 3.0.21. */
    readonly version: string;

    constructor(data: Json) {
        this.key = string(data, 'key');
        this.name = string(data, 'name');
        this.version = string(data, 'version');
    }

    /** The pin for this release: "peppol-bis-3-ubl@3.0.21". */
    get pin(): string {
        return `${this.key}@${this.version}`;
    }

    /** Name and release, once: "Peppol BIS Billing 3.0 rules 3.0.21", "EN 16931 rules 1.3.16 (UBL)". */
    get label(): string {
        return this.name.includes(this.version) ? this.name : `${this.name} ${this.version}`;
    }

    toString(): string {
        return this.label;
    }
}

const ruleSets = (data: Json): RuleSet[] => objects(data, 'rule_sets').map((item) => new RuleSet(item));

/** One error or warning, with where it is and, when there is one, the rule that failed. */
export class Diagnostic {
    /** 0 when the message is about the whole document. */
    readonly line: number;
    /** 0 when unknown; business rules point at an element's line only. */
    readonly column: number;
    /** warning, error or fatal. */
    readonly level: string;
    /** syntax, xsd, relaxng, dtd, schema, io, schematron (a business rule), archive or pdf. */
    readonly type: string;
    readonly message: string;
    /** The business rule that failed (BR-CO-15, PEPPOL-EN16931-R001) or the PDF check (PDF-AF). */
    readonly rule: string | null;
    /** Where a business rule fired, as an XPath with the document's prefixes: /Invoice/cac:InvoiceLine[2]/cbc:LineExtensionAmount. */
    readonly path: string | null;
    /** The message in English, for a rule its publisher wrote in another language. */
    readonly messageEn: string | null;
    /** A page explaining this kind of error and how to fix it. */
    readonly helpUrl: string | null;
    /** The rule's page on xmlvalid.com. */
    readonly ruleUrl: string | null;

    constructor(data: Json) {
        this.line = int(data, 'line');
        this.column = int(data, 'column');
        this.level = string(data, 'level', 'error');
        this.type = string(data, 'type');
        this.message = string(data, 'message');
        this.rule = optionalString(data, 'rule');
        this.path = optionalString(data, 'path');
        this.messageEn = optionalString(data, 'message_en');
        this.helpUrl = optionalString(data, 'help_url');
        this.ruleUrl = optionalString(data, 'rule_url');
    }

    get isWarning(): boolean {
        return this.level === 'warning';
    }

    /** "Line 139: [BR-CO-16] Amount due for payment …" */
    toString(): string {
        return (this.line > 0 ? `Line ${this.line}: ` : '') + (this.rule !== null ? `[${this.rule}] ` : '') + (this.messageEn ?? this.message);
    }
}

/** What checked a document, for an audit trail. */
export class Engine {
    /** The validation engine's version. */
    readonly xmlvalid: string;
    /** The libxml2 of the schema check: 2.13.9. */
    readonly libxml2: string;
    /** The SaxonJS of the business rules; null when none ran. */
    readonly saxonjs: string | null;

    constructor(data: Json) {
        this.xmlvalid = string(data, 'xmlvalid');
        this.libxml2 = string(data, 'libxml2');
        this.saxonjs = optionalString(data, 'saxonjs');
    }
}

const engine = (data: Json): Engine | null => {
    const value = object(data, 'engine');
    return value !== null && optionalString(value, 'libxml2') !== null ? new Engine(value) : null;
};

/** The result for one document of an archive. */
export class ArchiveItem {
    /** Its path in the archive. */
    readonly name: string;
    readonly schema: string | null;
    /** valid, warnings, invalid, schema, input, failed or skipped. */
    readonly outcome: string;
    readonly valid: boolean;
    readonly errorsTotal: number;
    readonly warningsTotal: number;
    readonly errors: Diagnostic[];
    readonly warnings: Diagnostic[];
    /** Why a skipped document was left unchecked. */
    readonly note: string | null;
    /** The business rule sets its schema ran, with their releases. */
    readonly ruleSets: RuleSet[];
    /** SHA-256 of the document (of the PDF for a PDF invoice), in hex. */
    readonly sha256: string | null;
    readonly engine: Engine | null;

    constructor(data: Json) {
        this.name = string(data, 'name');
        this.schema = optionalString(data, 'schema');
        this.ruleSets = ruleSets(data);
        this.outcome = string(data, 'outcome');
        this.valid = bool(data, 'valid');
        this.errorsTotal = int(data, 'errors_total');
        this.warningsTotal = int(data, 'warnings_total');
        this.errors = objects(data, 'errors').map((item) => new Diagnostic(item));
        this.warnings = objects(data, 'warnings').map((item) => new Diagnostic(item));
        this.note = optionalString(data, 'note');
        this.sha256 = optionalString(data, 'sha256');
        this.engine = engine(data);
    }
}

/** What a finished validation found. */
export class Result {
    /** True for the outcomes valid and warnings. */
    readonly valid: boolean;
    /** valid, warnings, invalid, schema (the schema can't be used), input (the document can't be read) or failed. */
    readonly outcome: string;
    readonly errorsTotal: number;
    readonly warningsTotal: number;
    /** More errors were found than are listed. */
    readonly errorsTruncated: boolean;
    /** The first 500. */
    readonly errors: Diagnostic[];
    /** The first 500. */
    readonly warnings: Diagnostic[];
    readonly bytes: number;
    readonly durationMs: number;
    /** For a PDF: the invoice found in it (attachment, attachments, guideline, profile). */
    readonly pdf: Json | null;
    /** For an archive: total, passed, failed, skipped. */
    readonly documents: Json | null;
    /** For an archive: one result per document. */
    readonly items: ArchiveItem[];
    /** SHA-256 of the file as sent (the PDF, the archive), in hex. */
    readonly sha256: string | null;
    /** What checked it: the libxml2 and, when business rules ran, the SaxonJS. */
    readonly engine: Engine | null;

    constructor(data: Json) {
        this.valid = bool(data, 'valid');
        this.outcome = string(data, 'outcome');
        this.errorsTotal = int(data, 'errors_total');
        this.warningsTotal = int(data, 'warnings_total');
        this.errorsTruncated = bool(data, 'errors_truncated');
        this.errors = objects(data, 'errors').map((item) => new Diagnostic(item));
        this.warnings = objects(data, 'warnings').map((item) => new Diagnostic(item));
        this.bytes = int(data, 'bytes');
        this.durationMs = int(data, 'duration_ms');
        this.pdf = object(data, 'pdf');
        this.documents = object(data, 'documents');
        this.items = objects(data, 'items').map((item) => new ArchiveItem(item));
        this.sha256 = optionalString(data, 'sha256');
        this.engine = engine(data);
    }

    get firstError(): Diagnostic | null {
        return this.errors[0] ?? null;
    }
}

/** A validation, finished or not. Results are kept for 24 hours. */
export class Validation {
    static readonly QUEUED = 'queued';
    static readonly RUNNING = 'running';
    static readonly DONE = 'done';
    static readonly FAILED = 'failed';
    static readonly CANCELLED = 'cancelled';

    /** val_… */
    readonly id: string;
    /** queued, running, done, failed (on xmlvalid's side; see `error`) or cancelled. */
    readonly status: string;
    readonly progress: number;
    readonly createdAt: Date | null;
    readonly finishedAt: Date | null;
    /** source, name, size, url. */
    readonly document: Json;
    /** kind, catalog, saved, detected, name. */
    readonly schema: Json | null;
    /** The business rule sets the schema runs, with their releases (empty without rules). */
    readonly ruleSets: RuleSet[];
    readonly result: Result | null;
    /** What went wrong on xmlvalid's side when the status is failed. */
    readonly error: string | null;
    /** The result as an HTML page, once finished (needs the API key). */
    readonly reportUrl: string | null;
    /** The object as the API returned it. */
    readonly raw: Json;

    constructor(data: Json) {
        const result = object(data, 'result');
        this.id = string(data, 'id');
        this.status = string(data, 'status');
        this.progress = int(data, 'progress');
        this.createdAt = date(data, 'created_at');
        this.finishedAt = date(data, 'finished_at');
        this.document = object(data, 'document') ?? {};
        this.schema = object(data, 'schema');
        this.ruleSets = ruleSets(data);
        this.result = result === null ? null : new Result(result);
        this.error = optionalString(data, 'error');
        this.reportUrl = optionalString(object(data, 'links') ?? {}, 'report');
        this.raw = data;
    }

    /** No longer queued or running. */
    get isFinished(): boolean {
        return this.status !== Validation.QUEUED && this.status !== Validation.RUNNING;
    }

    /** Finished, and the document passed (valid, or valid with warnings). */
    get isValid(): boolean {
        return this.result?.valid === true;
    }

    /** The errors found (empty while running). */
    get errors(): Diagnostic[] {
        return this.result?.errors ?? [];
    }

    /** The warnings found (empty while running). */
    get warnings(): Diagnostic[] {
        return this.result?.warnings ?? [];
    }
}

/** This month's validations and the plan's limits. */
export class Usage {
    /** free or pro. */
    readonly plan: string;
    readonly periodStart: Date | null;
    /** When the count resets (the 1st of next month, UTC). */
    readonly resetAt: Date | null;
    readonly used: number;
    readonly limit: number;
    readonly maxFileBytes: number;
    readonly requestsPerMinute: number;

    constructor(data: Json) {
        const period = object(data, 'period') ?? {};
        const validations = object(data, 'validations') ?? {};
        const limits = object(data, 'limits') ?? {};
        this.plan = string(data, 'plan');
        this.periodStart = date(period, 'start');
        this.resetAt = date(period, 'reset_at');
        this.used = int(validations, 'used');
        this.limit = int(validations, 'limit');
        this.maxFileBytes = int(limits, 'max_file_bytes');
        this.requestsPerMinute = int(limits, 'requests_per_minute');
    }

    get remaining(): number {
        return Math.max(0, this.limit - this.used);
    }
}

/** A schema to validate against: one of the account's saved schemas or a catalog entry. */
export class Schema {
    /** The value to pass as schema: a catalog slug (peppol-bis-3-invoice) or a saved schema (my-12). */
    readonly schema: string;
    readonly name: string;
    /** xsd, dtd, rng or rnc. */
    readonly kind: string;
    readonly namespace: string | null;
    readonly saved: boolean;
    readonly version: string | null;
    /** Schematron rule sets run after the schema check, in order. */
    readonly rules: string[];
    /** The same rule sets with their keys and releases, as rulesVersion pins them. */
    readonly ruleSets: RuleSet[];

    constructor(data: Json, saved: boolean) {
        const rules = data['rules'];
        this.schema = string(data, 'schema');
        this.name = string(data, 'name');
        this.kind = string(data, 'kind');
        this.namespace = optionalString(data, 'namespace');
        this.saved = saved;
        this.version = optionalString(data, 'version');
        this.rules = Array.isArray(rules) ? rules.filter((rule): rule is string => typeof rule === 'string') : [];
        this.ruleSets = ruleSets(data);
    }
}

/** A public link to a report, for 30 days. */
export class ReportLink {
    readonly url: string;
    readonly expiresAt: Date | null;

    constructor(data: Json) {
        this.url = string(data, 'url');
        this.expiresAt = date(data, 'expires_at');
    }
}

/**
 * A webhook event: validation.completed, monitor.failed, monitor.recovered or ping.
 * A retry carries the same id, so it can be used to skip events already handled.
 */
export class WebhookEvent {
    static readonly VALIDATION_COMPLETED = 'validation.completed';
    static readonly MONITOR_FAILED = 'monitor.failed';
    static readonly MONITOR_RECOVERED = 'monitor.recovered';
    static readonly PING = 'ping';

    readonly id: string;
    readonly type: string;
    readonly createdAt: Date | null;
    readonly data: Json;

    constructor(payload: Json) {
        this.id = string(payload, 'id');
        this.type = string(payload, 'type');
        this.createdAt = date(payload, 'created_at');
        this.data = object(payload, 'data') ?? {};
    }

    /** The validation of a validation.completed event; null for other events. */
    get validation(): Validation | null {
        return this.type === WebhookEvent.VALIDATION_COMPLETED ? new Validation(this.data) : null;
    }
}
