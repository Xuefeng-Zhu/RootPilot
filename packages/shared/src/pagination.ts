/**
 * Pagination types for cursor-based pagination over time-series data.
 * Cursors are base64-encoded JSON objects containing a timestamp and ID
 * for stable pagination over append-only data.
 */

export interface PaginationParams {
  limit?: number;
  cursor?: string; // base64-encoded { ts: string, id: string }
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    cursor: string | null;
    hasMore: boolean;
  };
}

export interface DecodedCursor {
  ts: string;
  id: string;
}
