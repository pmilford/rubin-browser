/**
 * Dev-only same-origin rewrite for Rubin RSP requests.
 *
 * The RSP host (data.lsst.cloud) sends no `Access-Control-Allow-Origin`, so a
 * browser fetch/XHR to it from another origin (the Vite dev server at
 * http://localhost:5173) is blocked by CORS — every authenticated Rubin HiPS
 * tile, TAP query, and image cutout fails with `net::ERR_FAILED` and the viewer
 * shows black. In DEV we route those requests through the Vite dev-server proxy
 * (see `vite.config.ts` → `server.proxy['/rsp']`): rewriting the absolute RSP URL
 * to the same-origin path `/rsp/...` makes the browser request same-origin (no
 * CORS preflight, and the resulting image does not taint the canvas so the
 * post-processing `getImageData` still works), and the proxy forwards it to
 * data.lsst.cloud server-side WITH the Bearer token attached by the caller.
 *
 * In production the app is expected to be served from the RSP origin itself
 * (same-origin already), so the absolute URL is left untouched.
 *
 * PURE and total: only rewrites absolute data.lsst.cloud URLs, and only in DEV;
 * every other URL — public CDS/DSS tiles, `blob:`/`data:` URLs, already-relative
 * paths — passes through unchanged. Keeping every URL CONSTANT absolute (so
 * `isRubinUrl`, layer labels, and their unit tests are unaffected) and rewriting
 * only here, at the network boundary, is what keeps this change surgical.
 */

/** The absolute Rubin RSP origin that must be proxied in dev. */
export const RSP_ORIGIN = 'https://data.lsst.cloud';

/** The same-origin dev path the Vite proxy forwards to the RSP. */
export const RSP_PROXY_PREFIX = '/rsp';

/**
 * Rewrite an absolute Rubin RSP URL to the same-origin dev-proxy path when
 * running under the Vite dev server; otherwise return the URL unchanged.
 *
 * `isDev` defaults to `import.meta.env.DEV` (true under `vite dev`, false in a
 * production build) and is injectable so the behaviour is unit-testable in both
 * modes without depending on the ambient environment.
 */
export function toRequestUrl(url: string, isDev: boolean = import.meta.env.DEV): string {
  if (isDev && url.startsWith(`${RSP_ORIGIN}/`)) {
    return RSP_PROXY_PREFIX + url.slice(RSP_ORIGIN.length);
  }
  return url;
}
