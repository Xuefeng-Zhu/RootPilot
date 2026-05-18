import crypto from 'node:crypto';

export interface ErrorFingerprintInput {
  tenantId: string;
  projectId: string;
  serviceName: string;
  route?: string;
  operationName?: string;
  errorType?: string;
  message: string;
}

export interface ErrorFingerprint {
  id: string;
  fingerprint: string;
  normalizedMessage: string;
}

const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const HEX_ID_PATTERN = /\b[0-9a-f]{16,64}\b/gi;
const ISO_TIMESTAMP_PATTERN = /\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z?\b/gi;
const KEYED_ID_PATTERN =
  /\b(user|session|request|req|trace|span|txn|order|cart|payment)[_-][a-z0-9-]+\b/gi;
const DURATION_PATTERN = /\b\d+(?:\.\d+)?\s?(ms|s|seconds?|milliseconds?)\b/gi;
const NUMBER_PATTERN = /\b\d+(?:\.\d+)?\b/g;
const WHITESPACE_PATTERN = /\s+/g;

export function normalizeErrorMessage(value: string): string {
  return value
    .toLowerCase()
    .replace(ISO_TIMESTAMP_PATTERN, '<timestamp>')
    .replace(UUID_PATTERN, '<uuid>')
    .replace(HEX_ID_PATTERN, '<hex>')
    .replace(KEYED_ID_PATTERN, '<id>')
    .replace(DURATION_PATTERN, '<number>$1')
    .replace(NUMBER_PATTERN, '<number>')
    .replace(WHITESPACE_PATTERN, ' ')
    .trim();
}

export function createErrorFingerprint(input: ErrorFingerprintInput): ErrorFingerprint {
  const normalizedMessage = normalizeErrorMessage(input.message);
  const stableParts = [
    input.serviceName,
    input.errorType ?? '',
    input.route ?? '',
    input.operationName ?? '',
    normalizedMessage,
  ];
  const fingerprint = crypto.createHash('sha256').update(stableParts.join('|')).digest('hex');
  const id = `eg_${crypto
    .createHash('sha256')
    .update(`${input.tenantId}|${input.projectId}|${fingerprint}`)
    .digest('hex')
    .slice(0, 24)}`;

  return {
    id,
    fingerprint,
    normalizedMessage,
  };
}

export function safeJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function stringAttribute(
  attributes: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return undefined;
}
