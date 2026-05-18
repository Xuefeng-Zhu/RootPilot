import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth.js';
import type { OTLPResourceSpans } from '../../normalizers/traces.js';
import { normalizeSpans } from '../../normalizers/traces.js';
import { getClickHouseClient } from '../../db/clickhouse.js';

/**
 * Payload structure for trace ingestion.
 */
interface TraceIngestPayload {
  resourceSpans: OTLPResourceSpans[];
}

/**
 * Validates that span kind values are within the valid range (0-5).
 * Returns an error message if invalid, or null if all valid.
 */
function validateSpanKinds(resourceSpans: OTLPResourceSpans[]): string | null {
  for (const resourceSpan of resourceSpans) {
    if (!resourceSpan.scopeSpans || !Array.isArray(resourceSpan.scopeSpans)) continue;
    for (const scopeSpan of resourceSpan.scopeSpans) {
      if (!scopeSpan.spans || !Array.isArray(scopeSpan.spans)) continue;
      for (const span of scopeSpan.spans) {
        if (span.kind !== undefined && span.kind !== null) {
          const kind = Number(span.kind);
          if (!Number.isInteger(kind) || kind < 0 || kind > 5) {
            return `Invalid span kind value: ${span.kind}. Must be an integer between 0 and 5`;
          }
        }
      }
    }
  }
  return null;
}

/**
 * Validates that span status code values are within the valid range (0-2).
 * Returns an error message if invalid, or null if all valid.
 */
function validateStatusCodes(resourceSpans: OTLPResourceSpans[]): string | null {
  for (const resourceSpan of resourceSpans) {
    if (!resourceSpan.scopeSpans || !Array.isArray(resourceSpan.scopeSpans)) continue;
    for (const scopeSpan of resourceSpan.scopeSpans) {
      if (!scopeSpan.spans || !Array.isArray(scopeSpan.spans)) continue;
      for (const span of scopeSpan.spans) {
        if (span.status && span.status.code !== undefined && span.status.code !== null) {
          const code = Number(span.status.code);
          if (!Number.isInteger(code) || code < 0 || code > 2) {
            return `Invalid status code value: ${span.status.code}. Must be an integer between 0 and 2`;
          }
        }
      }
    }
  }
  return null;
}

/**
 * Validates the structural integrity of the trace ingestion payload.
 * Returns an error message if invalid, or null if valid.
 */
function validatePayloadStructure(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return 'Request body must be a valid JSON object';
  }

  const payload = body as Record<string, unknown>;

  if (!payload.resourceSpans) {
    return 'Missing required field: resourceSpans';
  }

  if (!Array.isArray(payload.resourceSpans)) {
    return 'Field resourceSpans must be an array';
  }

  if (payload.resourceSpans.length === 0) {
    return 'resourceSpans array must not be empty';
  }

  for (let i = 0; i < payload.resourceSpans.length; i++) {
    const resourceSpan = payload.resourceSpans[i] as Record<string, unknown>;

    if (!resourceSpan.scopeSpans) {
      return `resourceSpans[${i}] is missing required field: scopeSpans`;
    }

    if (!Array.isArray(resourceSpan.scopeSpans)) {
      return `resourceSpans[${i}].scopeSpans must be an array`;
    }

    for (let j = 0; j < (resourceSpan.scopeSpans as unknown[]).length; j++) {
      const scopeSpan = (resourceSpan.scopeSpans as Record<string, unknown>[])[j];

      if (!scopeSpan.spans) {
        return `resourceSpans[${i}].scopeSpans[${j}] is missing required field: spans`;
      }

      if (!Array.isArray(scopeSpan.spans)) {
        return `resourceSpans[${i}].scopeSpans[${j}].spans must be an array`;
      }

      const spans = scopeSpan.spans as Record<string, unknown>[];

      if (spans.length === 0) {
        return `resourceSpans[${i}].scopeSpans[${j}].spans must contain at least one span`;
      }

      for (let k = 0; k < spans.length; k++) {
        const span = spans[k];
        const prefix = `resourceSpans[${i}].scopeSpans[${j}].spans[${k}]`;

        if (!span.traceId || typeof span.traceId !== 'string') {
          return `${prefix} is missing required field: traceId`;
        }
        if (!span.spanId || typeof span.spanId !== 'string') {
          return `${prefix} is missing required field: spanId`;
        }
        if (!span.name || typeof span.name !== 'string') {
          return `${prefix} is missing required field: name`;
        }
        if (!span.startTimeUnixNano) {
          return `${prefix} is missing required field: startTimeUnixNano`;
        }
        if (!span.endTimeUnixNano) {
          return `${prefix} is missing required field: endTimeUnixNano`;
        }
      }
    }
  }

  return null;
}

/**
 * Fastify route plugin for trace ingestion.
 * POST /v1/ingest/traces
 *
 * Validates the OTLP-style payload, normalizes spans to the canonical model,
 * and batch inserts them into the ClickHouse spans table.
 */
export default async function traceIngestRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/v1/ingest/traces',
    { preHandler: authMiddleware },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Validate payload structure
      const structureError = validatePayloadStructure(request.body);
      if (structureError) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: structureError,
          },
        });
      }

      const body = request.body as TraceIngestPayload;

      // Validate span kind values (reject entire request on invalid)
      const kindError = validateSpanKinds(body.resourceSpans);
      if (kindError) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: kindError,
          },
        });
      }

      // Validate status code values (reject entire request on invalid)
      const statusError = validateStatusCodes(body.resourceSpans);
      if (statusError) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: statusError,
          },
        });
      }

      // Normalize spans to canonical model
      const { tenantId, projectId } = request.tenantContext;
      const canonicalSpans = normalizeSpans(body.resourceSpans, tenantId, projectId);

      // Batch insert into ClickHouse spans table
      const clickhouse = getClickHouseClient();
      await clickhouse.batchInsert(
        'spans',
        canonicalSpans.map((span) => ({
          ...span,
          resource_attributes: JSON.stringify(span.resource_attributes),
          attributes: JSON.stringify(span.attributes),
          parent_span_id: span.parent_span_id ?? '',
        })),
      );

      return reply.status(202).send({ accepted: true });
    },
  );
}
