/**
 * Rate-limit-aware fetch retry for Rubin RSP calls.
 *
 * The RSP API gateway enforces per-user rate limits (documented in the live
 * Phalanx config; e.g. ~1000 TAP and only ~35 image-cutout requests per 15-min
 * window) and replies **429 Too Many Requests** with a `Retry-After` header when
 * a client exceeds them. Before this, every client here checked only `resp.ok`
 * and threw on the first 429 — so normal use of the tight cutout budget would
 * surface as a hard error. This wraps a fetch so a 429 (or a transient 503) is
 * retried a bounded number of times, honouring `Retry-After` when present and
 * otherwise backing off exponentially.
 *
 * PURE-ish and testable: `sleep` and `fetchImpl` are injectable so tests drive
 * the retry logic deterministically without real timers or network. It is
 * status-based only (it does not swallow network errors) and gives up after
 * `maxRetries`, returning the final Response so the caller's existing
 * error-handling still runs.
 *
 * Sources: RSP rate limits — live idfprod Phalanx values; 429 + `Retry-After`
 * per RFC 9110 §10.2.3. See docs/rubin-api-usage.md.
 */

/** HTTP statuses worth retrying: 429 (rate limited) and 503 (transient down). */
export const DEFAULT_RETRY_STATUSES = [429, 503] as const;

export interface RetryOptions {
  /** Max retries AFTER the first attempt (so up to maxRetries+1 requests). */
  maxRetries?: number;
  /** Base backoff in ms (attempt n waits baseDelayMs·2ⁿ, capped). */
  baseDelayMs?: number;
  /** Upper bound on any single backoff wait, ms. */
  maxDelayMs?: number;
  /** Statuses to retry. Default {@link DEFAULT_RETRY_STATUSES}. */
  retryStatuses?: readonly number[];
  /**
   * Also retry a NETWORK REJECTION (fetch itself throwing — a transient
   * network/CORS blip, `status===null` at the call site) with the same bounded
   * backoff. Default false (status-based only, preserving the TAP callers'
   * behaviour). An `AbortError` is NEVER retried — it propagates immediately so a
   * superseded/cancelled request stops at once.
   */
  retryOnNetworkError?: boolean;
  /** Injectable delay (default setTimeout-based) — tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable fetch (default global fetch) — tests pass a stub. */
  fetchImpl?: typeof fetch;
  /** Clock for HTTP-date Retry-After parsing (ms since epoch). Tests inject it. */
  now?: () => number;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 8000;
/** Never wait longer than this for a server-sent Retry-After (guard a huge value). */
const RETRY_AFTER_CAP_MS = 60_000;

/**
 * Parse an HTTP `Retry-After` header into milliseconds, or null if absent/unparseable.
 * Accepts both forms: delta-seconds (`"120"`) and an HTTP-date. A past date → 0.
 */
export function parseRetryAfterMs(
  value: string | null | undefined,
  nowMs: number = Date.now()
): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;

  // delta-seconds form (a non-negative integer).
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }

  // HTTP-date form.
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return null;
  return Math.max(0, dateMs - nowMs);
}

/** Default real timer. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch `url` with bounded retry on rate-limit / transient statuses. On a
 * retryable status it waits `Retry-After` (if the server sent one, capped) or an
 * exponential backoff, then retries — up to `maxRetries` times. Returns the last
 * Response (successful, non-retryable, or the final retryable one) so callers
 * keep their own status handling. Network rejections are NOT retried; they
 * propagate to the caller unchanged.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: RetryOptions = {}
): Promise<Response> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    retryStatuses = DEFAULT_RETRY_STATUSES,
    retryOnNetworkError = false,
    sleep = defaultSleep,
    fetchImpl = fetch,
    now = Date.now,
  } = options;

  let attempt = 0;
  for (;;) {
    let resp: Response;
    try {
      resp = await fetchImpl(url, init);
    } catch (err) {
      // Network rejection (fetch threw — transient blip / CORS). Never retry an
      // AbortError: a superseded/cancelled request must stop immediately. Otherwise,
      // if opted in and retries remain, back off and try again; else re-throw so the
      // caller's existing catch runs (status===null failure).
      const isAbort = (err as { name?: string } | null)?.name === 'AbortError';
      if (isAbort || !retryOnNetworkError || attempt >= maxRetries) throw err;
      await sleep(Math.min(maxDelayMs, baseDelayMs * 2 ** attempt));
      attempt += 1;
      continue;
    }
    if (!retryStatuses.includes(resp.status) || attempt >= maxRetries) {
      return resp;
    }

    const retryAfter = parseRetryAfterMs(resp.headers?.get?.('retry-after'), now());
    const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
    const delayMs =
      retryAfter !== null ? Math.min(retryAfter, RETRY_AFTER_CAP_MS) : backoff;

    await sleep(delayMs);
    attempt += 1;
  }
}
