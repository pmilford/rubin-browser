import { describe, it, expect } from 'vitest';
import config from '../../vite.config.js';

/**
 * Regression guard for the TAP-redirect CORS bug.
 *
 * Rubin's TAP is a UWS service: POST /api/tap/sync returns a 303 whose Location
 * is the ABSOLUTE https://data.lsst.cloud/api/tap/sync/<jobid>/run. If the dev
 * proxy does NOT follow that redirect server-side, the browser auto-follows it
 * straight to data.lsst.cloud — bypassing the /rsp proxy — and it is CORS-blocked
 * (no Access-Control-Allow-Origin), which breaks light curves and DIA/alert
 * queries with an opaque "Failed to fetch". `followRedirects: true` keeps the
 * whole redirect chain on the server side (same host → the Bearer header is
 * preserved), so the browser only ever talks to the same origin.
 *
 * This asserts the CONFIG, not live network — the live path can only be verified
 * with a real RSP token — but it stops a future edit from silently dropping the
 * option and reintroducing the CORS failure.
 */
describe('vite dev proxy — RSP TAP redirects', () => {
  // vite.config may export an object or a config-factory function.
  const resolved =
    typeof config === 'function'
      ? (config as (env: unknown) => unknown)({ command: 'serve', mode: 'development' })
      : config;

  const rsp = (resolved as { server?: { proxy?: Record<string, unknown> } }).server?.proxy?.[
    '/rsp'
  ] as { target?: string; changeOrigin?: boolean; followRedirects?: boolean } | undefined;

  it('proxies /rsp to the Rubin RSP origin', () => {
    expect(rsp).toBeDefined();
    expect(rsp!.target).toBe('https://data.lsst.cloud');
    expect(rsp!.changeOrigin).toBe(true);
  });

  it('follows the TAP 303 redirect server-side (prevents the cross-origin CORS bounce)', () => {
    expect(rsp!.followRedirects).toBe(true);
  });
});
