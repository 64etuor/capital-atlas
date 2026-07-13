# Capital Atlas — Data Contract (v1)

Phase B(파이프라인)와 Phase C(시각화)가 병렬로 어긋나지 않기 위한 **정본 계약**.
TS 미러: `src/types/data.ts` — 문서와 타입이 다르면 이 문서가 이긴다(고치고 커밋).

## 원칙 (초안 §1·§6 요약)

- **측정값 분리**: `stock`(잔액) / `flow`(거래) / `valuation`(평가변동) /
  `turnover`(거래량)는 절대 한 지표로 합치지 않는다.
- **국가 귀속 분리**: `basis = owner | issuer | location`. 파일 단위로 분리한다.
- **빈칸 금지, 허위 정밀도 금지**: 모든 수치 레코드는 lineage(출처·기준일·등급·
  산식·범위)를 갖는다. lineage 없는 수치는 계약 위반.
- 등급: `A` 공식 직접 관측 / `B` 비공식 직접 관측 / `C` 파생·조정 /
  `D` 통계 모델 추정 / `E` 저신뢰 잔차 추정.

## 파일 목록 (`public/data/`) — **샤딩 조항 발동됨 (Phase B)**

전체 기간 단일 파일은 5MB 조항을 초과해 **기간별 샤딩**으로 전환했다.
가용 기간 목록은 `index.json`이 정본이다.

| 경로 | 내용 | 갱신 |
|---|---|---|
| `countries.json` | 국가 마스터 (ISO3, 이름, region, centroid) | 드묾 |
| `index.json` | 가용 기간 인덱스 + `latest_quarter` | 수집 시 |
| `stocks_owner/{period}.json` | 소유자 기준 국가×자산군 잔액 (분기 샤드) | 분기 |
| `stocks_issuer/{period}.json` | 발행자 기준 동일 구조 | 분기 |
| `stocks_location/{period}.json` | 소재지 기준 (v1: 주거부동산 모델, 연 Q4만) | 연 |
| `flows_country/{period}.json` | 국가×자산군 **실거래 흐름(BOP)** + 파생 평가변동 | 분기 |
| `flows_bilateral/{period}.json` | 국가쌍×자산군 (PIP 포지션 + 유도 flow) | 연(Q4 표기) |
| `meta/sources.json` | 소스 레지스트리 | 수집 시 |
| `meta/flow_intensity.json` | 분기별 글로벌 총 흐름 강도 (바로그래프용) | 분기 |
| `meta/pipeline_report.json` | 커버리지·등급 분포·수집 실패 기록 | 수집 시 |
| `meta/global_crypto.json` | 암호자산 글로벌 통제값 (국가 배분은 v2) | 수집 시 |

- 인코딩: UTF-8 JSON. 값 단위: **USD (current)**, 절대값(백만 아님 — 스케일 접미사 금지).
- `period`: `"YYYY-Qn"` (2010-Q1 ~). 연간 원자료(WB 시총, PIP)는 해당 연도 **Q4**에 표기.

### stocks_issuer 자산별 의미 (v1 — 중복 방지 규칙)

한 (country, asset, period) 키는 파일 안에서 유일해야 하므로 자산별로 의미를 고정한다:

| asset | 의미 | 소스 |
|---|---|---|
| `listed_equity` | 국내 상장기업 시가총액 **총액** | wb_wdi (B) |
| `debt_securities` `deposits` `loans` `unlisted_equity_fdi` | **비거주자 보유** 대외부채 잔액 | imf_iip L_P (A) |

(상장주식의 비거주자 보유분은 v2에서 IIP L_P P_F5를 별도 축으로 노출 예정 —
동일 asset 키에 두 의미를 싣지 않기 위해 v1은 총액만.)

## 스키마

### countries.json

```json
[
  {
    "iso3": "KOR",
    "iso2": "KR",
    "name": "Korea",
    "region": "East Asia & Pacific",
    "centroid": [127.8, 36.4]
  }
]
```

### 공통 lineage 필드 (모든 수치 레코드)

```json
{
  "source_id": "imf_iip",
  "effective_date": "2024-12-31",
  "confidence_grade": "A",
  "estimate_method": "rollforward_price_fx",
  "lower_bound": 69000000000,
  "upper_bound": 102000000000
}
```

