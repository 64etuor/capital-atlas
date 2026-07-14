# V3 Honesty Contract Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the deferred currency-composition/FXD, PIP sector and reconstructed-liability, top-down/bottom-up RAS closure, and live-price overlay capabilities without ever presenting a derived value as a direct observation.

**Architecture:** Keep the committed official observations immutable and publish the new IMF IIPCC/PIP dimensions as separate, deterministic exposure facts. Build FXD and RAS as derived views with explicit coverage, methods, grades, bounds, convergence evidence, and typed unavailability reasons; never write them back into the observed stock shards. Surface the results in STATION through a lazy-loaded country exposure file and place the live CoinGecko value in a visually separate overlay that cannot be confused with the official-statistics vintage.

**Tech Stack:** TypeScript 6, Node 22, IMF SDMX 2.1, CoinGecko JSON, Vitest, Zod, React 19, Zustand, Vite.

---

### Task 1: Restore Linux CI portability

**Files:**
- Create: `scripts/build/digest.ts`
- Create: `scripts/build/digest.test.ts`
- Modify: `scripts/build/flowmatrix.test.ts`

**Step 1: Write the failing test**

Add a test for `digestFiles(root, relativePaths)` that hashes sorted path names plus file bytes, remains identical across input order, and changes when either a path or file body changes. Importing the not-yet-created helper must fail first.

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run scripts/build/digest.test.ts`
Expected: FAIL because `./digest.ts` does not exist.

**Step 3: Write minimal implementation**

Implement the helper with `node:crypto` SHA-256 and `node:fs`; do not shell out to `md5`, `find`, or `xargs`.

**Step 4: Replace the platform-specific regression test**

Use the helper in `flowmatrix.test.ts` before and after `pnpm data:flowmatrix`.

**Step 5: Verify and commit**

Run: `pnpm vitest run scripts/build/digest.test.ts scripts/build/flowmatrix.test.ts && pnpm test`
Expected: 22 test files pass on macOS and the code path contains no `md5 -q`.

Commit: `fix(ci): make deterministic digest portable`

### Task 2: Define the v3 exposure contract before fetching data

**Files:**
- Modify: `src/types/data.ts`
- Modify: `docs/DATA_CONTRACT.md`
- Modify: `scripts/check/sanity.ts`
- Create: `scripts/build/exposure-contract.test.ts`

**Step 1: Write the failing contract tests**

Specify typed records for:

```ts
type ExposureStatus =
  | { status: 'available' }
  | { status: 'unavailable'; reason: string }

interface CurrencyExposureRecord extends Lineage {
  country: string
  period: PeriodKey
  entry: 'assets' | 'liabilities'
  sector: string
  currency: 'USD' | 'EUR' | 'JPY' | 'XDC' | 'OTHC' | 'UALLC'
  value_usd: number
}

