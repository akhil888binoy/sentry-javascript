/* eslint-disable max-lines */
import type {
  Instrumenter,
  Primitive,
  Span as SpanInterface,
  SpanAttributeValue,
  SpanAttributes,
  SpanContext,
  SpanContextData,
  SpanJSON,
  SpanOrigin,
  SpanTimeInput,
  TraceContext,
  Transaction,
} from '@sentry/types';
import { dropUndefinedKeys, logger, timestampInSeconds, uuid4 } from '@sentry/utils';

import { DEBUG_BUILD } from '../debug-build';
import {
  TRACE_FLAG_NONE,
  TRACE_FLAG_SAMPLED,
  spanTimeInputToSeconds,
  spanToJSON,
  spanToTraceContext,
  spanToTraceHeader,
} from '../utils/spanUtils';

/**
 * Keeps track of finished spans for a given transaction
 * @internal
 * @hideconstructor
 * @hidden
 */
export class SpanRecorder {
  public spans: Span[];

  private readonly _maxlen: number;

  public constructor(maxlen: number = 1000) {
    this._maxlen = maxlen;
    this.spans = [];
  }

  /**
   * This is just so that we don't run out of memory while recording a lot
   * of spans. At some point we just stop and flush out the start of the
   * trace tree (i.e.the first n spans with the smallest
   * start_timestamp).
   */
  public add(span: Span): void {
    if (this.spans.length > this._maxlen) {
      span.spanRecorder = undefined;
    } else {
      this.spans.push(span);
    }
  }
}

/**
 * Span contains all data about a span
 */
export class Span implements SpanInterface {
  /**
   * @inheritDoc
   */
  public parentSpanId?: string;

  /**
   * Internal keeper of the status
   */
  public status?: SpanStatusType | string;

  /**
   * Timestamp in seconds when the span was created.
   */
  public startTimestamp: number;

  /**
   * Timestamp in seconds when the span ended.
   */
  public endTimestamp?: number;

  /**
   * @inheritDoc
   */
  public op?: string;

  /**
   * Tags for the span.
   * @deprecated Use `getSpanAttributes(span)` instead.
   */
  public tags: { [key: string]: Primitive };

  /**
   * Data for the span.
   * @deprecated Use `getSpanAttributes(span)` instead.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public data: { [key: string]: any };

  /**
   * List of spans that were finalized
   */
  public spanRecorder?: SpanRecorder;

  /**
   * @inheritDoc
   */
  public transaction?: Transaction;

  /**
   * The instrumenter that created this span.
   *
   * TODO (v8): This can probably be replaced by an `instanceOf` check of the span class.
   *            the instrumenter can only be sentry or otel so we can check the span instance
   *            to verify which one it is and remove this field entirely.
   *
   * @deprecated This field will be removed.
   */
  public instrumenter: Instrumenter;

  /**
   * The origin of the span, giving context about what created the span.
   */
  public origin?: SpanOrigin;

  protected _traceId: string;
  protected _spanId: string;
  protected _sampled: boolean | undefined;
  protected _name?: string;
  protected _attributes: SpanAttributes;

  private _logMessage?: string;

  /**
   * You should never call the constructor manually, always use `Sentry.startTransaction()`
   * or call `startChild()` on an existing span.
   * @internal
   * @hideconstructor
   * @hidden
   */
  public constructor(spanContext: SpanContext = {}) {
    this._traceId = spanContext.traceId || uuid4();
    this._spanId = spanContext.spanId || uuid4().substring(16);
    this.startTimestamp = spanContext.startTimestamp || timestampInSeconds();
    // eslint-disable-next-line deprecation/deprecation
    this.tags = spanContext.tags ? { ...spanContext.tags } : {};
    // eslint-disable-next-line deprecation/deprecation
    this.data = spanContext.data ? { ...spanContext.data } : {};
    this._attributes = spanContext.attributes ? { ...spanContext.attributes } : {};
    // eslint-disable-next-line deprecation/deprecation
    this.instrumenter = spanContext.instrumenter || 'sentry';
    this.origin = spanContext.origin || 'manual';
    // eslint-disable-next-line deprecation/deprecation
    this._name = spanContext.name || spanContext.description;

    if (spanContext.parentSpanId) {
      this.parentSpanId = spanContext.parentSpanId;
    }
    // We want to include booleans as well here
    if ('sampled' in spanContext) {
      this._sampled = spanContext.sampled;
    }
    if (spanContext.op) {
      this.op = spanContext.op;
    }
    if (spanContext.status) {
      this.status = spanContext.status;
    }
    if (spanContext.endTimestamp) {
      this.endTimestamp = spanContext.endTimestamp;
    }
  }

