export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

let csrfToken = '';

export function setCsrfToken(token: string): void {
  csrfToken = token;
}

export function resetCsrfToken(): void {
  csrfToken = '';
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readError(response: Response): Promise<ApiError> {
  let code = 'error';
  let message = 'Algo deu errado. Tente de novo.';
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && isRecord(body['error'])) {
      const error = body['error'];
      if (typeof error['code'] === 'string') code = error['code'];
      if (typeof error['message'] === 'string') message = error['message'];
    }
  } catch {
    // The body was not JSON; keep the generic error.
  }
  return new ApiError(response.status, code, message);
}

/** Same-origin JSON request. Mutating methods carry the CSRF token from `/api/me`. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (!SAFE_METHODS.has(method)) headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(path, { ...init, method, headers, credentials: 'same-origin' });
  if (!response.ok) throw await readError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