interface SectorPositionRecord extends Lineage {
  country: string
  period: PeriodKey
  sector: string
  asset: 'listed_equity' | 'debt_securities'
  value_usd: number
}
```

Derived records must also carry `estimate_method`, numeric `lower_bound`/`upper_bound`, `coverage_share`, and either an available value or a non-empty unavailability reason. Tests reject `null`, empty reasons, missing lineage, unknown sector codes, and D/E values without finite ordered bounds.

**Step 2: Verify RED**

Run: `pnpm vitest run scripts/build/exposure-contract.test.ts`
Expected: FAIL because the v3 schemas and types do not exist.

**Step 3: Add minimal types and Zod gates**

Add `ExposureIndexFile`, `CountryExposureFile`, `CurrencyExposureRecord`, `SectorPositionRecord`, `FxdResult`, `ReconstructedLiability`, and `PositionClosureFile`. Preserve existing stock/flow types.

**Step 4: Verify and commit**

Run: `pnpm vitest run scripts/build/exposure-contract.test.ts && pnpm typecheck`
Expected: PASS.

Commit: `feat(data): define v3 exposure honesty contract`

### Task 3: Fetch and normalize official IIPCC and PIP sector observations

**Files:**
- Create: `scripts/fetch/imf-exposure.ts`
- Create: `scripts/fetch/imf-exposure.test.ts`
- Modify: `scripts/run.ts`
- Modify: `scripts/fetch/registry.ts`
- Modify: `scripts/fetch/registry.test.ts`

**Step 1: Write failing parser tests**

Use small inline StructureSpecificData fixtures to prove:

- IIPCC `A_P/L_P`, debt indicators and the six non-overlapping currency buckets normalize to direct grade-A currency facts.
- `FC` is rejected because it overlaps USD/EUR/JPY/other foreign-currency buckets.
- PIP sector codes remain exact (`S11`, `S13`, `S14`, `S15`, `S1V`, financial subsectors); `S1V` is never split.
- PIP `DERIVATION_TYPE=O` becomes a direct observation and `SCC` becomes a derived reconstructed liability, never grade A.
- Annual observations map to Q4 and quarterly observations take precedence for the same key.

**Step 2: Verify RED**

Run: `pnpm vitest run scripts/fetch/imf-exposure.test.ts`
Expected: FAIL because the module does not exist.

**Step 3: Implement bounded cached fetches**

Reuse `fetchCached`, `parseSdmxSeries`, `pooled`, and `toQuarter`. Add `imf_iipcc` to the registry as `batch_official`; keep official PIP direct and SCC-derived records distinguishable in normalized JSON.

**Step 4: Verify and commit**

Run: `pnpm vitest run scripts/fetch/imf-exposure.test.ts scripts/fetch/registry.test.ts && pnpm typecheck`
Expected: PASS.

Commit: `feat(data): ingest IIP currency and PIP sector dimensions`

### Task 4: Build coverage-gated constant-FX and sector exposure files

**Files:**
- Modify: `scripts/fetch/fx.ts`
- Modify: `scripts/fetch/fx.test.ts`
- Create: `scripts/build/exposure.ts`
- Create: `scripts/build/exposure.test.ts`
- Modify: `scripts/run.ts`
- Modify: `package.json`

**Step 1: Write failing FXD tests**

Specify the formula:

```ts
fxdComponent = currentUsd * (usdPerCurrencyAtBase / usdPerCurrencyAtPeriod)
```

Build currency-level rates from the existing country FX table using the best-grade median for each ISO currency, with USD fixed at 1. Tests must prove exact components, explicit base period, component reconciliation within 0.5%, and these gates:

- `OTHC + UALLC <= 5%`: emit a grade-D point using no-change residual, bounded by the min/max observed major-currency revaluation factors.
- residual above 5%, missing base/current FX, or composition gap above 0.5%: emit `status: unavailable` with a reason, never a numeric placeholder.

**Step 2: Verify RED**

Run: `pnpm vitest run scripts/build/exposure.test.ts scripts/fetch/fx.test.ts`
Expected: FAIL on missing builder and currency-rate output.

**Step 3: Implement deterministic country files**

Write `public/data/exposure/index.json` and `public/data/exposure/{ISO3}.json`. Include direct currency facts, exact sector facts, FXD results, coverage shares, and source IDs; no timestamps inside country files.

**Step 4: Verify and commit**

Run: `pnpm vitest run scripts/build/exposure.test.ts scripts/fetch/fx.test.ts && pnpm data:exposure`
Expected: deterministic byte-identical rebuild and no fabricated FXD total.

Commit: `feat(data): publish coverage-gated constant-fx exposure`

### Task 5: Make reconstructed liabilities honest and add RAS closure

**Files:**
- Create: `scripts/build/position-closure.ts`
- Create: `scripts/build/position-closure.test.ts`
- Modify: `scripts/build/station.ts`
- Modify: `scripts/build/station.test.ts`
- Modify: `src/types/data.ts`
- Modify: `package.json`

**Step 1: Write failing RAS tests**

For a small bilateral seed matrix, assert bounded iterative proportional fitting closes to independently supplied owner-asset and issuer-liability IIP margins, keeps every cell nonnegative, reports iterations/residual, and attaches Fréchet bounds `max(0,r+c-T)..min(r,c)`.

Tests also require an explicit discrepancy node when global asset/liability margins differ and failure rather than partial output after 100 iterations.

**Step 2: Write the reconstructed-liability regression test**

Prove that STATION `holders` are no longer grade-A direct observations. They must be grade C, method `counterparty_assets_transposed_to_reconstructed_liability`, and carry the bottom-up/top-down reconciliation interval.

**Step 3: Verify RED**

Run: `pnpm vitest run scripts/build/position-closure.test.ts scripts/build/station.test.ts`
Expected: FAIL because current holder rows inherit grade A and no RAS builder exists.

**Step 4: Implement separate model output**

Use direct PIP bilateral assets only as the seed and IIP portfolio assets/liabilities only as margins. Publish `public/data/position_closure/{period}.json`; never mutate `flows_bilateral` or stock observations. Every adjusted cell is grade E with method, bounds, coverage, and convergence evidence.

**Step 5: Verify and commit**

Run: `pnpm vitest run scripts/build/position-closure.test.ts scripts/build/station.test.ts && pnpm data:closure`
Expected: all test matrices close within `1e-9` relative residual.

Commit: `feat(data): add bounded RAS position closure`

### Task 6: Put every new number behind sanity and refresh gates

**Files:**
- Modify: `scripts/check/sanity.ts`
- Modify: `scripts/build/facts.ts`
- Modify: `scripts/build/facts.test.ts`
- Modify: `scripts/check/changed.test.ts`
- Modify: `.github/workflows/data-refresh.yml`
- Modify: `README.md`

**Step 1: Write failing gate tests**

Require exposure facts to equal their shard counts, direct/derived grade distributions to reconcile, sector hierarchies not to be double-counted, FXD availability to obey its residual threshold, and every closure shard to converge with valid bounds.

Require `data:changed` to classify exposure/closure changes as substantive.

**Step 2: Verify RED**

Run: `pnpm vitest run scripts/build/facts.test.ts scripts/check/changed.test.ts scripts/build/exposure-contract.test.ts`
Expected: FAIL until the facts and refresh chain include the new families.

**Step 3: Extend the build chain**

Run exposure and closure after fetch, then station/facts, and before `data:check`. Preserve timestamp-only no-op behavior.

**Step 4: Verify and commit**

Run: `pnpm data:exposure && pnpm data:closure && pnpm data:station && pnpm data:facts && pnpm data:check`
Expected: all gates pass with printed coverage and closure summaries.

Commit: `feat(data): gate v3 facts in refresh pipeline`

### Task 7: Surface sector, FXD, reconstruction, and RAS as distinct pixels

**Files:**
- Create: `src/features/station/ExposurePanel.tsx`
- Create: `src/features/station/exposure.ts`
- Create: `src/features/station/exposure.test.ts`
- Modify: `src/features/station/StationView.tsx`
- Modify: `src/lib/dataClient.ts`
- Modify: `src/types/dossier.ts`
- Modify: `src/components/LineageDossier.tsx`
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/ko.json`

