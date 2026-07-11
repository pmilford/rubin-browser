# PRD — Smart image-based object-type identification under the cursor

Status: **Phase 0 + Phase 1 SHIPPED** (see TODO 123). Phases 2–3 remain (below).
Owner: Rubin Browser. Measured results: REAL balanced acc 0.898 (calibration) /
0.841 (different-forward-model holdout); adversarial always-galaxy 0.500 & seeded
random 0.442 both provably below target. Original research + product spec follows.
Backlog item: #10 (`BACKLOG.md`). Supersedes nothing; extends the catalog-lookup
`identifyAt` path with an orthogonal **image-inferred** path.

> This document is a plan, not an implementation. Nothing here changes source.
> It exists so the design-review gate (root `CLAUDE.md`) and the testing mandate
> can be applied *before* any classifier code is written. The load-bearing
> section is §5 (Testing) — this is exactly the feature class where a placeholder
> ("always galaxy") passes naive tests, so accuracy is MEASURED against ground
> truth, never asserted.

---

## 1. Problem, goals, non-goals

### 1.1 Problem
Today's click-to-identify (`src/data/objects.ts::identifyAt` + `ObjectInfoPanel`)
is a **catalog lookup**: nearest bundled bright object by great-circle distance,
thresholded so empty sky honestly returns "nothing here". It is silent wherever
the bundled catalog is silent — i.e. across almost the entire faint sky that
Rubin actually resolves. We want the **inverse**: infer an object's class and
coarse physical properties **from the pixels under the cursor**, so identification
works where the catalog has nothing, and improves when multi-band colour is
available (Rubin per-band ugrizy via `RUBIN_DATASETS`, or public gri/DSS/PanSTARRS).

### 1.2 Goals
- Given a cursor sky position and the currently-displayed imagery, extract a small
  **cutout** around it, compute a set of **pure-function image features**, and emit:
  - a **coarse class** — star / galaxy / open cluster / globular cluster / nebula;
  - **subtype** where features support it — galaxy morphology (elliptical / spiral /
    irregular); cluster kind (open vs globular) + a crude age proxy; stellar
    temperature / spectral-type proxy from colour;
  - a **confidence** in [0,1] and the **explicit feature values** that drove it.
- Work on **luminance-only** input (morphology only) and do **better** on
  **multi-band colour** (adds colour indices → temperature, age, cluster-CMD).
- Be **honest**: label every result "inferred from image" vs "catalog", degrade
  confidence gracefully when bands/resolution are missing, and sample **honest
  pre-colormap pixels** (like `crossSection.ts`), never post-stretch/colormap RGB.
- Be **lightweight**: pure TS + the two existing runtime deps only
  (`@hscmap/healpix`, `svelte`). No TensorFlow.js / ONNX-runtime / big ML stack.
  Start with thresholds + a decision tree; a tiny embeddable model is a later,
  optional upgrade (see §6, and the constraint in §3.6).

