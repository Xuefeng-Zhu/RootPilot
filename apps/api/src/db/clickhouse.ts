import { createClient, ClickHouseClient } from '@clickhouse/client';

/**
 * Interface for the ClickHouse client, enabling dependency injection in tests.
 */
export interface IClickHouseClient {
  /** Execute a batch insert using JSONEachRow format. */
  batchInsert<T extends Record<string, unknown>>(
    table: string,
    rows: T[]
  ): Promise<void>;

  /** Execute a parameterized read query. */
  query<T>(
    queryText: string,
    params?: Record<string, unknown>
  ): Promise<T[]>;

  /** Health check — executes SELECT 1. */
  healthCheck(): Promise<boolean>;

  /** Close the client connection. */
  close(): Promise<void>;
}

/**
 * Creates a ClickHouse client with connection pooling, batch insert,
 * parameterized queries, and health check support.
 */
export function createClickHouseClient(config?: {
  host?: string;
  port?: number;
  database?: string;
}): IClickHouseClient {
  const host = config?.host ?? process.env['CLICKHOUSE_HOST'] ?? 'localhost';
  const port = config?.port ?? Number(process.env['CLICKHOUSE_PORT'] ?? '8123');
  const database = config?.database ?? process.env['CLICKHOUSE_DB'] ?? 'rootpilot';

  const client: ClickHouseClient = createClient({
    url: `http://${host}:${port}`,
    database,
    clickhouse_settings: {
      async_insert: 1,
      wait_for_async_insert: 1,
    },
  });

  return {
    async batchInsert<T extends Record<string, unknown>>(
      table: string,
      rows: T[]
    ): Promise<void> {
      if (rows.length === 0) return;

      await client.insert({
        table,
        values: rows,
        format: 'JSONEachRow',
      });
    },

    async query<T>(
      queryText: string,
      params?: Record<string, unknown>
    ): Promise<T[]> {
      const result = await client.query({
        query: queryText,
        query_params: params,
        format: 'JSONEachRow',
      });

      return result.json<T>();
    },

    async healthCheck(): Promise<boolean> {
      try {
        await client.query({ query: 'SELECT 1', format: 'JSONEachRow' });
        return true;
      } catch {
        return false;
      }
    },

    async close(): Promise<void> {
      await client.close();
    },
  };
}

/** Singleton ClickHouse client instance for the application. */
let defaultClient: IClickHouseClient | null = null;

/**
 * Returns the default ClickHouse client instance (singleton).
 * Creates it on first call using environment variables.
 */
export function getClickHouseClient(): IClickHouseClient {
  if (!defaultClient) {
    defaultClient = createClickHouseClient();
  }
  return defaultClient;
}

/**
 * Closes the default ClickHouse client. Useful for graceful shutdown.
 */
export async function closeClickHouseClient(): Promise<void> {
  if (defaultClient) {
    await defaultClient.close();
    defaultClient = null;
  }
}
