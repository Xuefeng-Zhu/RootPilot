const API_BASE_URL = 'http://localhost:4000';
const API_KEY = 'rootpilot_demo_key';

interface FetchOptions extends Omit<RequestInit, 'headers'> {
  params?: Record<string, string | number | boolean | undefined>;
}

/**
 * Shared API client for fetching from the RootPilot Query API.
 * Uses the hardcoded demo API key for authentication.
 */
export async function apiClient<T>(
  path: string,
  options: FetchOptions = {}
): Promise<T> {
  const { params, ...fetchOptions } = options;

  let url = `${API_BASE_URL}${path}`;

  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        searchParams.set(key, String(value));
      }
    }
    const queryString = searchParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  }

  const response = await fetch(url, {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const message =
      errorBody?.error?.message ?? `API request failed with status ${response.status}`;
    throw new ApiError(response.status, message, errorBody);
  }

  return response.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