- `estimate_method`/`lower_bound`/`upper_bound`는 **추정치(C~E)에서 필수**,
  관측치(A/B)에선 생략.

### stocks_{basis}.json

```json
{
  "basis": "owner",
  "generated_at": "2026-07-12T09:00:00Z",
  "records": [
    {
      "country": "KOR",
      "asset": "listed_equity",
      "period": "2024-Q4",
      "measure": "stock",
      "value_usd": 84200000000,
      "value_usd_constant_fx": 81000000000,
      "source_id": "imf_iip",
      "effective_date": "2024-12-31",
      "confidence_grade": "A"
    }
  ]
}
```

### flows_bilateral.json

```json
{
  "generated_at": "2026-07-12T09:00:00Z",
  "records": [
    {
      "owner_country": "KOR",
      "issuer_country": "USA",
      "asset": "listed_equity",
      "period": "2024-Q4",
      "measure": "stock",
      "value_usd": 51000000000,
      "source_id": "imf_cpis",
      "effective_date": "2024-12-31",
      "confidence_grade": "A"
    }
  ]
}
```

- CPIS 원자료는 **포지션(stock)**. 파생 순거래(`measure: "flow"`)를 실을 땐
  `confidence_grade: "C"` 이상 불가 + `estimate_method: "position_change_adjusted_for_price_and_fx"`.

### meta/sources.json — 수집 분류 포함

SSOT는 `scripts/fetch/registry.ts`. 발행 파일은 `pnpm data:sources`(retrieved_at 보존)
또는 `pnpm data:fetch`(전 소스 now 스탬프)로만 재생성한다. 손편집 금지.

```json
[
  {
    "source_id": "imf_pip",
    "name": "Portfolio Investment Positions (PIP, CPIS successor) — bilateral",
    "publisher": "IMF",
    "url": "https://api.imf.org/external/sdmx/2.1/data/IMF.STA,PIP",
    "license_note": "IMF terms — attribution",
    "collection_mode": "batch_official",
    "update_frequency": "annual",
    "expected_release_lag": "~2–3 quarters after year end",
    "retrieved_at": "2026-07-12T08:30:00Z"
  }
]
```

**`collection_mode` — 실시간/비실시간 분류 (테스트로 강제):**

| mode | 의미 | cadence 허용값 | v1 소스 |
|---|---|---|---|
| `live_market` | 실시간·일중 시장 데이터. 발표 지연 없음, 폴링/스트림 대상 | intraday, daily | coingecko_global |
| `batch_official` | 공식 통계 배치. 분기/연간 + 발표 지연이 본질 — "실시간" 개념 없음 | monthly, quarterly, annual | imf_iip, imf_bop, imf_pip, wb_wdi |
| `derived_model` | 파이프라인 내부 파생·모델. 수집이 아니라 계산 (grade C–E) | quarterly, annual | model_regional_median, model_gdp_ratio |
| `static_reference` | 정적 참조 (지오메트리·국가 마스터, vendored 패키지) | static | natural_earth, world_countries |

규칙: **`live_market`·`static_reference` 소스는 stocks/flows 수치 레코드를 뒷받침할 수
없다** — 시장 데이터가 공식 통계로 위장하지 않는다(`scripts/fetch/registry.test.ts`).
live 데이터는 `meta/` 통제값·오버레이 전용.

## enum 정본

- `basis`: `owner` | `issuer` | `location`
- `measure_type`: `stock` | `flow` | `valuation` | `turnover`
- `asset` (v1): `deposits` | `loans` | `debt_securities` | `listed_equity` |
  `unlisted_equity_fdi` | `funds` | `reserves_gold` | `residential_property` |
  `commodities` | `crypto`
- `confidence_grade`: `A`–`E`

## Phase B 소스 우선순위 (참고)

IMF IIP/BOP(잔액·흐름 골격) → IMF CPIS(양자 포트폴리오) → BIS 채무증권·LBS(채권·은행)
→ World Bank/WFE(시가총액 통제값) → 파생·롤포워드(C) → 모델(D/E).
모든 소스는 `meta/sources.json`에 등록 후 사용.