**Step 1: Write failing view-model tests**

Assert direct sector rows remain observed, `S1V` stays combined, reconstructed liabilities display `DERIVED`, RAS disappears in OBS mode, FXD unavailability renders its exact reason, and every available derived figure opens a dossier with source/method/grade/range/coverage.

**Step 2: Verify RED**

Run: `pnpm vitest run src/features/station/exposure.test.ts`
Expected: FAIL because the view model does not exist.

**Step 3: Implement the STATION exposure sheet**

Lazy-load the selected country's exposure file. Use flat ruled sections rather than cards. Keep direct observations solid, reconstructed liabilities hatched grade C, and RAS cells in the existing grade-E fog. Never substitute `0` or `—` for unavailable data; render `UNAVAILABLE — <reason>`.

**Step 4: Verify and commit**

Run: `pnpm vitest run src/features/station/exposure.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

Commit: `feat(station): expose v3 lineage and closure views`

### Task 8: Add a bounded live-market overlay without changing official vintage

**Files:**
- Create: `src/lib/nowcast.ts`
- Create: `src/lib/nowcast.test.ts`
- Create: `src/components/NowcastStrip.tsx`
- Modify: `src/App.tsx`
- Modify: `src/lib/dataClient.ts`
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/ko.json`

**Step 1: Write failing parser/state tests**

Validate CoinGecko payloads, reject missing/nonfinite/stale values, cap live refresh attempts, and prove fallback to the committed snapshot retains its original `as_of`. The overlay payload must always say `LIVE MARKET — NOT OFFICIAL STATISTICS` or `SNAPSHOT FALLBACK`.

**Step 2: Verify RED**

Run: `pnpm vitest run src/lib/nowcast.test.ts`
Expected: FAIL because the nowcast module does not exist.

**Step 3: Implement bounded refresh**

Fetch at mount and at most 12 five-minute refreshes per session, abort on unmount, and fall back to `/data/meta/global_crypto.json`. Do not change `index.generated_at`, `latestPeriod()`, official stock totals, or country allocations.

**Step 4: Verify and commit**

Run: `pnpm vitest run src/lib/nowcast.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

Commit: `feat(ui): add isolated crypto nowcast overlay`

### Task 9: Reconcile documentation and prove the real refresh loop

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/DATA_CONTRACT.md`
- Modify: `docs/DATA_PIPELINE.md`

**Step 1: Correct the documented state**

Document measured coverage, the distinction between direct PIP assets and SCC/reconstructed liabilities, exact sector categories, FXD base/residual rules, RAS non-overwrite boundary, nowcast separation, and re-review conditions. Remove the stale claim that CPIS mirror is impossible without mentioning the derived reconstruction, and remove the stale claim that IIP currency composition is unavailable.

**Step 2: Run full local verification**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm data:check`
Expected: all commands pass.

**Step 3: Run anti-slop and independent review**

Run the changed-file anti-slop pass, rerun all verification, then obtain distinct code-reviewer APPROVE and architect CLEAR evidence.

**Step 4: Push and validate automation**

Push `feat/v3-honesty`, open a PR, wait for CI green, merge, dispatch `Data refresh`, and verify either a substantive bot commit with all gates green or a correctly classified timestamp/metadata-only no-op. Recheck the next scheduled `17 5 * * *` run when it occurs.

**Step 5: Finish branch**

Use `superpowers:finishing-a-development-branch`; only mark the aggregate goal complete after merged CI, refresh evidence, documentation, and independent review are all green.
