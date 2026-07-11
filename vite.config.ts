import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [svelte(), viteSingleFile()],
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
  server: {
    // Rubin's RSP host (data.lsst.cloud) sends no Access-Control-Allow-Origin, so
    // browser fetch/XHR to it from the dev origin (localhost:5173) is CORS-blocked
    // — authenticated HiPS tiles, TAP queries and cutouts all fail with
    // net::ERR_FAILED and the viewer shows black. In dev the client rewrites those
    // absolute URLs to the same-origin path `/rsp/...` (see src/api/rspProxy.ts);
    // this proxy forwards them to data.lsst.cloud server-side (no browser CORS,
    // canvas not tainted), passing the Authorization header through. Prod is
    // expected to be served from the RSP origin itself, so no rewrite happens there.
    proxy: {
      '/rsp': {
        target: 'https://data.lsst.cloud',
        changeOrigin: true,
        secure: true,
        // Rubin's TAP is a UWS service: POST /api/tap/sync returns a 303 whose
        // Location is the ABSOLUTE https://data.lsst.cloud/api/tap/sync/<jobid>/run.
        // Without this, the browser auto-follows that redirect straight to
        // data.lsst.cloud — bypassing this proxy — and it's CORS-blocked (no
        // Access-Control-Allow-Origin), breaking light curves and DIA/alert
        // queries. followRedirects makes the proxy chase the 303 server-side; the
        // redirect stays on data.lsst.cloud (same host), so follow-redirects keeps
        // the Authorization header, and the browser only ever sees this origin.
        followRedirects: true,
        rewrite: (p) => p.replace(/^\/rsp/, ''),
      },
    },
  },
});
