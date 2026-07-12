// Reproducible builder for the INDEPENDENT classifier validation holdout.
// Run once (network): `npx tsx scripts/build-holdout-val.mts`
// (NOT a *.test.ts, so it never runs in CI.) Rebuilds
// tests/fixtures/objectClassifier-holdout-val.json from live CDS data.
import { writeFileSync } from 'node:fs';
import { readFits } from '../src/utils/fits.js';

// One-off builder for an INDEPENDENT validation holdout (fresh objects NOT in the
// tuning fixture). Same recipe (DSS2-red hips2fits + asinh a=10, black=25th pct,
// white=max, 8-bit) verified faithful by _selfcheck. Names resolved server-side by
// hips2fits (Sesame); labels curated ground truth for these unambiguous objects.
// Deliberately spans very bright stars (Sirius/Vega/Aldebaran - the saturated-halo
// hard case) and irregular/edge-on galaxies (M82/NGC 891/Cen A - the galaxy stress
// case) so the validation is adversarial to both classes.
const OBJECTS: { name: string; label: 'star' | 'galaxy' }[] = [
  { name: 'Sirius', label: 'star' }, { name: 'Vega', label: 'star' }, { name: 'Altair', label: 'star' },
  { name: 'Fomalhaut', label: 'star' }, { name: 'Procyon', label: 'star' }, { name: 'Aldebaran', label: 'star' },
  { name: 'Regulus', label: 'star' }, { name: 'Pollux', label: 'star' }, { name: 'tau Cet', label: 'star' },
  { name: 'M 104', label: 'galaxy' }, { name: 'M 51', label: 'galaxy' }, { name: 'M 81', label: 'galaxy' },
  { name: 'M 82', label: 'galaxy' }, { name: 'M 64', label: 'galaxy' }, { name: 'M 77', label: 'galaxy' },
  { name: 'NGC 5128', label: 'galaxy' }, { name: 'NGC 891', label: 'galaxy' }, { name: 'NGC 2997', label: 'galaxy' },
];

function stretch8bit(lin: Float64Array): number[] {
  const finite = [...lin].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (finite.length === 0) return [...lin].map(() => -1);
  const black = finite[Math.floor(0.25 * (finite.length - 1))]!;
  const white = finite[finite.length - 1]!;
  const denom = Math.asinh(10);
  const span = white - black || 1;
  return [...lin].map((v) => {
    if (!Number.isFinite(v)) return -1;
    const x = Math.min(1, Math.max(0, (v - black) / span));
    return Math.round((Math.asinh(10 * x) / denom) * 255);
  });
}

async function fetchStretched(object: string, fovDeg: number, px = 64): Promise<number[]> {
  const url = `https://alasky.cds.unistra.fr/hips-image-services/hips2fits?hips=CDS%2FP%2FDSS2%2Fred&object=${encodeURIComponent(object)}&fov=${fovDeg}&width=${px}&height=${px}&projection=TAN&format=fits`;
  const buf = await (await fetch(url)).arrayBuffer();
  return stretch8bit(readFits(buf).data);
}

async function main(): Promise<void> {
  const samples: unknown[] = [];
  const px = 64;
  for (const obj of OBJECTS) {
    for (const fovDeg of [0.03, 0.05]) {
      const pixels = await fetchStretched(obj.name, fovDeg, px);
      const pixelScaleArcsec = (fovDeg * 3600) / px;
      samples.push({ name: obj.name, label: obj.label, fovDeg, pixelScaleArcsec, psfFwhmArcsec: 2.5 * pixelScaleArcsec, width: px, height: px, pixels });
    }
    console.log('OK', obj.name, '->', obj.label);
  }
  const fixture = {
    _comment: 'INDEPENDENT validation holdout (TODO 147) - fresh textbook objects NOT in objectClassifier-holdout.json; same DSS2-red + asinh a=10 recipe (feature-verified against a committed sample). Bright stars (Sirius/Vega - hard saturated-halo case) + irregular/edge-on galaxies (M82/NGC 891/Cen A - galaxy stress case) stress both classes. Names resolved by hips2fits (Sesame); labels curated ground truth for these unambiguous objects. Built by scripts/build-holdout-val.mts.',
    survey: 'CDS/P/DSS2/red', stretch: 'asinh a=10, black=25pct, white=max, 8bit',
    samples,
  };
  writeFileSync('tests/fixtures/objectClassifier-holdout-val.json', JSON.stringify(fixture));
  const stars = samples.filter((s) => (s as { label: string }).label === 'star').length;
  console.log(`\nWROTE ${samples.length} samples (${stars} star / ${samples.length - stars} galaxy)`);
}

void main();
