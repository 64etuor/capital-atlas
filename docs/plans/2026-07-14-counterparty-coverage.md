# Counterparty Coverage Expansion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for every behavior change and superpowers:verification-before-completion before any completion claim.

**Goal:** Make country concentration safe to interpret from the dashboard, ingest official bilateral direct-investment positions, and use IMF PIP semiannual observations without presenting position changes or mixed statistical bases as directly observed flows.

**Architecture:** Preserve `stocks_owner` as the IIP asset/liability-basis canon. Extend the separate `flows_bilateral` fact family with directly reported IMF DIP outward positions and attach an explicit directional-principle basis; compute counterparty allocation coverage against same-period owner stock as a typed available/unavailable result. Keep PIP and DIP observations immutable, derive only explicitly grade-D position changes, and expose observation coverage separately from counterparty allocation coverage.

**Tech Stack:** TypeScript 6, IMF SDMX 2.1 StructureSpecificData, Zod, Vitest, React 19, Vite.

---

### Task 1: Publish counterparty allocation coverage

**Files:**
- Modify: `scripts/build/concentration.test.ts`
- Modify: `scripts/build/concentration.ts`
- Modify: `scripts/build/station.ts`
- Modify: `src/types/data.ts`
- Modify: `src/features/station/StationView.tsx`
- Modify: `docs/DATA_CONTRACT.md`

**Step 1: Write the failing calculation test**

Call `counterpartyConcentration(bilateral, iso3, ownerSeries)` with an owner total of 200 and bilateral gross of 100. Require:

```ts
expect(all?.allocation_coverage).toEqual({
  status: 'available',
  allocated_usd: 100,
  owner_stock_usd: 200,
  share: 0.5,
})
```

Also require a typed `unavailable` reason when the same-period owner denominator is absent, and require asset-scope coverage to use only that asset's owner stock.

**Step 2: Verify RED**

Run: `pnpm vitest run scripts/build/concentration.test.ts`
Expected: FAIL because counterparty concentration does not carry an allocation denominator.

**Step 3: Implement the minimal calculation**

Add an `AllocationCoverage` discriminated union. Use exact-period owner stock, never nearest-period substitution. Do not clamp shares above 100%; a ratio above one is a discrepancy signal, not a value to hide.

**Step 4: Make the pixels unambiguous**

Rename `VISIBILITY` to `OBS STOCK`, add `CP ALLOC`, and use `BILATERAL-COVERED ASSETS` for all-scope counterparty dossiers and the partner matrix. Include allocated gross, owner-stock denominator, scope, source families, and basis warning in the dossier.

**Step 5: Verify GREEN**

Run: `pnpm vitest run scripts/build/concentration.test.ts && pnpm typecheck`
Expected: PASS.

### Task 2: Ingest PIP semiannual positions

**Files:**
- Modify: `scripts/fetch/lib.test.ts`
- Modify: `scripts/fetch/lib.ts`
- Create: `scripts/fetch/imf.test.ts`
- Modify: `scripts/fetch/imf.ts`
- Modify: `scripts/fetch/imf-exposure.test.ts`
- Modify: `scripts/fetch/imf-exposure.ts`
- Modify: `scripts/build/assemble.ts`
- Modify: `scripts/build/position-closure.ts`
- Modify: `scripts/build/position-closure.test.ts`
- Modify: `scripts/check/sanity.ts`

**Step 1: Write failing period and precedence tests**

Require `toQuarter('2025-S1') === '2025-Q2'`, `toQuarter('2025-S2') === '2025-Q4'`, and reject other semester codes. Parse annual and semiannual rows that collide at Q4 and require the semiannual observation to win by canonical key.

**Step 2: Verify RED**

Run: `pnpm vitest run scripts/fetch/lib.test.ts scripts/fetch/imf.test.ts scripts/fetch/imf-exposure.test.ts`
Expected: FAIL because semester periods and frequency precedence are not implemented.

