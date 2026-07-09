import { describe, it, expect } from 'vitest';
import {
  generateSyntheticAlerts,
  buildAlertIndex,
  queryViewport,
  allTypesMask,
  typeVisible,
  AlertType,
  ALERT_TYPE_COUNT,
} from '../../src/data/alerts.js';

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
