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

## 파일 목록 (`public/data/`)

| 경로 | 내용 | 갱신 |
|---|---|---|
| `countries.json` | 국가 마스터 (ISO3, 이름, region, centroid) | 드묾 |
| `stocks_owner.json` | 소유자 기준 국가×자산군×분기 잔액 | 분기 |
| `stocks_issuer.json` | 발행자 기준 동일 구조 | 분기 |
| `stocks_location.json` | 소재지 기준 동일 구조 (v1: 부동산·원자재 위주, 부분 커버 허용) | 분기 |
| `flows_bilateral.json` | 국가쌍×자산군×분기 (CPIS 파생 포지션 + 유도 flow) | 분기 |
| `meta/sources.json` | 소스 레지스트리 | 수집 시 |

- 인코딩: UTF-8 JSON. 값 단위: **USD (current)**, 절대값(백만 아님 — 스케일 접미사 금지).
- `period`: `"YYYY-Qn"` (2010-Q1 ~). 파일 크기가 5MB(gzip 전) 넘으면 분기별 샤딩
  (`stocks_owner/2024-Q4.json`)으로 전환하고 이 문서를 갱신한다.

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

### meta/sources.json

```json
[
  {
    "source_id": "imf_cpis",
    "name": "Coordinated Portfolio Investment Survey",
    "publisher": "IMF",
    "url": "https://data.imf.org/...",
    "license_note": "IMF data terms — attribution, no redistribution restrictions for aggregates",
    "update_frequency": "quarterly",
    "retrieved_at": "2026-07-12T08:30:00Z"
  }
]
```

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
