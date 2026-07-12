import { describe, it, expect, vi } from 'vitest';
import { fetchWithRetry, parseRetryAfterMs } from '../../src/api/rateLimit.js';

/** Build a minimal Response-like object with a headers.get(). */
function resp(status: number, headers: Record<string, string> = {}): Response {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => lower[k.toLowerCase()] ?? null },
  } as unknown as Response;
}

describe('parseRetryAfterMs', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfterMs('120')).toBe(120_000);
    expect(parseRetryAfterMs('0')).toBe(0);
  });
  it('parses an HTTP-date relative to now (future → positive, past → 0)', () => {
    const now = 1_000_000_000_000;
    const future = new Date(now + 30_000).toUTCString();
    expect(parseRetryAfterMs(future, now)).toBe(30_000);
    const past = new Date(now - 30_000).toUTCString();
    expect(parseRetryAfterMs(past, now)).toBe(0);
  });
  it('returns null for absent/blank/garbage', () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs(undefined)).toBeNull();
    expect(parseRetryAfterMs('   ')).toBeNull();
    expect(parseRetryAfterMs('soon')).toBeNull();
  });
});

describe('fetchWithRetry', () => {
  it('returns immediately on success (no retry, no sleep)', async () => {
    const fetchImpl = vi.fn(async () => resp(200));
    const sleep = vi.fn(async () => {});
    const r = await fetchWithRetry('u', {}, { fetchImpl, sleep });
    expect(r.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries a 429 then returns the subsequent 200', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(resp(429))
      .mockResolvedValueOnce(resp(200));
    const sleep = vi.fn(async () => {});
    const r = await fetchWithRetry('u', {}, { fetchImpl, sleep });
    expect(r.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('honours Retry-After over the exponential backoff', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(resp(429, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(resp(200));
    const sleep = vi.fn(async () => {});
    await fetchWithRetry('u', {}, { fetchImpl, sleep, baseDelayMs: 500 });
    expect(sleep).toHaveBeenCalledWith(2000); // 2s from the header, not 500ms backoff
  });

  it('gives up after maxRetries and returns the last retryable response', async () => {
    const fetchImpl = vi.fn(async () => resp(429));
    const sleep = vi.fn(async () => {});
    const r = await fetchWithRetry('u', {}, { fetchImpl, sleep, maxRetries: 2 });
    expect(r.status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a non-retryable status (e.g. 500)', async () => {
    const fetchImpl = vi.fn(async () => resp(500));
    const sleep = vi.fn(async () => {});
    const r = await fetchWithRetry('u', {}, { fetchImpl, sleep });
    expect(r.status).toBe(500);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('uses exponential backoff when no Retry-After is present', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(resp(503))
      .mockResolvedValueOnce(resp(503))
      .mockResolvedValueOnce(resp(200));
    const sleep = vi.fn(async () => {});
    await fetchWithRetry('u', {}, { fetchImpl, sleep, baseDelayMs: 500 });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([500, 1000]); // 500·2⁰, 500·2¹
  });

  it('propagates a network rejection without retrying (default — TAP callers unchanged)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const sleep = vi.fn(async () => {});
    await expect(fetchWithRetry('u', {}, { fetchImpl, sleep })).rejects.toThrow('Failed to fetch');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // --- retryOnNetworkError (TODO: tile transient-blip resilience) --------------
  it('retries a NETWORK rejection then succeeds when retryOnNetworkError is set', async () => {
    // A transient blip (fetch throws) followed by a 200 — the tile path must recover
    // rather than count it as a hard failure. A no-retry impl throws instead.
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(resp(200));
    const sleep = vi.fn(async () => {});
    const r = await fetchWithRetry('u', {}, { fetchImpl, sleep, retryOnNetworkError: true, baseDelayMs: 400 });
    expect(r.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(400); // backed off once before the retry
  });

  it('gives up after maxRetries on a persistent network rejection and rethrows', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const sleep = vi.fn(async () => {});
    await expect(
      fetchWithRetry('u', {}, { fetchImpl, sleep, retryOnNetworkError: true, maxRetries: 2 }),
    ).rejects.toThrow('Failed to fetch');
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('NEVER retries an AbortError, even with retryOnNetworkError (a superseded tile stops at once)', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchImpl = vi.fn(async () => {
      throw abortErr;
    });
    const sleep = vi.fn(async () => {});
    await expect(
      fetchWithRetry('u', {}, { fetchImpl, sleep, retryOnNetworkError: true, maxRetries: 3 }),
    ).rejects.toBe(abortErr);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no retry on abort
    expect(sleep).not.toHaveBeenCalled();
  });
});
