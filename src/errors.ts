import type { Validation } from './models.ts';

/** Anything that went wrong talking to xmlvalid. Every error the client throws extends it. */
export class XmlvalidError extends Error {
    override name = 'XmlvalidError';
}

/** The API refused the request. */
export class ApiError extends XmlvalidError {
    override name = 'ApiError';
    /** The HTTP status. */
    readonly statusCode: number;
    /** The API's code: unauthenticated, invalid_request, quota_exceeded, … */
    readonly errorCode: string;
    /** For invalid_request: the problems per field. */
    readonly fields: Record<string, string[]>;

    constructor(message: string, statusCode: number, errorCode: string, fields: Record<string, string[]> = {}) {
        super(message);
        this.statusCode = statusCode;
        this.errorCode = errorCode;
        this.fields = fields;
    }
}

/** 401: no key, or a revoked one. */
export class AuthenticationError extends ApiError {
    override name = 'AuthenticationError';
}

/** 403: not in your plan. */
export class PlanLimitError extends ApiError {
    override name = 'PlanLimitError';
}

/** 404: no such validation, or it expired (24 hours). */
export class NotFoundError extends ApiError {
    override name = 'NotFoundError';
}

/** 409: the report of a validation still running. */
export class NotFinishedError extends ApiError {
    override name = 'NotFinishedError';
}

/** 413: over your plan's size limit. */
export class DocumentTooLargeError extends ApiError {
    override name = 'DocumentTooLargeError';
}

/** 422: an unknown schema, a bad URL, …; see `fields`. */
export class InvalidRequestError extends ApiError {
    override name = 'InvalidRequestError';
}

/** 429: this month's validations are used up. */
export class QuotaExceededError extends ApiError {
    override name = 'QuotaExceededError';
}

/** 429: too many requests a minute, still so after the retries. */
export class RateLimitedError extends ApiError {
    override name = 'RateLimitedError';
    /** Seconds to wait before the next request. */
    retryAfter = 0;
}

/** 5xx: something broke on xmlvalid's side. */
export class ServerError extends ApiError {
    override name = 'ServerError';
}

/** The request could not be sent, or its answer read. */
export class TransportError extends XmlvalidError {
    override name = 'TransportError';
}

/** The validation was still running when the timeout ran out. It goes on on the server. */
export class ValidationTimeoutError extends XmlvalidError {
    override name = 'ValidationTimeoutError';
    readonly validation: Validation;

    constructor(validation: Validation, timeout: number) {
        super(`Validation ${validation.id} was still ${validation.status} after ${timeout} seconds.`);
        this.validation = validation;
    }
}

/** A webhook's signature is missing, too old or does not match. */
export class SignatureVerificationError extends XmlvalidError {
    override name = 'SignatureVerificationError';
}