  // This rule conflicts with another eslint rule :(
  /* eslint-disable @typescript-eslint/member-ordering */

  /**
   * An alias for `description` of the Span.
   * @deprecated Use `spanToJSON(span).description` instead.
   */
  public get name(): string {
    return this._name || '';
  }

  /**
   * Update the name of the span.
   * @deprecated Use `spanToJSON(span).description` instead.
   */
  public set name(name: string) {
    this.updateName(name);
  }

  /**
   * Get the description of the Span.
   * @deprecated Use `spanToJSON(span).description` instead.
   */
  public get description(): string | undefined {
    return this._name;
  }

  /**
   * Get the description of the Span.
   * @deprecated Use `spanToJSON(span).description` instead.
   */
  public set description(description: string | undefined) {
    this._name = description;
  }

  /**
   * The ID of the trace.
   * @deprecated Use `spanContext().traceId` instead.
   */
  public get traceId(): string {
    return this._traceId;
  }

  /**
   * The ID of the trace.
   * @deprecated You cannot update the traceId of a span after span creation.
   */
  public set traceId(traceId: string) {
    this._traceId = traceId;
  }

  /**
   * The ID of the span.
   * @deprecated Use `spanContext().spanId` instead.
   */
  public get spanId(): string {
    return this._spanId;
  }

  /**
   * The ID of the span.
   * @deprecated You cannot update the spanId of a span after span creation.
   */
  public set spanId(spanId: string) {
    this._spanId = spanId;
  }

  /**
   * Was this span chosen to be sent as part of the sample?
   * @deprecated Use `isRecording()` instead.
   */
  public get sampled(): boolean | undefined {
    return this._sampled;
  }

  /**
   * Was this span chosen to be sent as part of the sample?
   * @deprecated You cannot update the sampling decision of a span after span creation.
   */
  public set sampled(sampled: boolean | undefined) {
    this._sampled = sampled;
  }

  /**
   * Attributes for the span.
   * @deprecated Use `getSpanAttributes(span)` instead.
   */
  public get attributes(): SpanAttributes {
    return this._attributes;
  }

  /**
   * Attributes for the span.
   * @deprecated Use `setAttributes()` instead.
   */
  public set attributes(attributes: SpanAttributes) {
    this._attributes = attributes;
  }

  /* eslint-enable @typescript-eslint/member-ordering */

  /** @inheritdoc */
  public spanContext(): SpanContextData {
    const { _spanId: spanId, _traceId: traceId, _sampled: sampled } = this;
    return {
      spanId,
      traceId,
      traceFlags: sampled ? TRACE_FLAG_SAMPLED : TRACE_FLAG_NONE,
    };
  }

  /**
   * Creates a new `Span` while setting the current `Span.id` as `parentSpanId`.
   * Also the `sampled` decision will be inherited.
   *
   * @deprecated Use `startSpan()`, `startSpanManual()` or `startInactiveSpan()` instead.
   */
  public startChild(
    spanContext?: Pick<SpanContext, Exclude<keyof SpanContext, 'sampled' | 'traceId' | 'parentSpanId'>>,
  ): Span {
    const childSpan = new Span({
      ...spanContext,
      parentSpanId: this._spanId,
      sampled: this._sampled,
      traceId: this._traceId,
    });

    childSpan.spanRecorder = this.spanRecorder;
    if (childSpan.spanRecorder) {
      childSpan.spanRecorder.add(childSpan);
    }

    childSpan.transaction = this.transaction;

    if (DEBUG_BUILD && childSpan.transaction) {
      const opStr = (spanContext && spanContext.op) || '< unknown op >';
      const nameStr = spanToJSON(childSpan).description || '< unknown name >';
      const idStr = childSpan.transaction.spanContext().spanId;

      const logMessage = `[Tracing] Starting '${opStr}' span on transaction '${nameStr}' (${idStr}).`;
      logger.log(logMessage);
      this._logMessage = logMessage;
    }

    return childSpan;
  }

