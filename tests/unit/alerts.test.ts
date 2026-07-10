import { describe, it, expect } from 'vitest';
import {
  generateSyntheticAlerts,
  buildAlertIndex,
  queryViewport,
  allTypesMask,
  typeVisible,
  nearestAlert,
  alertTimeRange,
  alertsInWindow,
  timeWindowPredicate,
  AlertType,
  ALERT_TYPE_COUNT,
  type AlertSet,
} from '../../src/data/alerts.js';
import { angularSeparation } from '../../src/utils/skyGeom.js';

/** Brute-force nearest VISIBLE alert within a radius — ground-truth reference. */
function bruteNearest(
  a: AlertSet,
  ra: number,
  dec: number,
  maxRadiusDeg: number,
  typeMask = allTypesMask()
): { index: number; sep: number } | null {
  let bi = -1;
  let bs = Infinity;
  for (let i = 0; i < a.count; i++) {
    if (!typeVisible(typeMask, a.type[i]!)) continue;
    const s = angularSeparation(ra, dec, a.ra[i]!, a.dec[i]!);
    if (s < bs) {
      bs = s;
      bi = i;
    }
  }
  return bi >= 0 && bs <= maxRadiusDeg ? { index: bi, sep: bs } : null;
}

describe('generateSyntheticAlerts', () => {
  it('produces exactly `count` events with valid, finite coordinates', () => {
    const a = generateSyntheticAlerts(5000, 42);
    expect(a.count).toBe(5000);
    expect(a.ra.length).toBe(5000);
    for (let i = 0; i < a.count; i++) {
      expect(a.ra[i]).toBeGreaterThanOrEqual(0);
      expect(a.ra[i]).toBeLessThan(360);
      expect(a.dec[i]).toBeGreaterThanOrEqual(-90);
      expect(a.dec[i]).toBeLessThanOrEqual(90);
      expect(a.type[i]).toBeLessThan(ALERT_TYPE_COUNT);
      expect(Number.isFinite(a.mag[i]!)).toBe(true);
    }
  });

  it('is deterministic for a given seed and differs across seeds', () => {
    const a = generateSyntheticAlerts(2000, 7);
    const b = generateSyntheticAlerts(2000, 7);
    const c = generateSyntheticAlerts(2000, 8);
    expect(Array.from(a.ra)).toEqual(Array.from(b.ra));
    expect(Array.from(a.dec)).toEqual(Array.from(b.dec));
    expect(Array.from(a.ra)).not.toEqual(Array.from(c.ra));
  });

  it('scales to large volumes quickly', () => {
    const a = generateSyntheticAlerts(500000, 1);
    expect(a.count).toBe(500000);
  });
});

describe('buildAlertIndex + queryViewport', () => {
  it('a viewport query returns exactly the events inside the bounds', () => {
    const a = generateSyntheticAlerts(20000, 3);
    const index = buildAlertIndex(a);
    const [raMin, raMax, decMin, decMax] = [100, 140, 10, 40];

    const got = new Set<number>();
    queryViewport(index, a, raMin, raMax, decMin, decMax, (i) => got.add(i));

    // Brute-force reference.
    const expected = new Set<number>();
    for (let i = 0; i < a.count; i++) {
      if (a.ra[i]! >= raMin && a.ra[i]! <= raMax && a.dec[i]! >= decMin && a.dec[i]! <= decMax) {
        expected.add(i);
      }
    }
    expect(got).toEqual(expected);
    expect(got.size).toBeGreaterThan(0);
  });

  it('handles RA wrap-around (raMin > raMax straddling 0/360)', () => {
    const a = generateSyntheticAlerts(20000, 9);
    const index = buildAlertIndex(a);
    const [raMin, raMax, decMin, decMax] = [350, 10, -20, 20]; // wraps through 0

    const got = new Set<number>();
    queryViewport(index, a, raMin, raMax, decMin, decMax, (i) => got.add(i));

    const expected = new Set<number>();
    for (let i = 0; i < a.count; i++) {
      const inRa = a.ra[i]! >= raMin || a.ra[i]! <= raMax;
      const inDec = a.dec[i]! >= decMin && a.dec[i]! <= decMax;
      if (inRa && inDec) expected.add(i);
    }
    expect(got).toEqual(expected);
  });

  it('a small viewport visits far fewer events than the full set (culling works)', () => {
    const a = generateSyntheticAlerts(200000, 5);
    const index = buildAlertIndex(a);
    let visited = 0;
    queryViewport(index, a, 200, 205, 0, 5, () => visited++);
    // A 5°x5° window is ~1/1000 of the sphere — must not scan all 200k.
    expect(visited).toBeLessThan(a.count / 10);
  });
});

describe('type mask', () => {
  it('allTypesMask shows every type; a cleared bit hides its type', () => {
    const all = allTypesMask();
    for (let t = 0; t < ALERT_TYPE_COUNT; t++) expect(typeVisible(all, t)).toBe(true);
    const noAsteroids = all & ~(1 << AlertType.Asteroid);
    expect(typeVisible(noAsteroids, AlertType.Asteroid)).toBe(false);
    expect(typeVisible(noAsteroids, AlertType.Nova)).toBe(true);
  });
});