**Step 3: Implement immutable position ingestion**

Fetch `A+S` PIP frequencies with a cache-key version bump. Normalize every row to canonical `period` plus source `frequency`. Use exact period keys in assembly and RAS seed selection. Derive grade-D position changes only between adjacent published observations and retain `position_change_unadjusted_for_price`.

**Step 4: Verify GREEN**

Run: `pnpm vitest run scripts/fetch/lib.test.ts scripts/fetch/imf.test.ts scripts/fetch/imf-exposure.test.ts scripts/build/position-closure.test.ts && pnpm typecheck`
Expected: PASS.

### Task 3: Add official IMF DIP bilateral FDI

**Files:**
- Create: `scripts/fetch/imf-dip.test.ts`
- Create: `scripts/fetch/imf-dip.ts`
- Modify: `scripts/run.ts`
- Modify: `scripts/build/assemble.ts`
- Modify: `scripts/fetch/registry.ts`
- Modify: `scripts/fetch/registry.test.ts`
- Modify: `src/types/data.ts`
- Modify: `scripts/build/facts.ts`
- Modify: `scripts/build/facts.test.ts`

**Step 1: Write the failing parser test**

Use inline SDMX fixtures to require only directly reported (`DV_TYPE=O`) outward total net direct-investment positions (`OTWD_D_NETAL_FALL_ALL`), ISO3 counterpart economies, annual periods, and finite values. Reject `SCC`, `G001`, other indicators, and self-pairs.

**Step 2: Verify RED**

Run: `pnpm vitest run scripts/fetch/imf-dip.test.ts`
Expected: FAIL because the DIP module does not exist.

**Step 3: Implement bounded atomic fetching**

Fetch one reporting economy at a time with the existing bounded cache/pool. Publish direct grade-A `unlisted_equity_fdi` bilateral stocks with `position_basis: 'directional_principle'`; do not emit DIP flows. Add `imf_dip` to the source registry as annual official batch data.

**Step 4: Preserve basis in the fact ledger**

Carry `position_basis` through `BilateralRecord`, station partner dossiers, and `facts.ndjson.gz`. The concentration method must disclose that the all-scope view combines PIP asset holdings, BIS banking positions, and DIP directional positions.

**Step 5: Verify GREEN**

Run: `pnpm vitest run scripts/fetch/imf-dip.test.ts scripts/fetch/registry.test.ts scripts/build/facts.test.ts && pnpm typecheck`
Expected: PASS.

### Task 4: Regenerate, gate, document, and visually verify

**Files:**
- Modify: `scripts/check/sanity.ts`
- Modify: `scripts/build/snapshot-honesty.test.ts`
- Modify: `docs/DATA_PIPELINE.md`
- Modify: `docs/DATA_CONTRACT.md`
- Modify: `docs/architecture.md`
- Modify: `README.md`
- Regenerate: `public/data/**`

**Step 1: Add failing gates**

Require every DIP bilateral fact to be direct grade A, annual Q4, directional-principle, and never a flow. Require every semiannual PIP observation to land on Q2/Q4 and concentration coverage to carry a typed status and same-period denominator.

**Step 2: Run the full refresh chain**

Run the repository-documented data chain from `data:fetch` through `data:check`, including station, facts, reconciliation, and sources. Any required-source terminal failure stops publication.

**Step 3: Run full verification**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm data:check`
Expected: all commands exit zero.

**Step 4: Browser verification**

Open STATION for KOR and confirm `OBS STOCK`, `CP ALLOC`, `BILATERAL-COVERED ASSETS`, FDI counterparty rows, and dossier basis/coverage text. Confirm CRYP remains unavailable by country and the global live-market strip remains separate.

**Step 5: Independent review**

Have the separate reviewer verify source/basis honesty, direct-vs-derived grading, no false completeness, and test evidence. Address blocking findings and rerun the relevant gates.