  /**
   * Sets the tag attribute on the current span.
   *
   * Can also be used to unset a tag, by passing `undefined`.
   *
   * @param key Tag key
   * @param value Tag value
   * @deprecated Use `setAttribute()` instead.
   */
  public setTag(key: string, value: Primitive): this {
    // eslint-disable-next-line deprecation/deprecation
    this.tags = { ...this.tags, [key]: value };
    return this;
  }

  /**
   * Sets the data attribute on the current span
   * @param key Data key
   * @param value Data value
   * @deprecated Use `setAttribute()` instead.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public setData(key: string, value: any): this {
    // eslint-disable-next-line deprecation/deprecation
    this.data = { ...this.data, [key]: value };
    return this;
  }

  /** @inheritdoc */
  public setAttribute(key: string, value: SpanAttributeValue | undefined): void {
    if (value === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete this._attributes[key];
    } else {
      this._attributes[key] = value;
    }
  }

  /** @inheritdoc */
  public setAttributes(attributes: SpanAttributes): void {
    Object.keys(attributes).forEach(key => this.setAttribute(key, attributes[key]));
  }

  /**
   * @inheritDoc
   */
  public setStatus(value: SpanStatusType): this {
    this.status = value;
    return this;
  }

  /**
   * @inheritDoc
   */
  public setHttpStatus(httpStatus: number): this {
    // eslint-disable-next-line deprecation/deprecation
    this.setTag('http.status_code', String(httpStatus));
    // eslint-disable-next-line deprecation/deprecation
    this.setData('http.response.status_code', httpStatus);
    const spanStatus = spanStatusfromHttpCode(httpStatus);
    if (spanStatus !== 'unknown_error') {
      this.setStatus(spanStatus);
    }
    return this;
  }

  /** @inheritdoc */
  public setName(name: string): void {
    this.updateName(name);
  }

  /**
   * @inheritDoc
   */
  public updateName(name: string): this {
    this._name = name;
    return this;
  }

  /**
   * @inheritDoc
   */
  public isSuccess(): boolean {
    return this.status === 'ok';
  }

  /**
   * @inheritDoc
   *
   * @deprecated Use `.end()` instead.
   */
  public finish(endTimestamp?: number): void {
    return this.end(endTimestamp);
  }

  /** @inheritdoc */
  public end(endTimestamp?: SpanTimeInput): void {
    if (
      DEBUG_BUILD &&
      // Don't call this for transactions
      this.transaction &&
      this.transaction.spanContext().spanId !== this._spanId
    ) {
      const logMessage = this._logMessage;
      if (logMessage) {
        logger.log((logMessage as string).replace('Starting', 'Finishing'));
      }
    }

    this.endTimestamp = spanTimeInputToSeconds(endTimestamp);
  }

  /**
   * @inheritDoc
   */
  public toTraceparent(): string {
    return spanToTraceHeader(this);
  }

  /**
   * @inheritDoc
   */
  public toContext(): SpanContext {
    return dropUndefinedKeys({
      data: this._getData(),
      description: this._name,
      endTimestamp: this.endTimestamp,
      op: this.op,
      parentSpanId: this.parentSpanId,
      sampled: this._sampled,
      spanId: this._spanId,
      startTimestamp: this.startTimestamp,
      status: this.status,
      // eslint-disable-next-line deprecation/deprecation
      tags: this.tags,
      traceId: this._traceId,
    });
  }

  /**
   * @inheritDoc
   */
  public updateWithContext(spanContext: SpanContext): this {
    // eslint-disable-next-line deprecation/deprecation
    this.data = spanContext.data || {};
    // eslint-disable-next-line deprecation/deprecation
    this._name = spanContext.name || spanContext.description;
    this.endTimestamp = spanContext.endTimestamp;
    this.op = spanContext.op;
    this.parentSpanId = spanContext.parentSpanId;
    this._sampled = spanContext.sampled;
    this._spanId = spanContext.spanId || this._spanId;
    this.startTimestamp = spanContext.startTimestamp || this.startTimestamp;
    this.status = spanContext.status;
    // eslint-disable-next-line deprecation/deprecation
    this.tags = spanContext.tags || {};
    this._traceId = spanContext.traceId || this._traceId;

    return this;
  }