### 1.3 Non-goals
- **Not** flux-calibrated photometry or a science-grade classifier. HiPS tiles are
  8-bit, already stretched and often saturated (BACKLOG #7); results are indicative,
  and the UI must say so.
- **Not** a replacement for the Rubin pipeline's `extendedness` / `refExtendedness`
  — where the Object table is reachable via TAP we prefer/annotate with the
  catalog truth (§5.2), and treat our image inference as the fallback + teaching tool.
- **Not** redshift, mass, SFR, or spectroscopic typing.
- **Not** a CNN in phase 1. A convolutional model is explicitly deferred behind a
  measured baseline (§6) so we never ship an unmeasured black box.
- **Not** deblending a crowded field into a member catalog. Cluster classification
  works on the aggregate cutout morphology, not per-star extraction (phase 3 does a
  coarse peak-count + a CMD scatter only where bands resolve members).

---

## 2. Class taxonomy & feasibility from 8-bit HiPS vs FITS/multi-band

The taxonomy reuses `ObjectType` from `src/data/catalog-data.ts` (star,
double-star, galaxy, open-cluster, globular-cluster, nebula, planetary-nebula,
supernova-remnant, other) so results slot into `ObjectInfoPanel` and can be
scored against catalog labels. Feasibility is the honest gate on what we promise:

| Target | Luminance-only (JPEG/DSS gray) | + Multi-band colour (ugrizy / gri) | Needs FITS (linear float) |
|---|---|---|---|
| **Star vs galaxy** (point vs extended) | **Yes** — core discriminator is morphology: FWHM-vs-PSF, concentration, profile-slope. Reliable for bright/resolved, degrades faint. | Better — colour locus + per-band consistency reduce false galaxies. | Un-saturated cores + real PSF improve faint-end; not required for MVP. |
| **Galaxy morphology** (E / S / Irr) | **Partial** — CAS + Gini/M20 + ellipticity work on gray; class boundaries looser on 8-bit. | Better — colour gradient (blue disk vs red bulge) adds a feature. | Better still (dynamic range for outskirts + spiral arms). |
| **Cluster: open vs globular** | **Partial** — spatial concentration / King-like radial slope + symmetry + roundness on the aggregate light. | **Yes (better)** — resolved-member colour spread + CMD shape (tight MS vs broad). | Best when individual members need clean photometry. |
| **Cluster crude age** | **No** (colour-blind). | **Partial** — integrated colour (blue=young open, red=old globular) + MS-turnoff colour if members resolve. Coarse buckets only. | Better for turnoff photometry. |
| **Stellar temperature / type** | **No** (a gray point has no colour). | **Yes** — colour index (g−r, or B−V proxy) → T_eff via a calibrated relation. | Better zero-points, not required for a coarse proxy. |
| **Nebula (diffuse/emission)** | **Partial** — low surface-brightness, large, low-concentration, no PSF core; hard to separate from faint extended galaxy on gray alone. | Better — emission nebulae are strongly colour-biased (Hα→r/i, OIII→g). | Better. |
| **Planetary nebula / SNR** | Coarse "extended, ring/shell, colour-peculiar" only | Marginally better | Realistically catalog-only for now |

**Design consequence.** Phase 1 promises only **star vs galaxy** (the most robust,
luminance-capable axis). Morphology subtype is phase 2. Everything colour-derived
(temperature, age, cluster kind refinement) is phase 3 and is **gated on
multi-band availability** — if the active base layer is a single band or a colour
JPEG whose channels are not real filters, the UI shows the morphology result and
says colour features are unavailable, rather than inventing a temperature.

**A colour JPEG is NOT three filters.** The DSS/gri *colour* HiPS composites are
already-mixed RGB; their R/G/B are not clean g/r/i flux. True colour indices
require either the **single-band Rubin datasets** (`band_u…band_y` in
`RUBIN_DATASETS`) sampled from separate tile loads, or FITS. The classifier must
know the difference (see `RubinDataset.kind === 'band'`), and only compute colour
indices from genuine per-band sources; from a colour composite it may use a
*qualitative* colour tint at reduced confidence, clearly labelled "approx from
display colour".

---

## 3. Chosen algorithms & the exact features to compute

All features are **pure functions of a cutout** (a small `Float32Array` grid of
honest pre-colormap intensity per available band + the sky WCS of the cutout, the
local PSF FWHM in pixels, and the pixel scale). They belong in a new
`src/utils/imageFeatures.ts` (pure, unit-testable in the `projection.ts` spirit),
consumed by a `src/utils/objectClassifier.ts` decision model. No DOM, no colormap.

### 3.0 Cutout extraction & honest sampling (shared prerequisite)
- Sample the **pre-colormap gray raster** exactly as `crossSection.ts` does
  (`luminance = (0.299R+0.587G+0.114B)/255` from the offscreen gray path), and
  mark off-buffer / missing-tile pixels as **gaps (NaN)**, never silent 0. A cutout
  with too many gaps (> ~20%) returns `class: 'unknown'` with a reason, not a guess.
- Cutout size adapts to zoom: a box of ~ `max(24 px, 6× local PSF FWHM)` per side,
  re-projected via `skyToCanvas(currentView())` so it tracks pan/zoom.
- **Background estimate** `b` = robust (median / sigma-clipped) of the cutout
  border ring; **noise** `σ` = MAD of the border. Feature computations use
  background-subtracted `I' = I − b` and a detection threshold `b + kσ` (k≈1.5).
- **Local PSF FWHM** in phase 1 is taken from the *median FWHM of nearby bright
  compact peaks* in the same cutout / neighbourhood (self-calibrating), falling
  back to a per-survey nominal (Rubin ~0.7″; DSS ~1.5″) — this matters because
  star/galaxy separation is fundamentally "extended *relative to the local PSF*".

### 3.1 Star vs galaxy — morphology vs the local PSF (phase 1)
Rubin's own pipeline separates on **`extendedness`**: binary per band, set when the
CModel magnitude is brighter than the PSF magnitude — equivalently `extendedness=0`
(point source) when `f_psf > 0.985 × f_cmodel`. We cannot fit CModel in-browser,
so we approximate the same idea with cheap morphology proxies, all comparing the
source to the local PSF:

Features (`imageFeatures.ts`):
- **`fwhmRatio` = source FWHM / local PSF FWHM.** Source FWHM from a second-moment
  size or a radial-profile half-max. Point source → ≈1; galaxy → >1. *Primary.*
- **`concentration` C = 5·log₁₀(r₈₀ / r₂₀)** — radii of circular apertures enclosing
  80% and 20% of background-subtracted flux (Conselice CAS). Stars (PSF-limited)
  sit at a tight, survey-specific C; galaxies spread higher. Reused for morphology.
- **`spreadModelProxy`** — SExtractor-style: compare flux in a PSF-matched aperture
  to flux in a slightly broader ("fuzzier") aperture (PSF ⊛ exponential, scale
  FWHM/16). >0 ⇒ extended. Cheap, robust discriminant.
- **`peakSharpness`** — peak pixel / total flux in a 3×3 core, normalised by the
  PSF's expected value. Cosmic-ray/hot-pixel guard + point-source signal.
- **`snr`** — for confidence gating: below a threshold, return low-confidence
  "unresolved / too faint to classify", mirroring the pipeline's faint-end failure.

Decision (phase 1, thresholds): star if `fwhmRatio < τ_f` AND `spreadModelProxy < τ_s`
AND `C < τ_C`; else galaxy; else (low snr) unknown. Thresholds are **calibrated on
the synthetic set** (§5.1), not guessed, and stored as named constants. Expected
accuracy: high for bright/well-resolved (SExtractor CLASS_STAR reports ~95% to
R≈22 at 0.9″ seeing — our proxies are weaker but the synthetic set sets a floor),
degrading at the faint end exactly as `extendedness` does — the UI reflects this
via confidence.

### 3.2 Galaxy morphology — non-parametric CAS + Gini/M20 (phase 2)
Once classified galaxy, compute non-parametric indices (Conselice CAS; Lotz
Gini–M20) on the background-subtracted, segmented cutout:

- **Concentration C = 5·log₁₀(r₈₀/r₂₀)** (as above). High C (~≥4) ⇒ bulge-dominated
  / early type; low C ⇒ disk.
- **Asymmetry A** = Σ|I − I₁₈₀| / Σ|I|, where I₁₈₀ is the cutout rotated 180° about
  the flux centroid (centre chosen to minimise A). High A ⇒ irregular / merger /
  spiral with strong arms; low A ⇒ smooth elliptical.
- **Smoothness / Clumpiness S** = Σ|I − I_smooth| / Σ|I|, with I_smooth a boxcar of
  ~0.25·r_petro. High S ⇒ clumpy star-forming / spiral; low S ⇒ smooth elliptical.
- **Gini G** = `1/(2·X̄·n(n−1)) · Σᵢ (2i − n − 1)|Xᵢ|`, X the sorted per-pixel
  fluxes over the segmented pixels. Concentration of light independent of centre.
- **M20** = `log₁₀(Σᵢ Mᵢ / M_tot)` over the brightest 20% of flux, where
  `Mᵢ = fᵢ·((xᵢ−x_c)²+(yᵢ−y_c)²)` and `M_tot = Σ fᵢ·((xᵢ−x_c)²+(yᵢ−y_c)²)`.
  Low (more negative) M20 ⇒ single concentrated nucleus; high ⇒ multiple/off-centre
  bright clumps.
- **Ellipticity e & position angle** from the flux second-moment tensor (Stokes
  Q,U). Ellipticals span a range; face-on disks round; edge-on disks high e.
- **`sersicProxy`** — rather than a full non-linear Sérsic fit (n≈4 de Vaucouleurs
  elliptical, n≈1 exponential disk), use the well-established **C↔n monotonic
  relation**: map measured C to an approximate n bucket. A true 1-parameter Sérsic
  fit to the azimuthally-averaged radial profile is an optional refinement.
- **`colourGradient`** (multi-band only): (centre − outer) of g−i. Red centre/blue
  disk ⇒ spiral; uniform red ⇒ elliptical.

Decision (phase 2): a small **decision tree / boundary lines**, not a CNN:
- **Elliptical**: high C, low A, low S, low M20, round-to-moderate e.
- **Spiral / disk**: moderate C, higher A & S, blue colour gradient if bands.
- **Irregular / merger**: high A, high M20; Gini–M20 above the Lotz merger line
  **G > −0.14·M20 + 0.33**. Early-vs-late split uses the Lotz-style companion line
  **G > 0.14·M20 + 0.80 ⇒ E/S0/Sa**, else Sb–Irr.
Expected accuracy: coarse 3-class only; 8-bit + seeing blur the boundaries, so we
report morphology with visibly lower confidence than star/galaxy and **show the CAS
/ Gini–M20 numbers** so the user judges.

### 3.3 Open vs globular cluster + crude age (phase 3, better with bands)
Clusters are aggregates; classify on the cutout's **spatial** structure plus
**member colour** where resolvable:

- **`peakCount` / `peakDensity`** — count local maxima above `b + kσ` in the cutout
  (member stars). Many compact peaks ⇒ resolved cluster vs a single galaxy.
- **`radialConcentration` (King-like)** — slope of the azimuthally-averaged member
  *density* profile. Globulars are compact, round, centrally concentrated (steep,
  high central density, King concentration `c = log₁₀(r_t/r_c)` large); open
  clusters are loose, irregular, low concentration.
- **`symmetry` / `roundness`** — from the density second moments. Globular ⇒ round,
  symmetric; open ⇒ irregular.
- **`cmdSpread`** (multi-band, members resolved): scatter of member (colour,
  magnitude) points. Globular ⇒ tight old red sequence with a clear MS-turnoff knee;
  open ⇒ bluer, looser, younger MS.
- **Crude age proxy**: from integrated / member colour and the CMD turnoff colour —
  bluer ⇒ younger (open, ≲ few Gyr); red, tight, low turnoff ⇒ old (globular,
  ≫ Gyr). Report **buckets** ("young / intermediate / old"), never a number in Gyr
  we can't defend. Full isochrone fitting to a CMD is explicitly out of scope; we
  only read the qualitative turnoff/colour.

Decision: globular if round + high radialConcentration + tight red CMD; open if
irregular + low concentration + bluer/looser CMD. Luminance-only ⇒ spatial features
only, "kind uncertain, colour unavailable".

### 3.4 Stellar temperature / spectral-type proxy (phase 3, needs real bands)
For a source classified star, with genuine per-band cutouts (`kind: 'band'`):
- **Colour indices** g−r, r−i (and where present u−g, i−z) from background-subtracted
  aperture flux in each band's cutout at the same sky position.
- **T_eff proxy** via a published colour–temperature relation. For a B−V-style
  proxy, Ballesteros (2012) gives a closed form
  `T_eff = 4600·(1/(0.92·(B−V)+1.7) + 1/(0.92·(B−V)+0.62))` K; for SDSS/Rubin gri
  we use an analogous empirical polynomial in g−r calibrated on the synthetic
  colour track (and, later, on TAP-labelled stars). Map T_eff → coarse **spectral
  class bucket** (O/B/A/F/G/K/M) for display.
- Honest limits: interstellar reddening, metallicity and 8-bit clipping bias the
  colour; report a **bucket + the colour index used**, not a false-precision Kelvin.

### 3.5 Nebula (coarse, phase 3)
Emission/reflection nebulae: large angular extent, **low surface brightness**, low
concentration (no PSF-like core), high asymmetry/irregularity, and strong colour
bias in real bands (Hα in r/i, OIII in g). Feature set = extent + low-C + colour
peculiarity; realistically a low-confidence "diffuse / nebular" flag, deferred and
never claimed with high confidence on gray-only input.

### 3.6 The scoring model (start simple, stay auditable)
Phase 1–2 use an explicit **decision tree with calibrated thresholds** and a
**transparent confidence**: confidence = a monotonic function of how far the
features sit from the decision boundary AND of SNR (near-boundary or low-SNR ⇒ low
confidence). This is deliberately not a CNN so every result is explainable by the
displayed feature values — which is also what makes §5 falsifiable.

Only after the decision-tree baseline is **measured** (confusion matrix on the
synthetic + real holdout) do we consider a *tiny* upgrade: a small logistic
regression / random forest on the same handful of features (still pure TS,
serializable as a few KB of coefficients), or — as a clearly-scoped stretch — a
**tiny quantised CNN** on the cutout. Any model upgrade must **beat the decision
tree on the same held-out confusion matrix** to ship, and must not add a heavy
runtime dependency (the constraint from `.claude/CLAUDE.md`: runtime deps stay
`@hscmap/healpix` + `svelte`). Weights, if any, are a static asset, not a framework.

---

## 4. UX in ObjectInfoPanel — honest, image-inferred, degrades gracefully

Add an **"Image-inferred"** section to `ObjectInfoPanel.svelte`, visually distinct
from the existing catalog-match block, driven by a new `ImageClassification` result
type (separate from `IdentifyInfo`). Both can show at once: catalog says *what's
cataloged here*; image inference says *what the pixels look like* — and where both
exist, agreement/disagreement is itself informative.

Panel contents:
- **Inferred class + subtype**, e.g. "Galaxy — spiral (image-inferred)". The
  "(image-inferred)" tag is mandatory and styled distinctly from catalog fields.
- **Confidence** as an explicit value/bar (e.g. "confidence 0.72"), never a bare
  certainty. Low confidence renders as "uncertain — <reason>".
- **Features used**, expandable: the actual numbers (fwhmRatio, C, A, S, Gini, M20,
  g−r, T_eff proxy) so the user can audit the call — matching the project's honesty
  norm (`crossSection` shows "relative luminance, not flux").
- **Provenance line** distinguishing input fidelity: "from single band r
  (morphology only — no colour)" vs "from ugrizy (colour features available)" vs
  "approx from display colour composite". Mirrors `activeBaseLabel`.
- **Graceful degradation**:
  - luminance-only ⇒ show morphology class only; colour rows read "unavailable
    (no per-band data)", not blanks or zeros.
  - too many gaps / too faint / off-tile ⇒ "cannot classify here (<reason>)",
    never a fabricated class.
  - Colour composite (not real bands) ⇒ colour features shown at reduced confidence
    with the "approx from display colour" caveat, or hidden.
- **Catalog cross-check** (when TAP reachable, §5.2): if the Object table gives
  `extendedness`, show "Rubin catalog: extended" beside the image call and flag
  agreement. This is annotation, not ground truth injection into the classifier.

Wiring: the classifier runs (throttled, like the cursor readout) off the same
click that populates `identifyAt`; results flow into the panel as a second,
clearly-separated block. No change to the catalog path's semantics.

---

## 5. Testing plan (the centerpiece)

The mandate (root `CLAUDE.md` "Adversarial test rule"): for every test, answer
"what broken version still passes?" A classifier that always says "galaxy" must
**measurably fail**. So the classifier is scored with an **accuracy + confusion
matrix against known truth**, never "it produced a label".

### 5.1 Synthetic ground truth — extend `syntheticSky.ts` (primary)
Extend `SyntheticSource` to carry a **true class** and render class-appropriate
morphology, so every cutout has a known label and features have a closed-form
expectation. Concretely (all deterministic, seed-driven, pure — preserving the
file's hard invariants):

- Add `trueClass: 'star' | 'galaxy' | 'open-cluster' | 'globular-cluster' | 'nebula'`
  and per-class morphology params to `SyntheticSource` (backward-compatible default
  `'star'` so existing tiling/geometry tests are unaffected — a star renders as the
  current single Gaussian).
- Extend the rasterizer (`renderSyntheticTile` / a shared per-source painter) to
  render each class with the *right* structure, not just a wider Gaussian:
  - **star** → current PSF Gaussian (FWHM = seeing). *fwhmRatio≈1, low C.*
  - **galaxy** → an **extended Sérsic** profile `I(r)=I_e·exp(−b_n[(r/r_e)^{1/n} − 1])`
    with per-source `n` (n≈4 elliptical, n≈1 disk), ellipticity, PA, and an optional
    spiral/clumpy term for irregular; convolved with the PSF. *Known C, A, S, Gini,
    M20, n by construction.*
  - **open cluster** → a **loose, irregular point-set** of member PSFs, low central
    concentration, bluer member colours. *Known peakCount, low radialConcentration.*
  - **globular cluster** → a **compact, round, centrally-concentrated point-set**
    (King-like density), red member colours, tight CMD. *Known high concentration.*
  - **nebula** → a **diffuse low-surface-brightness** blob (large r_e, very low C),
    optional emission colour bias. *Known low C, large extent.*
  - Multi-band: give each class a physically-motivated colour track (blue young
    open vs red old globular; blue disk vs red bulge; O–M stellar colour sequence)
    so colour-derived features (temperature, age, cluster kind) are testable, using
    the existing `BAND_COLOR_OFFSET` mechanism generalised per class.
- **Scoring harness** (`tests/unit/objectClassifier.test.ts`, pure — no canvas
  mock needed because we feed the pure rasterizer's buffers straight to the pure
  feature/classifier functions):
  - Generate a labelled population spanning all classes across a magnitude/SNR
    range; extract each source's cutout from the rasterized tiles at its true
    position; run the classifier; build a **confusion matrix** and per-class
    precision/recall.
  - **Assert accuracy thresholds** per phase, e.g. phase 1 star-vs-galaxy overall
    accuracy ≥ 0.85 on the bright/resolved subset, ≥ prior + margin on the faint
    subset. Thresholds are chosen to be *above the trivial baselines* below and
    ratcheted up as the classifier improves (never down to pass — mirrors the
    coverage-floor rule).
  - **Adversarial baselines that MUST fail the same assertions**: an
    `alwaysGalaxy` classifier and a `randomClass` classifier are run through the
    identical harness; the test asserts their measured accuracy is at/near the
    class prior and **below** the real classifier's threshold. If "always galaxy"
    could pass, the test is worthless — so we encode that it cannot.
  - **Feature closed-form checks**: because the synthetic morphology is analytic,
    assert computed features match expectation within tolerance (a rendered n=1
    disk yields low C and n≈1 `sersicProxy`; a PSF star yields fwhmRatio≈1; a
    globular yields high radialConcentration) — this catches an axis-swapped or
    all-zero feature the way `crossSection.test.ts` catches a swapped profile axis.
  - **Confidence calibration**: assert confidence correlates with correctness
    (mean confidence on correct > on incorrect; low-SNR sources get low confidence).

### 5.2 Real-object holdout — SIMBAD / Rubin TAP labels (secondary)
A committed fixture (`tests/fixtures/`) of real objects with trusted labels:
- **Label sources**: **SIMBAD** object types for a spread of stars/galaxies/clusters
  /nebulae (famous + faint), and the **Rubin DP1 Object table via TAP**
  (`extendedness`, `*_psfMag`, `*_cModelMag`) for star/galaxy truth — noting the
  known `tap.ts` DP0.2→DP1 namespace smell must be reconciled before wiring the live
  path (BACKLOG #10 / api-patterns). Labels are fetched once and committed, per the
  regression-test rule; tests never hit the network.
- Run the classifier on cutouts sampled from the *displayed* imagery for each and
  assert **star-vs-galaxy accuracy ≥ a stated threshold with a confusion matrix**,
  and that **confidence correlates with correctness**. Coarse-type accuracy is
  reported (not hard-gated at first) because 8-bit real imagery is genuinely harder.

### 5.3 Invariance & degradation checks (guardrails)
- **Stretch / colormap invariance**: the classification of a fixed cutout must be
  **stable across display stretch and colormap** — because features are computed
  from the honest **pre-colormap** raster (like `crossSection`), not the displayed
  RGB. Test: run through several `scaling.ts`/`colormap.ts` settings, assert the
  class + features are unchanged (this is the test that fails if someone samples
  post-colormap pixels).
- **Luminance-only degradation**: feed the same source as (a) multi-band and (b)
  luminance-only; assert the class is still recovered where morphology suffices,
  colour-derived fields become "unavailable" (not fabricated), and confidence is
  **lower**, not equal — degradation must be *visible in the output*.
- **Gap / faint honesty**: a mostly-gap cutout ⇒ `unknown` with reason, never a
  class; a below-SNR source ⇒ low-confidence/unknown, never false certainty (the
  §1.3 non-goal encoded as a test).
- **Determinism**: same seed + same cutout ⇒ identical result (pure-function
  guarantee), asserted so a hidden `Math.random`/`Date` cannot creep in.

### 5.4 What each layer buys (and the trap it avoids)
- Synthetic (5.1) is the only place with *per-pixel known truth*, so it is where
  accuracy is actually **measured** and where the "always galaxy" trap is disarmed.
- Real holdout (5.2) guards against synthetic-morphology overfitting — the classifier
  must also work on imagery it didn't have a generator for.
- Invariance (5.3) guards the honesty rails (pre-colormap sampling, graceful
  degradation, no fabricated values) that the failure-mode checklist demands.

---

## 6. Phased implementation plan

Each phase is independently shippable, ends with a **measured** confusion matrix,
and is gated by design-review (per `CLAUDE.md`) on its spec before coding.

**Phase 0 — substrate & scaffolding (enables everything)**
- Extend `syntheticSky.ts` with `trueClass` + class-appropriate rasterization
  (§5.1), preserving all existing invariants and default-star back-compat.
- Add pure `src/utils/imageFeatures.ts` (cutout extraction via the crossSection
  honest-sampling pattern; background/noise; PSF estimate; the feature functions).
- Add the scoring harness + `alwaysGalaxy`/`randomClass` adversarial baselines.
- Exit criterion: harness runs, baselines measurably fail, features match closed
  form on synthetic sources.

**Phase 1 — star vs galaxy on morphology alone (luminance-capable)**
- `objectClassifier.ts` decision tree using `fwhmRatio`, `spreadModelProxy`,
  `concentration`, `snr`; thresholds calibrated on the synthetic set.
- Wire the **Image-inferred** block into `ObjectInfoPanel` (class + confidence +
  features + provenance + graceful degradation).
- SIMBAD/TAP real holdout for star-vs-galaxy.
- Exit criterion: synthetic star/galaxy accuracy ≥ target on resolved subset;
  real-holdout confusion matrix meets threshold; invariance + degradation tests
  pass; "always galaxy" fails.

**Phase 2 — galaxy CAS / Gini–M20 morphology (E / S / Irr)**
- Add CAS, Gini, M20, ellipticity, `sersicProxy`; decision tree with the Lotz
  boundary lines; surface subtype + numbers in the panel at lower confidence.
- Exit criterion: 3-class morphology confusion matrix reported and above the
  trivial baseline; features validated against the synthetic Sérsic renders.

**Phase 3 — multi-band colour → cluster / age / temperature**
- Real per-band cutouts from `RUBIN_DATASETS` `kind:'band'` (u…y) — separate tile
  loads sampled at the same sky point; colour indices; T_eff proxy (Ballesteros /
  gri polynomial); cluster open-vs-globular via spatial concentration + CMD spread;
  crude age buckets; coarse nebula flag.
- Colour features strictly gated on genuine bands; colour-composite input → reduced
  confidence + caveat.
- Exit criterion: colour-feature tests pass on synthetic colour tracks; cluster
  open/globular confusion matrix reported; temperature buckets validated on the
  synthetic stellar colour sequence + any TAP-labelled stars.

**Deferred / stretch (not phase-gated to ship anything):** a tiny quantised CNN or
logistic-regression upgrade — only if it beats the decision tree on the same
held-out confusion matrix and adds no heavy runtime dependency (§3.6).

---

## 7. Sources

Star–galaxy separation / extendedness / spread_model / CLASS_STAR:
- Rubin DP1 47 Tuc analysis (extendedness usage): https://iopscience.iop.org/article/10.3847/1538-4357/adfb70
- HSC Software Pipeline (extendedness = PSF vs CModel): https://arxiv.org/pdf/1705.06766
- Star/galaxy separation at faint magnitudes (DES simulation): https://arxiv.org/pdf/1306.5236
- SExtractor CLASS_STAR classifier (inputs, ~95% to R≈22): https://sextractor.readthedocs.io/en/latest/ClassStar.html
- Star–Galaxy separation with Gaussian Processes: https://iopscience.iop.org/article/10.3847/1538-3881/ac4e93
- miniJPAS ML star-galaxy classification: https://arxiv.org/pdf/2007.07622

Non-parametric morphology (CAS, Gini, M20, Sérsic):
- A New Non-Parametric Approach to Galaxy Morphological Classification (Abraham/Conselice lineage): https://arxiv.org/abs/astro-ph/0311352
- Nonparametric galaxy morphology UV→submm (CAS/Gini/M20 review + formulas): https://www.aanda.org/articles/aa/full_html/2020/09/aa38470-20/aa38470-20.html
- Morphologies for DECaLS galaxies (nonparametric indices + ML, galmex): https://www.aanda.org/articles/aa/full_html/2026/05/aa58260-25/aa58260-25.html
- Lotz Gini–M20 merger boundary (G > −0.14·M20 + 0.33): https://academic.oup.com/mnras/article/419/3/2703/1071078
- Mergers of galaxies review (Gini/M20/CAS usage): https://arxiv.org/pdf/2506.09136
- Sérsic profile (n=1 disk / n=4 de Vaucouleurs, C↔n): https://petrofit.readthedocs.io/en/latest/introduction.html
- Quantitative morphology from SDSS (bulge/disk Sérsic): https://arxiv.org/pdf/astro-ph/0507249

Clusters, CMD, isochrones, age:
- Ages of 55 globular clusters via CMD (turnoff method): https://iopscience.iop.org/article/10.1088/0004-637X/775/2/134
- Interpreting open-cluster CMDs via simulation: https://academic.oup.com/mnras/article/351/2/649/1026346
- Globular cluster colour–magnitude diagrams (Britannica overview): https://www.britannica.com/science/globular-cluster/Colour-magnitude-diagrams
- Extended MSTO as a common feature of MW open clusters: https://iopscience.iop.org/article/10.3847/1538-4357/aaedc1
- Detectability of MW satellites & outer-halo star clusters with Rubin: https://arxiv.org/html/2504.16203v1

Stellar colour → temperature:
- Ballesteros (2012) B−V ↔ T_eff (PyAstronomy implementation ref): https://pyastronomy.readthedocs.io/en/latest/pyaslDoc/aslDoc/aslExt_1Doc/ramirez2005.html
- Colour index overview: https://grokipedia.com/page/Color_index

Rubin data / labels:
- photoD with Rubin DP1 (photometric stellar typing context): https://arxiv.org/html/2512.24109