describe('nearestAlert (hit-testing)', () => {
  it('cursor exactly on a known event returns THAT event (index/type/time/id)', () => {
    const a = generateSyntheticAlerts(50000, 3);
    const index = buildAlertIndex(a);
    const i = 12345; // a known, specific event
    const hit = nearestAlert(index, a, a.ra[i]!, a.dec[i]!, 0.5);

    expect(hit).not.toBeNull();
    // Sitting on the event, separation is ~0 and it is the unique global minimum.
    expect(hit!.separationDeg).toBeLessThan(1e-6);
    expect(hit!.index).toBe(i);
    expect(hit!.type).toBe(a.type[i]);
    expect(hit!.timeMjd).toBe(a.time[i]);
    expect(hit!.id).toBe(a.id[i]);
    // A "return the first event" impl would return index 0 with a large sep.
    expect(hit!.index).not.toBe(0);
  });

  it('matches a brute-force nearest search for arbitrary cursors', () => {
    const a = generateSyntheticAlerts(40000, 11);
    const index = buildAlertIndex(a);
    const cursors: [number, number][] = [
      [37.5, -12.3],
      [210.1, 47.8],
      [0.4, 3.2], // near RA=0 wrap
      [359.6, -3.2], // other side of the wrap
      [123.0, 82.0], // high declination (cos(dec) small)
    ];
    for (const [ra, dec] of cursors) {
      const radius = 6;
      const hit = nearestAlert(index, a, ra, dec, radius);
      const truth = bruteNearest(a, ra, dec, radius);
      if (truth === null) {
        expect(hit).toBeNull();
      } else {
        expect(hit).not.toBeNull();
        expect(hit!.index).toBe(truth.index);
        expect(hit!.separationDeg).toBeCloseTo(truth.sep, 10);
      }
    }
  });

  it('returns null when nothing is within the radius (respects the radius)', () => {
    const a = generateSyntheticAlerts(20000, 17);
    const index = buildAlertIndex(a);
    const ra = 150.123;
    const dec = -22.456;
    const truth = bruteNearest(a, ra, dec, 90)!; // the true nearest anywhere
    expect(truth).not.toBeNull();

    // Radius strictly smaller than the true nearest → nothing qualifies.
    expect(nearestAlert(index, a, ra, dec, truth.sep * 0.5)).toBeNull();
    // Radius larger → the true nearest is found. Kills an "ignore radius" impl.
    const hit = nearestAlert(index, a, ra, dec, truth.sep * 1.5);
    expect(hit).not.toBeNull();
    expect(hit!.index).toBe(truth.index);
  });

  it('respects typeMask: an alert of a hidden type is never returned', () => {
    const a = generateSyntheticAlerts(50000, 23);
    const index = buildAlertIndex(a);
    const i = 9876;
    const tiny = 0.001; // radius so small only event i is in range

    // Control: with all types visible, sitting on event i returns it.
    const shown = nearestAlert(index, a, a.ra[i]!, a.dec[i]!, tiny, allTypesMask());
    expect(shown).not.toBeNull();
    expect(shown!.index).toBe(i);

    // Hide event i's type → it must not come back.
    const hideItsType = allTypesMask() & ~(1 << a.type[i]!);
    expect(nearestAlert(index, a, a.ra[i]!, a.dec[i]!, tiny, hideItsType)).toBeNull();

    // With a wider radius, any returned hit must be of a visible type.
    const other = nearestAlert(index, a, a.ra[i]!, a.dec[i]!, 8, hideItsType);
    if (other !== null) expect(typeVisible(hideItsType, other.type)).toBe(true);
  });

  it('separationDeg equals angularSeparation to the returned event', () => {
    const a = generateSyntheticAlerts(30000, 29);
    const index = buildAlertIndex(a);
    const ra = 88.2;
    const dec = 15.9;
    const hit = nearestAlert(index, a, ra, dec, 10);
    expect(hit).not.toBeNull();
    expect(hit!.separationDeg).toBeCloseTo(
      angularSeparation(ra, dec, hit!.ra, hit!.dec),
      10
    );
    expect(hit!.separationDeg).toBeGreaterThan(0); // cursor not on the event
  });
});

describe('time-window filtering', () => {
  it('alertTimeRange matches the brute-force min/max of the epochs', () => {
    const a = generateSyntheticAlerts(40000, 4);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < a.count; i++) {
      const v = a.time[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const [rlo, rhi] = alertTimeRange(a);
    expect(rlo).toBe(lo);
    expect(rhi).toBe(hi);
    expect(rhi).toBeGreaterThan(rlo);
  });

  it('alertsInWindow count matches a brute-force count over the window', () => {
    const a = generateSyntheticAlerts(50000, 6);
    const [lo, hi] = alertTimeRange(a);
    const tMin = lo + (hi - lo) * 0.3;
    const tMax = lo + (hi - lo) * 0.6;

    let brute = 0;
    for (let i = 0; i < a.count; i++) {
      const v = a.time[i]!;
      if (v >= tMin && v <= tMax) brute++;
    }

    const { count } = alertsInWindow(a, tMin, tMax);
    expect(count).toBe(brute);
    // A partial window must exclude some events (kills an all-pass filter).
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(a.count);
    // Full window includes everything.
    expect(alertsInWindow(a, lo, hi).count).toBe(a.count);
  });

  it('alertsInWindow mask agrees with the predicate and the count', () => {
    const a = generateSyntheticAlerts(10000, 8);
    const [lo, hi] = alertTimeRange(a);
    const tMin = lo + (hi - lo) * 0.25;
    const tMax = lo + (hi - lo) * 0.75;

    const { count, mask } = alertsInWindow(a, tMin, tMax, true);
    expect(mask).toBeInstanceOf(Uint8Array);
    const keep = timeWindowPredicate(a, tMin, tMax);
    let masked = 0;
    for (let i = 0; i < a.count; i++) {
      expect(mask![i] === 1).toBe(keep(i));
      if (mask![i] === 1) masked++;
    }
    expect(masked).toBe(count);
  });
});