  /**
   * @inheritDoc
   */
  public getTraceContext(): TraceContext {
    return spanToTraceContext(this);
  }

  /**
   * Get JSON representation of this span.
   */
  public getSpanJSON(): SpanJSON {
    return dropUndefinedKeys({
      data: this._getData(),
      description: this._name,
      op: this.op,
      parent_span_id: this.parentSpanId,
      span_id: this._spanId,
      start_timestamp: this.startTimestamp,
      status: this.status,
      // eslint-disable-next-line deprecation/deprecation
      tags: Object.keys(this.tags).length > 0 ? this.tags : undefined,
      timestamp: this.endTimestamp,
      trace_id: this._traceId,
      origin: this.origin,
    });
  }

  /** @inheritdoc */
  public isRecording(): boolean {
    return !this.endTimestamp && !!this._sampled;
  }

  /**
   * Convert the object to JSON.
   * @deprecated Use `spanToJSON(span)` instead.
   */
  public toJSON(): SpanJSON {
    return this.getSpanJSON();
  }

  /**
   * Get the merged data for this span.
   * For now, this combines `data` and `attributes` together,
   * until eventually we can ingest `attributes` directly.
   */
  private _getData():
    | {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [key: string]: any;
      }
    | undefined {
    // eslint-disable-next-line deprecation/deprecation
    const { data, _attributes: attributes } = this;

    const hasData = Object.keys(data).length > 0;
    const hasAttributes = Object.keys(attributes).length > 0;

    if (!hasData && !hasAttributes) {
      return undefined;
    }

    if (hasData && hasAttributes) {
      return {
        ...data,
        ...attributes,
      };
    }

    return hasData ? data : attributes;
  }
}

export type SpanStatusType =
  /** The operation completed successfully. */
  | 'ok'
  /** Deadline expired before operation could complete. */
  | 'deadline_exceeded'
  /** 401 Unauthorized (actually does mean unauthenticated according to RFC 7235) */
  | 'unauthenticated'
  /** 403 Forbidden */
  | 'permission_denied'
  /** 404 Not Found. Some requested entity (file or directory) was not found. */
  | 'not_found'
  /** 429 Too Many Requests */
  | 'resource_exhausted'
  /** Client specified an invalid argument. 4xx. */
  | 'invalid_argument'
  /** 501 Not Implemented */
  | 'unimplemented'
  /** 503 Service Unavailable */
  | 'unavailable'
  /** Other/generic 5xx. */
  | 'internal_error'
  /** Unknown. Any non-standard HTTP status code. */
  | 'unknown_error'
  /** The operation was cancelled (typically by the user). */
  | 'cancelled'
  /** Already exists (409) */
  | 'already_exists'
  /** Operation was rejected because the system is not in a state required for the operation's */
  | 'failed_precondition'
  /** The operation was aborted, typically due to a concurrency issue. */
  | 'aborted'
  /** Operation was attempted past the valid range. */
  | 'out_of_range'
  /** Unrecoverable data loss or corruption */
  | 'data_loss';

/**
 * Converts a HTTP status code into a {@link SpanStatusType}.
 *
 * @param httpStatus The HTTP response status code.
 * @returns The span status or unknown_error.
 */
export function spanStatusfromHttpCode(httpStatus: number): SpanStatusType {
  if (httpStatus < 400 && httpStatus >= 100) {
    return 'ok';
  }

  if (httpStatus >= 400 && httpStatus < 500) {
    switch (httpStatus) {
      case 401:
        return 'unauthenticated';
      case 403:
        return 'permission_denied';
      case 404:
        return 'not_found';
      case 409:
        return 'already_exists';
      case 413:
        return 'failed_precondition';
      case 429:
        return 'resource_exhausted';
      default:
        return 'invalid_argument';
    }
  }

  if (httpStatus >= 500 && httpStatus < 600) {
    switch (httpStatus) {
      case 501:
        return 'unimplemented';
      case 503:
        return 'unavailable';
      case 504:
        return 'deadline_exceeded';
      default:
        return 'internal_error';
    }
  }

  return 'unknown_error';
}
