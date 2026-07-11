# Rubin RSP & IVOA API Usage — Reference & Scaling Review

_Reference doc for the rubin-browser HiPS viewer. Reviews the Rubin Science
Platform (RSP) and IVOA data-access APIs this app uses, their documented limits /
quotas / fair-use rules, how the current code complies, and what should change as
data volume grows (DP1 is tiny; ComCam/DR1+ and the alert stream are orders of
magnitude larger)._

> **Sourcing discipline.** Every quantitative claim below cites a URL. Many hard
> numbers are **not in user-facing docs** — they live in the deployed service
> source (`lsst-sqre/lsst-tap-service`, `vo-cutouts`, `datalinker`) and the
> production Phalanx config (`gafaelfawr/values-idfprod.yaml` = `data.lsst.cloud`,
> the DAC that serves DP1). Those are primary but implementation-level: subject to
> change and **not a user contract**. Where a number is undocumented, this doc
> says "not documented" rather than inventing one. DP1-era reality is
> distinguished from projected DR-scale.

---

## Scaling roadmap — the 5 changes that matter most

Ranked by impact as observation volume grows. File/function pointers are in the
per-API sections.

1. **Handle HTTP 429 + `Retry-After` (and 503) with bounded backoff on every
   fetch path.** Today there is **zero** rate-limit handling anywhere
   (`tap.query`, `hips.fetchTile`, `soda.fetchCutout`, the tile fetches in
   `ImageViewer.svelte`). The RSP rate-limits per user per service in a fixed
   15-min window and returns 429 + `Retry-After`
   ([SQR-073](https://sqr-073.lsst.io/)). The **tightest live quota is
   vo-cutouts = 35 requests / 15 min**
   ([values-idfprod.yaml](https://github.com/lsst-sqre/phalanx/blob/main/applications/gafaelfawr/values-idfprod.yaml)) —
   a handful of postage stamps in quick succession will 429, and the app
   currently surfaces that as a hard error. This is the single highest-value fix
   and it already bites at DP1 scale, not just DR-scale.

2. **Route table-returning TAP queries through async UWS, not sync.** Rubin's
   documented guidance is "use async whenever returning table data; sync only for
   schema/metadata/small results"
   ([dp1 adql_queries](https://dp1.lsst.io/products/adql_queries.html),
   [DP0.2 TAP intro](https://dp0-2.lsst.io/_static/nb_html/DP02_02a_Introduction_to_TAP.html)).
   The app runs **everything through sync `query()`** (DIA 20k rows, light curves
   10k rows). Sync advertises a 600 s hard `executionDuration`
   ([capabilities.xml](https://github.com/lsst-sqre/lsst-tap-service/blob/main/src/main/webapp/capabilities.xml));
   `queryAsync()` already exists in `tap.ts` but **no caller uses it**.

3. **Fix the ForcedSource / light-curve access pattern.** Rubin explicitly says
   ForcedSource / ForcedSourceOnDiaObject must be queried **by `objectId` /
   `diaObjectId`, not by coordinates** — first cone-search Object/DiaObject, then
   join on the ID
   ([dp1 adql_queries](https://dp1.lsst.io/products/adql_queries.html)).
   `lightcurve.ts` does `CONTAINS(POINT('ICRS', fs.coord_ra, fs.coord_dec) …)`
   directly on ForcedSource — the exact anti-pattern. ForcedSource is projected
   to ~30 trillion forced-photometry measurements by DR11
   ([key numbers](https://rubinobservatory.org/for-scientists/rubin-101/key-numbers)),
   so a coordinate scan there does not survive DR-scale.

4. **Rethink DIA at scale, and drop the `ORDER BY` on the cone.** For DP1, TAP
   cone-search on `dp1.DiaSource` is the *recommended* access method and is fine
   (3.09 M rows —
   [dia_source](https://dp1.lsst.io/products/catalogs/dia_source.html)). But
   `diaSource.ts` emits `SELECT TOP 20000 … ORDER BY mjd`, and Rubin warns that
   `ORDER BY` + `TOP` is "dangerous" (it sorts the full matched set before
   truncating) ([adql_queries](https://dp1.lsst.io/products/adql_queries.html)).
   At DR-scale (DIA tables reach tens of billions of rows —
   [community](https://community.lsst.org/t/can-apdb-migration-be-parallelized-for-tables-with-tens-of-billions-of-rows/11540))
   a wide cone melts. High-volume, **real-time** time-domain science is not a TAP
   pattern at all: ~10 M alerts/night go through community brokers, not user
   subscription or high-rate TAP polling
   ([DMTN-093](https://dmtn-093.lsst.io/),
   [brokers](https://rubinobservatory.org/for-scientists/data-products/alerts-and-brokers)).

5. **Cheap efficiency wins that also spend fewer quota units:** use the HiPS
   `Allsky` preview instead of fetching 48 individual order-1 backdrop tiles
   ([IVOA HiPS 1.0](https://www.ivoa.net/documents/HiPS/)); keep explicit-column
   SELECTs everywhere (the dead `buildConeSearch` `SELECT *` should not be
   revived); and if the proper DataLink round-trip is ever added, honor its
   `Cache-Control: max-age=3600`
   ([datalinker config](https://github.com/lsst-sqre/datalinker/blob/main/src/datalinker/config.py)).

---

## Live per-user rate limits (the numbers to design against)

All enforced by Gafaelfawr at the ingress `/ingress/auth` route in a **fixed
15-minute window**, **per user, per service**. Over-limit → **HTTP 429** with a
**`Retry-After`** header plus `X-RateLimit-Limit / -Remaining / -Used /
-Resource / -Reset` on all responses. Retries are the client's responsibility;
honor `Retry-After`. No backoff algorithm (jitter/exponential) is mandated.
Source: [SQR-073](https://sqr-073.lsst.io/).

| Service | Live quota (idfprod, per 15 min) | SQR-073 design example |
|---|---|---|
| TAP | **1000** | 500 |
| HiPS | **1000** | 2000 |
| vo-cutouts (SODA) | **35** ← tightest | 100 |
| SIA | 70 | — |
| herald | 250 | — |
| Notebook | cpu 4.0, memory 32 GiB | — |

Live values: [gafaelfawr/values-idfprod.yaml](https://github.com/lsst-sqre/phalanx/blob/main/applications/gafaelfawr/values-idfprod.yaml).
Per-user TAP **concurrency** cap: **12 concurrent Qserv queries**
(`tap.qserv.concurrent: 12`, same file). All requests to a service "count the
same" today; query-cost-based quotas are a documented future addition, not yet
implemented ([SQR-073](https://sqr-073.lsst.io/)).

**Acceptable Use:** access is for scientific work; it can be revoked for resource
misuse or interfering with other users
([terms](https://data.lsst.cloud/terms)). There is **no** documented requirement
to set a specific `User-Agent` and **no** mandated client-side caching policy —
treat "cache, back off politely, identify yourself" as good practice, not a Rubin
rule. The concrete obligations are: stay under the 15-min quotas and honor
`Retry-After` on 429.

---

## 1. TAP (Table Access Protocol)

Endpoint: `https://data.lsst.cloud/api/tap` (sync `/sync`, async `/async`). DP1
catalogs live in the `dp1` **schema** (ADQL), not a URL path. Scope: `read:tap`
([rsp api](https://rsp.lsst.io/guides/api/index.html)).

### (a) Documented limits / recommendations

- **Sync vs async:** categorical, not numeric — async for any table data, sync
  only for schema / small results
  ([dp1 adql_queries](https://dp1.lsst.io/products/adql_queries.html),
  [DP0.2 intro](https://dp0-2.lsst.io/_static/nb_html/DP02_02a_Introduction_to_TAP.html)).
- **Sync wall-clock timeout: not documented.** A forum guess of 30 min was never
  confirmed ([community](https://community.lsst.org/t/tap-row-limits-andsync-query-timeout/9572)).
  The service advertises UWS `executionDuration` **600 s default+hard**
  ([capabilities.xml](https://github.com/lsst-sqre/lsst-tap-service/blob/main/src/main/webapp/capabilities.xml)),
  though [SQR-094](https://sqr-094.lsst.io/) shows a 14400 s (4 h) sample, so
  enforcement on long async Qserv jobs is unclear.
- **MAXREC:** no user-doc number. Code default = max = **100,000,000 rows**
  ([MaxRecValidatorImpl.java](https://github.com/lsst-sqre/lsst-tap-service/blob/main/src/main/java/org/opencadc/tap/impl/MaxRecValidatorImpl.java)).
  Async **output byte cap = 3 GB** (`outputLimit: 3221225472` in
  [Phalanx tap values](https://github.com/lsst-sqre/phalanx/blob/main/applications/tap/values.yaml)).
  TAP_UPLOAD cap = **32 MB**. Community staff guidance (not spec): practical
  trouble above ~2 GB output / ~5 GB internal, "limit of 5 million" rows
  ([community](https://community.lsst.org/t/tap-row-limits-andsync-query-timeout/9572)).
- **ADQL best practices** ([dp1 adql_queries](https://dp1.lsst.io/products/adql_queries.html)):
  - Avoid `SELECT *` — name columns (Object has 1000+ columns).
  - Spatial cuts via `CONTAINS(POINT, CIRCLE/POLYGON)`; **do not** use
    `ra < value` / `BETWEEN`. (q3c / scisql / HTM / MOC are **not** documented as
    user ADQL — they are backend Qserv sharding.)
  - `ORDER BY` + `TOP`/`MAXREC` is dangerous (sorts full match set first).
  - ForcedSource / ForcedSourceOnDiaObject: query by `objectId`/`diaObjectId`,
    not coordinates; select Object/DiaObject spatially first, then join.
  - Prefer `TOP` over `MAXREC` (portable, maps to back-end `SELECT TOP`).
  - Paging / `OFFSET`: **not documented** (ADQL has no standard OFFSET).
- **Concurrency:** 12 concurrent Qserv queries per user (above).
- **429 / backoff:** honor `Retry-After`; no algorithm mandated. 503 is generic
  unavailability, not the documented rate-limit signal (429 is).
- **Async job/result retention: 7 days** (`retentionPeriod` 604800 s,
  [capabilities.xml](https://github.com/lsst-sqre/lsst-tap-service/blob/main/src/main/webapp/capabilities.xml),
  [SQR-094](https://sqr-094.lsst.io/)). Poll interval: **not documented**.

### (b) Current code compliance (`src/api/tap.ts`, callers)

| Item | Status |
|---|---|
| Endpoint / schema (`/api/tap/sync`, `dp1.*`) | ✅ Correct |
| Sync vs async | ⚠️ **All live callers use sync `query()`**; `queryAsync()` exists but is **dead code** (only referenced in `tap.ts` + its test) |
| MAXREC | `query()` sends `MAXREC=10000`; callers pass 10k (light curve), 20k (DIA), 100 (obscore). ⚠️ `queryAsync` sends `MAXREC=0` (unlimited) |
| `SELECT *` | ✅ live clients (`obscore`, `lightcurve`, `diaSource`) name columns. ✅ the dead `buildConeSearch()` `SELECT TOP N *` has been **DELETED** from `tap.ts` (was unused — only self-referenced + its test), so the anti-pattern can't be revived |
| Spatial predicate | ✅ `CONTAINS(POINT, CIRCLE)` everywhere |
| `ORDER BY` + `TOP` | ✅ **FIXED** — the `ORDER BY mjd` has been dropped from both `diaSource.buildDiaSourceAdql` and `lightcurve.buildLightCurveAdql`. Light curves are sorted client-side in `parseLightCurveResult`; the DIA `AlertSet` is consumed order-independently (min/max scan + per-index predicates) so needs no sort |
| ForcedSource by objectId | ✅ **FIXED** — `lightcurve.buildLightCurveAdql` now cone-searches `dp1.Object` (`coord_ra`/`coord_dec`) / `dp1.DiaObject` (`ra`/`dec`) spatially, then JOINs `ForcedSource`/`ForcedSourceOnDiaObject` on `objectId`/`diaObjectId`; the `dp1.Visit` join still supplies the MJD. No coordinate scan on the forced table |
| 429 / `Retry-After` / backoff | ❌ **None.** `query()` only checks `resp.ok`, throws on any non-2xx |
| Async polling | `queryAsync` polls `/phase` every 2 s, 300 s timeout, no 429 handling (dead code) |

### (c) Recommendations (prioritized)

1. **Add 429/503 handling + bounded retry to `query()`** (`tap.ts`): on 429, read
   `Retry-After`, wait, retry a small number of times; surface a friendly
   "rate-limited, retrying" instead of a hard throw. (Roadmap #1.)
2. **Wire `queryAsync()` into the large-result callers** (`diaSource`,
   `lightcurve`) or add size-based routing, so table queries use async UWS.
   Give `queryAsync` a real `MAXREC` (not 0) and 429 handling. (Roadmap #2.)
3. ✅ **DONE — `lightcurve.buildLightCurveAdql`** now selects the object spatially
   in `dp1.Object`/`dp1.DiaObject` then joins ForcedSource on the ID. (Roadmap #3.)
4. ✅ **DONE — dropped `ORDER BY mjd`** from `diaSource`/`lightcurve` ADQL; light
   curves sort client-side in `parseLightCurveResult`. `parseDiaSources` needs no
   sort — every `AlertSet` consumer (`alertTimeRange`, `timeWindowPredicate`,
   `alertsInWindow`) is order-independent. (Roadmap #4.)
5. ✅ **DONE — deleted the dead `buildConeSearch` `SELECT *`** (and its test) so it
   can't regress.

---

## 2. HiPS tiles

Base: `https://data.lsst.cloud/api/hips/v2/dp1/…`; list at `/api/hips/v2/dp1/list`
([data.lsst.cloud](https://data.lsst.cloud/api-aspect),
[DMTN-230](https://dmtn-230.lsst.io/)). Scope: `read:image`
([DMTN-235](https://dmtn-235.lsst.io/)).

### (a) Documented limits / recommendations

- **Authenticated** — a bare fetch of `/api/hips/v2/list` returns **401**; DP1
  HiPS requires a bearer token ([DMTN-230](https://dmtn-230.lsst.io/)).
- **Caching:** served by "crawlspace" from GCS with `Cache-Control` allowing
  client caching **up to 1 hour** (DP0.2 value, "deliberately short for testing,"
  [DMTN-230](https://dmtn-230.lsst.io/)).
- **Client tile-fetch concurrency / throttling: not documented.** Only the
  service-wide **HiPS quota of 1000 req / 15 min** applies (≈1.1/s sustained;
  live idfprod value).
- **Standard client behavior** ([IVOA HiPS 1.0](https://www.ivoa.net/documents/HiPS/)):
  default `hips_tile_width` = 512 px; tile dirs `Norder3…hips_order`; read
  `hips_order`/`hips_tile_format`/`hips_frame` from `properties`; select the
  Norder whose tile resolution matches the display scale; **use the low-order
  `Allsky` preview file** (packs all tiles of that order into one image) for the
  zoomed-out view instead of many individual tiles.
- **DP1 max Norder: not documented** (behind auth, in `properties`).

### (b) Current code compliance (`src/api/hips.ts`, `ImageViewer.svelte`)

- ✅ Correct DP1 base path; reads `properties`; token attached via `getAuthHeader`.
- ✅ **`MAX_CONCURRENT_FETCHES = 6`** with a queue on the authenticated fetch
  path (`ImageViewer.svelte` ~L1321). This is **reasonable** — there is no
  documented HiPS concurrency limit, and 6 mirrors the browser's own per-host
  `<img>` cap. It is conservative for burst and well under the 1000/15min quota
  for normal panning. Not the bottleneck; the missing 429 handling is.
- ⚠️ **Allsky backdrop fetches 48 individual order-1 tiles** (`prefetchAllsky`,
  `ALLSKY_ORDER = 1` → 48 tiles) on every base change, rather than the single
  HiPS `Allsky` preview file. 48 requests × each quota unit, repeated per base.
- ❌ **No 429/`Retry-After`/backoff** on `hips.fetchTile` or the tile fetches; a
  429 during a fast pan is treated as a normal failure (can trip auto-fallback).
- ⚠️ No use of the 1-hour `Cache-Control` beyond the browser's default HTTP cache
  (the in-memory `tileCache` is separate and fine).

### (c) Recommendations

1. Add 429 handling to the tile fetch path so a rate-limit during panning backs
   off instead of counting as a tile failure / fallback trigger. (Roadmap #1.)
2. Use the standard `Allsky` preview for the backdrop instead of 48 tiles, or at
   least fetch it once and cache. (Roadmap #5.)
3. Keep `MAX_CONCURRENT_FETCHES = 6` — it is appropriate; document that the real
   limit is the 1000/15min quota, not concurrency.

---

## 3. Image cutouts — SODA / vo-cutouts

Service: `https://data.lsst.cloud/api/cutout`
([lsst-sqre/vo-cutouts](https://github.com/lsst-sqre/vo-cutouts),
[DMTN-208](https://dmtn-208.lsst.io/)). Scope: `read:image`.

### (a) Documented limits / recommendations

- **UWS/async at the core.** Sync is a wrapper that creates an async job, waits,
  and redirects to the result ([DMTN-208](https://dmtn-208.lsst.io/)).
- Configured timeouts ([Phalanx vo-cutouts values](https://phalanx.lsst.io/applications/vo-cutouts/values.html)):
  **sync 1 min**; **async job 600 s (10 min)**; worker grace 60 s; **result
  lifetime 30 days** (GCS); 2 cutout worker replicas.
- **Size caps / per-user quotas / concurrent-job caps: not implemented / not
  documented.** DMTN-208 states the initial service supports neither quotas nor
  throttling (deferred to the SQR-073 framework); no pixel/area cap. Effective
  concurrency is bounded only by 2 worker replicas.
- **Expected latency: not quantified** — vo-cutouts sets the UWS duration quote to
  `xsi:nil` ([DMTN-208](https://dmtn-208.lsst.io/)).
- **Batch: no native batch.** One `ID` + one stencil per job; bulk is deferred.
  "Batch" = client-side fan-out of async jobs.
- **Parameters** ([DMTN-208](https://dmtn-208.lsst.io/),
  [IVOA SODA 1.0](https://www.ivoa.net/documents/SODA/20170517/REC-SODA-1.0.html)):
  Rubin implements **`CIRCLE`** (`lon lat radius`) and **`POLYGON`** (≥3 CCW
  vertex pairs), decimal **degrees, ICRS**. **`POS=RANGE` is NOT implemented.**
  Output is **FITS only** (JPEG deferred).
- **The live per-user quota is `vo-cutouts: 35 / 15 min`** (idfprod) — the
  tightest of all RSP services.

### (b) Current code compliance (`src/api/soda.ts`)

- ✅ Correct base `/api/cutout`, `CIRCLE lon lat radius` in ICRS degrees, `ID` from
  DataLink discovery, `read:image` gating before any network call, FITS bytes.
- ⚠️ **Assumes a plain sync endpoint `/api/cutout/sync` that returns bytes
  directly.** vo-cutouts sync is real, but is a wrapper with a **1-min timeout**
  that redirects to the result (browser `fetch` follows the redirect
  automatically, so this works for a single small stamp). Large/slow cutouts can
  hit the 1-min sync cap and fail with no async fallback.
- ❌ **No 429/`Retry-After`/backoff.** With a 35/15min quota this is the highest
  real-world risk: a few stamps in a row 429, and `fetchCutout` throws a hard
  "Cutout request failed (429)".
- ✅ Honest 401/403/404/empty-body error handling.

### (c) Recommendations

1. **Add 429 handling to `fetchCutout`** (respect `Retry-After`; the 35/15min
   quota makes this the most likely limit to hit). (Roadmap #1.)
2. For larger cutouts, consider the async job path (submit → poll `/jobs/{id}` →
   fetch result) instead of sync, to escape the 1-min sync timeout.
3. Any multi-stamp feature must **serialize / throttle** requests (client-side
   fan-out), never burst — 35/15min is ~1 per 26 s sustained.

---

## 4. DataLink (datalinker)

Service: `https://data.lsst.cloud/api/datalink` (a.k.a. `/api/datalinker/links`)
([DMTN-238](https://dmtn-238.lsst.io/),
[lsst-sqre/datalinker](https://github.com/lsst-sqre/datalinker)). Scope:
`read:image`.

### (a) Documented flow / caching

1. Query `ivoa.ObsCore`; each image row's `access_url` =
   `…/api/datalink/links?ID=<butler-id>`, `access_format =
   application/x-votable+xml;content=datalink`.
2. GET that URL → DataLink `{links}` VOTable (IVOA DataLink 1.1).
3. In the links, find the `cutout-sync` SODA service descriptor (and direct file
   links, which datalinker returns as **GCS signed URLs valid 1 hour**).
4. Call SODA with `CIRCLE`/`POLYGON` + `ID`.

Caching: datalinker sets **`Cache-Control: max-age=<links_lifetime>`**, default
**1 hour** (`links_lifetime = timedelta(hours=1)`, i.e. `max-age=3600`), matched
to the 1-hour signed-URL expiry
([config.py](https://github.com/lsst-sqre/datalinker/blob/main/src/datalinker/config.py),
[external.py](https://github.com/lsst-sqre/datalinker/blob/main/src/datalinker/handlers/external.py)).
Best practice: cache the **service descriptor / SODA base URL** aggressively
(stable); **do not** reuse the signed **data** URLs past ~1 h. datalinker applies
a lower rate limit than Butler; exact number **not documented**
([DMTN-238](https://dmtn-238.lsst.io/)).

### (b) Current code compliance (`src/api/obscore.ts`)

- The app **shortcuts DataLink entirely**: `extractCutoutId` regex-parses the `ID`
  out of the ObsCore `access_url` and hands it straight to SODA, never fetching
  the DataLink VOTable. This **avoids a round-trip** (efficient, and dodges the
  datalinker quota) at the cost of hard-coding the assumption that SODA consumes
  the same `ID` — an assumption the code documents explicitly.
- Consequence: there is **no DataLink response to cache** today, so the 1-hour
  TTL guidance is currently moot (a plus, not a gap).

### (c) Recommendations

- Keep the shortcut while the cutout endpoint is stable (it is the leaner path).
- **If** the proper DataLink round-trip is ever added (e.g. to survive an endpoint
  move), cache the links response for its `max-age=3600` and never re-derive the
  `ID` more than once per hour. (Roadmap #5.)

---

## 5. DIA / alerts at scale

### (a) Documented reality

- **DP1 tables (TAP is the recommended access service):**
  `dp1.DiaSource` = **3,086,404 rows, 87 columns**
  ([dia_source](https://dp1.lsst.io/products/catalogs/dia_source.html));
  `dp1.DiaObject` = **1,089,818 rows, 137 columns**
  ([201-4](https://dp1.lsst.io/tutorials/notebook/201/notebook-201-4.html)).
- **Full-survey alert stream** ([DMTN-093](https://dmtn-093.lsst.io/),
  [key numbers](https://rubinobservatory.org/for-scientists/rubin-101/key-numbers),
  [brokers](https://rubinobservatory.org/for-scientists/data-products/alerts-and-brokers)):
  **~10 M alerts/night**, ~10 k/visit, **60 s** real-time latency, ~700
  visits/night, ~10 TB/night raw; each alert ≈ 82 KB → ≈ 782 GB/night of alert
  data (82 KB/782 GB trace to [DMTN-102](https://dmtn-102.lsst.io/) via summary +
  press, verify in PDF if load-bearing).
- **Individual users do NOT subscribe to the full stream** — it goes to **7
  community brokers** (ALeRCE, AMPEL, ANTARES, Babamul, Fink, Lasair,
  Pitt-Google) ([DMTN-093](https://dmtn-093.lsst.io/)). Alerts are **Avro over
  Kafka** with a Confluent Schema Registry ([DMTN-210](https://dmtn-210.lsst.io/))
  — not a browser-appropriate protocol.
- **DR-scale DIA row counts: not published** (deferred to the DPDD / LSE-163).
  Operationally the APDB DIA tables reach "tens of billions of rows"
  ([community](https://community.lsst.org/t/can-apdb-migration-be-parallelized-for-tables-with-tens-of-billions-of-rows/11540)).
- There is a dedicated **`read:alertdb`** scope for pulling **archived** alert
  packets/schemas from the RSP alert DB (distinct from live Kafka).

### (b) Current code compliance (`src/api/diaSource.ts`)

- ✅ Correct table (`dp1.DiaSource`), correct columns (`ra`/`dec`,
  `midpointMjdTai`, `psfFlux`, `band`), honest `Unknown` classification, spatial
  `CONTAINS`. Fine at DP1 scale.
- ✅ **FIXED** — the discouraged `ORDER BY`+`TOP` pattern is gone; the query is now
  `SELECT TOP 20000 …` with NO `ORDER BY` (the `AlertSet` is consumed order-independently).
- ⚠️ Sync `query()` for up to 20 k rows (should be async — Roadmap #2).
- ⚠️ Cone-search directly on DiaSource. Fine now (3 M rows); at DR-scale a wide
  radius over tens of billions of rows is a melt risk.

### (c) Recommendations

- **Keep TAP cone-search on DiaSource/DiaObject for archival/catalog overlays** —
  it is Rubin's recommended access. But: drop `ORDER BY`, cap radius, move to
  async, and at DR-scale prefer selecting `dp1.DiaObject` spatially then joining.
- **Do NOT** attempt real-time full-stream consumption in the browser (Kafka/Avro,
  ~10 M/night). Real-time time-domain belongs to a broker's API. If archival
  packets are ever needed, use `read:alertdb`. (Roadmap #4.)

---

## 6. Auth / tokens

### (a) Documented

- **Scopes** ([DMTN-235](https://dmtn-235.lsst.io/)): `read:tap` (TAP queries);
  `read:image` (**HiPS + SODA cutouts + `/api/datalinker/links` + Butler image
  retrieval** — one scope covers all image services this app uses);
  `read:alertdb` (alert archive); `exec:notebook`, `exec:portal` (aspects).
- **Token lifetime:** Gafaelfawr default **30 days** (`config.tokenLifetime`,
  deployment-configurable; [helm](https://gafaelfawr.lsst.io/user-guide/helm.html)).
  User tokens choose name/scopes/expiry in the RSP UI.
- **Transport:** Gafaelfawr accepts `Authorization: Bearer <token>` (and cookie).
  Note VO clients (pyvo) authenticate to the **TAP** endpoint via **HTTP Basic**
  (`x-oauth-basic` : token, IVOA `#BasicAA`) —
  [DP0.2 api-intro](https://dp0-2.lsst.io/data-access-analysis-tools/api-intro.html);
  the Gafaelfawr-native `Bearer` header also works through the ingress.
- **Rate limits are tied to the token's user** (§ live quotas above).

### (b) Current code compliance (`src/api/auth.ts`)

- ✅ Token in `sessionStorage` by default, opt-in `localStorage`; `Bearer` header
  via `getAuthHeader`; identity validated against Gafaelfawr
  `/auth/api/v1/user-info` (200 = valid, independent of data rights).
- ✅ **FIXED** — `parseTokenExpiry` no longer assumes a JWT. An opaque Gafaelfawr
  `gt-…` token is now detected explicitly (`isOpaqueRspToken`) and its expiry is
  honestly reported as `null` (unknown) — never fabricated from `atob`-ing a random
  handle. Only a genuinely JWT-shaped token (3 dot-separated segments) is decoded.
  A new `getTokenExpiry()` exposes the value, and a `gt-…` token is still treated as
  present/valid-shaped (stored, authenticated, `Bearer` header) until a real 401.
- ⚠️ No scope pre-check (identity only). Fine — 401/403 per-service handling covers
  a missing scope.

### (c) Recommendations

- ✅ **DONE** — the token is now treated as opaque (`isOpaqueRspToken`); no reliance
  on JWT-parsed expiry (`getTokenExpiry()` is `null` for `gt-…`). Optionally, expiry
  could still be read from the `/auth/api/v1/user-info` / token-info response.
- No change needed to the `Bearer` transport for these REST services.

---

## 7. Public services (context)

- **Gaia** (`gaia.ts`): the **public ESA** TAP
  (`https://gea.esac.esa.int/tap-server/tap/sync`), anonymous, **not** the RSP —
  correctly kept separate, no RSP token sent. Subject to ESA's own limits, out of
  scope for RSP quotas.
- Public CDS/DSS HiPS tiles: the code correctly withholds the RSP `Bearer` token
  from non-Rubin hosts (a credentialed cross-origin request would trip a CORS
  preflight the public host rejects) — see the `useAuth = !!rspToken &&
  batchIsRubin` guard in `ImageViewer.svelte`.

---

## Proposed TODO items (candidate backlog — assign IDs in TODO.md separately)

1. Add 429/503 + `Retry-After` bounded-backoff handling to a shared fetch helper
   used by `tap.query`, `hips.fetchTile`, `soda.fetchCutout`, and the
   `ImageViewer` tile fetches. _(Highest priority; bites at DP1 scale.)_
2. Route table-returning TAP queries (DIA, light curve) through async UWS; wire
   the existing `queryAsync()` in (or add size-based routing) and give it a real
   `MAXREC` + 429 handling.
3. ✅ **DONE** — `lightcurve.buildLightCurveAdql` selects the object in
   `dp1.Object`/`dp1.DiaObject` spatially, then joins ForcedSource by
   `objectId`/`diaObjectId` (Rubin's required pattern for the largest tables).
4. ✅ **DONE** — dropped `ORDER BY mjd` from `diaSource`/`lightcurve` ADQL; light
   curves sort client-side. `parseDiaSources` needs no sort (order-independent).
5. Replace the 48-tile order-1 allsky backdrop with the HiPS `Allsky` preview
   file (fewer requests, fewer quota units).
6. Add an async-cutout fallback in `soda.ts` for cutouts that exceed the 1-min
   sync timeout; throttle any multi-stamp feature to the 35/15min budget.
7. ✅ **DONE** — `auth.ts` no longer treats the RSP token as a JWT; opaque `gt-…`
   tokens report `null` (unknown) expiry via `getTokenExpiry()` instead of `atob`.
8. ✅ **DONE** — deleted the dead `buildConeSearch` `SELECT *` (and its test) from
   `tap.ts` so the anti-pattern can't be revived.
9. Surface a user-visible "rate-limited, retrying…" status (from
   `X-RateLimit-Remaining` / `Retry-After`) instead of a hard error.

---

_Last reviewed: 2026-07-10. Primary sources are linked inline; where a number was
only in deployed service source or Phalanx config (not user docs), that is noted
at the point of use._
