import { describe, it, expect } from 'vitest';
import { toRequestUrl, RSP_ORIGIN, RSP_PROXY_PREFIX } from '../../src/api/rspProxy.js';

describe('toRequestUrl', () => {
  const hipsTile = `${RSP_ORIGIN}/api/hips/v2/dp1/deep_coadd/color_gri/Norder11/Dir36790000/Npix36798030.png`;

  it('rewrites an absolute Rubin URL to the same-origin proxy path in dev', () => {
    expect(toRequestUrl(hipsTile, true)).toBe(
      `${RSP_PROXY_PREFIX}/api/hips/v2/dp1/deep_coadd/color_gri/Norder11/Dir36790000/Npix36798030.png`
    );
    // TAP + cutout endpoints route through the same prefix.
    expect(toRequestUrl(`${RSP_ORIGIN}/api/dp1/sync`, true)).toBe(`${RSP_PROXY_PREFIX}/api/dp1/sync`);
    expect(toRequestUrl(`${RSP_ORIGIN}/api/cutout/sync`, true)).toBe(`${RSP_PROXY_PREFIX}/api/cutout/sync`);
  });

  it('leaves the absolute Rubin URL untouched in production (served same-origin)', () => {
    expect(toRequestUrl(hipsTile, false)).toBe(hipsTile);
  });

  it('never rewrites public / non-RSP URLs, in either mode', () => {
    const dss = 'https://alasky.cds.unistra.fr/DSS/DSSColor/Norder3/Dir0/Npix0.jpg';
    expect(toRequestUrl(dss, true)).toBe(dss); // public CDS sends CORS; must not proxy
    expect(toRequestUrl(dss, false)).toBe(dss);
    // blob:, data:, and already-relative URLs pass through.
    expect(toRequestUrl('blob:http://localhost:5173/abc', true)).toBe('blob:http://localhost:5173/abc');
    expect(toRequestUrl('data:image/png;base64,AAAA', true)).toBe('data:image/png;base64,AAAA');
    expect(toRequestUrl('/rsp/api/hips/x.png', true)).toBe('/rsp/api/hips/x.png');
  });

  it('does not rewrite a look-alike host (avoids a prefix-match hole)', () => {
    // A different host that merely CONTAINS the origin string must not be rewritten,
    // and the origin without a trailing slash must not be mangled.
    const evil = 'https://data.lsst.cloud.evil.example/api/hips/x.png';
    expect(toRequestUrl(evil, true)).toBe(evil);
    expect(toRequestUrl(RSP_ORIGIN, true)).toBe(RSP_ORIGIN); // no trailing slash → unchanged
  });
});
