# BIS DSS Debt-Market Expansion Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for every behavior change and superpowers:verification-before-completion before any completion claim.

**Goal:** Publish and render BIS national debt-securities statistics as a separate, directly observed country product without mixing domestic debt-market totals with Capital Atlas cross-border stocks.

**Architecture:** Fetch the official BIS `WS_NA_SEC_DSS` SDMX-CSV dataflow through the existing bounded cache. Normalize only quarterly, current-USD, all-currency, all-maturity, market-value observations into deterministic `debt_market/{ISO3}.json` shards. Preserve the official accounting entry, counterparty scope, sector, stock/transaction distinction, valuation, and lineage on every row. Add the direct rows to the facts ledger and surface a compact STATION readout with dossier-backed numbers and explicit unavailable states.

**Tech Stack:** TypeScript, tsx, Zod, Vitest, React 19, static JSON shards, GitHub Actions.

---

## Task 1: Lock the DSS contract and parser with failing tests

**Files:**
- Create: `scripts/fetch/bis-dss.test.ts`
- Create: `scripts/build/debt-market-contract.test.ts`
- Create: `scripts/build/debt-market-contract.ts`
- Modify: `src/types/data.ts`

**Step 1: Write RED tests**

Cover quoted CSV parsing, `UNIT_MULT`, ISO2→ISO3 mapping, supported counterparty scopes, stock vs transaction separation, direct A-grade lineage, invalid hierarchy/scope rejection, and rejection of non-market/non-USD rows.

**Step 2: Verify RED**

Run `pnpm vitest run scripts/fetch/bis-dss.test.ts scripts/build/debt-market-contract.test.ts` and confirm the missing implementation fails for the expected reason.

**Step 3: Implement the smallest parser and strict Zod contract**

Keep official sector codes unaggregated. Do not infer missing sectors or convert stock changes into transactions.

**Step 4: Verify GREEN**

Run the targeted tests again.

## Task 2: Build deterministic debt-market shards and pipeline gates

**Files:**
- Create: `scripts/fetch/bis-dss.ts`
- Create: `scripts/build/debt-market.ts`
- Create: `scripts/build/debt-market.test.ts`
- Modify: `scripts/run.ts`
- Modify: `scripts/fetch/registry.ts`
- Modify: `scripts/build/facts.ts`
- Modify: `scripts/build/facts.test.ts`
- Modify: `scripts/check/sanity.ts`
- Modify: `package.json`
- Modify: `.github/workflows/data-refresh.yml`

**Step 1: Write RED tests**

Cover per-country deterministic grouping, index coverage, facts-ledger projection, explicit source registration, and refusal to overwrite on empty/drifted official responses.

**Step 2: Verify RED**

Run the affected Vitest files and record the expected failures.

**Step 3: Implement fetch/build/ledger/gates**

Use two bounded official queries (assets and liabilities), filter to `XW`, `1E`, and `5Z`, write only countries with observations, and record row/country/period coverage in `pipeline_report.json`. Add `data:dss` to the explicit refresh chain before facts and sanity.

**Step 4: Verify GREEN and regenerate committed data**

Run targeted tests, `pnpm data:dss`, `pnpm data:facts`, `pnpm data:sources`, and `pnpm data:check`.

## Task 3: Surface the direct observations in STATION

**Files:**
- Create: `src/features/station/debtMarket.ts`
- Create: `src/features/station/debtMarket.test.ts`
- Modify: `src/lib/dataClient.ts`
- Modify: `src/features/station/ExposurePanel.tsx`
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/ko.json`

**Step 1: Write RED tests**

Cover nearest-period selection, exact-series selection, nonresident share calculation only from compatible market-value rows, top-sector selection without hierarchy summation, and honest unavailable reasons.

**Step 2: Verify RED**

Run the targeted test and confirm failure before implementation.

**Step 3: Implement UI integration**

Lazy-load `debt_market/{ISO3}.json` through the bounded shard cache. Add a compact direct-observation column for total issued stock, net issuance, resident foreign holdings, and nonresident holdings. Every visible number must open a lineage dossier with accounting basis, sector code, counterparty scope, valuation, unit, and effective date.

**Step 4: Verify GREEN**

Run targeted component/domain tests and i18n parity checks.

## Task 4: Document limits and verify end to end

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/DATA_CONTRACT.md`
- Modify: `docs/DATA_PIPELINE.md`

**Step 1: Document the exact product boundary**

State that DSS is national debt issuance/holdings data for reporting economies, not a bilateral cross-border asset ledger, fund/SPV look-through, or country crypto allocation. Record coverage and the no-inference rule for missing economies/sectors.

**Step 2: Run full verification**

Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm data:check`, and inspect the production UI for KOR plus a non-reporting economy.

**Step 3: Stop condition**

Stop only when all gates pass, the static product is regenerated, every rendered number has dossier lineage, unavailable countries remain visibly unavailable, and crypto remains global-only rather than fabricated by country.
