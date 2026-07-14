# Capital Atlas — Data Contract (v3)

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
| `meta/global_crypto.json` | 암호자산 글로벌 스냅샷 폴백(국가 배분 없음) | 수집 시 |
| `meta/fx_rates.json` | 분기 환율(LCU 표시·FXD 입력) | 수집 시 |
| `meta/synoptic.json` | SYNOPTIC 대시보드 사전 집계 (`pnpm data:synoptic`) | 수집 후 |
| `station/index.json` | STATION 가용 국가 목록 | 수집 후 |
| `station/{ISO3}.json` | STATION 국가별 사전 집계 (`pnpm data:station`, WLD=세계) | 수집 후 |
| `facts.ndjson.gz` | **정본 사실 테이블** — 전 수치 레코드 평탄화 (`pnpm data:facts`, Phase P) | 수집 후 |
| `meta/facts_summary.json` | 사실 테이블 정합 요약(수·테이블·등급 분포) — sanity 게이트 대상 | 수집 후 |
| `reconciliation/{period}.json` | §12-3 미러 폐합 쌍 상세 (`pnpm data:reconcile`, Phase P) | 수집 후 |
| `meta/reconciliation.json` | 미러 폐합 분포 요약(중앙값·사분위·상위 gap) | 수집 후 |
| `exposure/index.json` | 통화·부문 exposure 가용 국가/기간 + FXD 기준분기 | 수집 후 |
| `exposure/{ISO3}.json` | 직접 통화·부문 + C/D 파생 FXD·부채 재구성 | 수집 후 |
| `position_closure/index.json` | RAS 폐합 가용 기간 | 수집 후 |
| `position_closure/{period}.json` | IIP 마진↔PIP seed 양자 포지션 폐합(E) | 수집 후 |
| `flowmatrix/{period}.json` | BOP 마진 기반 자산 간 모델 배분(E) | 수집 후 |
| `vintages/{date}.json` | 실질 변경 시 빈티지 다이제스트 | 실질 변경 시 |

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

- `estimate_method`는 **파생·추정치(C~E)에서 필수**. 범위는 수치군 계약에 따라
  95% 신뢰구간·민감도 corridor·Fréchet 한계 중 의미를 명시하며, D/E는 항상 유한한
  `lower_bound`/`upper_bound`를 가진다. v3의 reconstructed/FXD C도 범위를 필수로 한다.
- A에선 셋 다 생략. **B는 `estimate_method`를 분류·매핑 주석 용도로 가질 수
  있다**(값 자체는 직접 관측인데 분류에 매핑 가정이 개입한 경우 — 예: BIS LBS
  G 상품의 포지션 방향 분류). 범위를 갖는 C는 해당 수치군의 산식·범위 의미를 함께
  공개한다.

### stocks_{basis}.json

```json
{
  "basis": "owner",
  "records": [
    {
      "country": "KOR",
      "asset": "listed_equity",
      "period": "2024-Q4",
      "measure": "stock",
      "value_usd": 84200000000,
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

**은행 채널 (Phase M — BIS LBS)**: `flows_bilateral`에 분기 은행 회랑이 병합된다
(`source_id: "bis_lbs"`, `asset: loans|deposits`, `measure: "stock"`, grade B).
- 방향 매핑: LBS claims(보고국 은행의 대외 채권) → `asset=loans`,
  owner=보고국 / liabilities(상대국의 예치) → `asset=deposits`, owner=상대국.
  LBS G(loans and deposits) 합산 상품의 포지션-방향 분류이므로 grade B +
  `estimate_method: "lbs_loans_and_deposits_instrument_mapped_by_position_side"`.
- **중복 가드(§5)**: `stocks_owner`의 deposits/loans 국가 총계(IIP, A)는 불변 —
  BIS는 양자 분해만 담당. 총계↔양자합 불일치는 보고국 커버리지 차이로 자연스럽고,
  조정하지 않고 `pipeline_report.bis_lbs`에 기록한다(§12).
- 이 병합으로 `flows_bilateral` 가용 기간이 연(Q4)에서 **분기**로 확장된다
  (분기 샤드는 은행 채널만, Q4 샤드는 CPIS+은행 혼합). 재생성: `pnpm data:bis`
  (전체 재수집 불요, 멱등) 또는 `data:fetch` 체인.

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

| mode | 의미 | cadence 허용값 | 대표 소스 |
|---|---|---|---|
| `live_market` | 실시간·일중 시장 데이터. 발표 지연 없음, 폴링/스트림 대상 | intraday, daily | coingecko_global |
| `batch_official` | 공식 통계 배치. 분기/연간 + 발표 지연이 본질 — "실시간" 개념 없음 | monthly, quarterly, annual | imf_iip, imf_iipcc, imf_bop, imf_pip, imf_ifs_fx, bis_lbs, wb_wdi |
| `derived_model` | 파이프라인 내부 파생·모델. 수집이 아니라 계산 (grade C–E) | quarterly, annual | model_regional_median, model_gdp_ratio |
| `static_reference` | 정적 참조 (지오메트리·국가 마스터, vendored 패키지) | static | natural_earth, world_countries |

규칙: **`live_market`·`static_reference` 소스는 stocks/flows 수치 레코드를 뒷받침할 수
없다** — 시장 데이터가 공식 통계로 위장하지 않는다(`scripts/fetch/registry.test.ts`).
live 데이터는 `meta/` 통제값·오버레이 전용.

### CoinGecko 일중 오버레이 — 공식 통계 비오염 계약

- 브라우저는 공개 global endpoint 한 곳만 호출하며 결과는 암호자산 글로벌 시총(B)에만
  사용한다. 국가 배분·공식 지수·`index.generated_at`을 수정하지 않는다.
- UI는 항상 `LIVE MARKET · NOT OFFICIAL STATISTICS · B`와 실제 조회시각을 같은 픽셀에
  표시한다. 30분보다 오래된 값 또는 5분보다 미래인 시각은 거부한다.
- 최초 1회 + 5분 간격 최대 12회로 제한하고 unmount 시 요청을 abort한다. 실패하거나
  freshness를 통과하지 못하면 `meta/global_crypto.json`으로 폴백하되
  `SNAPSHOT FALLBACK`을 숨기지 않는다.
- live 응답은 정적 facts/stocks/flows에 기록하지 않는다. 인증·비밀키·다중 feed가
  필요해지면 클라이언트 호출을 확장하지 않고 아키텍처를 재검토한다.

### meta/synoptic.json — SYNOPTIC 대시보드 사전 집계

`scripts/build/synoptic.ts`가 커밋된 샤드에서 **네트워크 없이** 생성
(`pnpm data:synoptic`, 데이터 재수집 후 반드시 재실행). 대시보드는 이 파일
하나만 lazy-load 한다 — 클라이언트의 65분기 샤드 순회 금지. TS 미러:
`src/types/data.ts`의 `SynopticFile`.

- `per_quarter[period][asset]`: 글로벌 stock/flow(양측)/valuation 합계 —
  **모든 값에 관측(A/B)-한정 `*_obs` 변형 동반** (VIS=OBS 다이얼 근거),
  `obs_share`(가치가중 관측 비중 0..1) 포함.
- `corridors[period]`: bilateral 상위 20 회랑 — `stock`(CPIS 포지션 A)과
  `flow`(파생 D) 분리. lineage(등급·산식·범위) 운반.
- `anomalies[period]`: |flow| 상위 — **자산별 상한 12** (자산 필터가 구성상
  빈 화면이 되지 않게), 전역 표시는 UI가 앞 12개만 자른다.
- `grade_mix[period]`: A~E 레코드 수 (시정 바).
- 계약 테스트: `scripts/build/synoptic.test.ts` (표본 분기 합계 = 샤드 직접
  합산 대조 포함). 5MB 초과 시 샤딩 조항.

### station/{ISO3}.json — STATION 관측 분석 사전 집계

`scripts/build/station.ts`가 커밋된 샤드에서 **네트워크 없이** 생성
(`pnpm data:station`, 데이터 재수집 후 반드시 재실행). STATION 뷰는 국가당
파일 하나만 lazy-load 한다 — 클라이언트 LRU에서 **샤드 취급**(`station/index.json`만
핀). TS 미러: `src/types/data.ts`의 `StationFile`.

- `series[asset][]`: 분기점 {stock(owner), grade, **D/E면 stock_lower/upper
  신뢰구간 밴드 + method**, source_id, stock_issuer 병렬(의미는 issuer 표),
  flow_in/flow_out(BPM6 부호 보존), flow_grade, valuation}. §1.5 — 점 단위 계보.
- `partners[period]`: CPIS **포지션(stock)만** — 파생 flow(D)는 매트릭스 비대상.
  `all`(자산 합산, 등급=구성 worst, 구성 corridor 합·source IDs·합산 산식 동반) +
  자산별, holdings(보유)/holders(피보유) 각 상위 15. holdings는 보고자 PIP 직접
  관측(A), holders는 PIP 상대국 비중으로 reconstructed aggregate를 배분한 C등급이다.
  holders는 IIP 하향식 총계가 있어 유한 proportional corridor를 만들 수 있을 때만
  발행하며, 양쪽 숫자는 각각 독립 dossier를 연다.
- `summary`: 최신 분기 총잔액·양측 흐름·구성·가치가중 관측 비중.
- `WLD.json` = 세계 집계. 점 등급은 가치가중 관측 비중의 매핑(≥.95 A / ≥.8 B /
  ≥.5 C / ≥.25 D / 그 외 E), `obs_share` 동반 — 개별 레코드 주장 아님.
- 계약 테스트: `scripts/build/station.test.ts` (표본 KOR 샤드 대조 + WLD↔synoptic
  교차 대조 포함). 파일당 5MB 조항.
- **`concentration` (§14 집중도 — Phase H)**:
  - `quarterly[]`: {period, share_of_world(국가 총액÷세계 총액),
    share_of_world_assets(자산별 국가÷세계), asset_shares(자산÷국가 총액, 합=1),
    grade=구성 worst, source_ids, method}. 정확-기간 합.
  - `counterparty[]`: {period(CPIS 연간·Q4), scope('all'|자산), hhi, top5_share,
    top5[{country,share}], gross_usd, n_partners, grade, source_ids, method}.
    **발행 bilateral 샤드 전체에서 계산** — station의 top-15 리스트 기반 계산 금지
    (꼬리 절단 = HHI 과대평가). 단 샤드 자체가 |값|≥$100M 프루닝본인 한계는
    method 문구에 명시(가치 99.8% 보존).
  - WLD: quarterly share_of_world ≡ 1, counterparty = [](세계의 상대국은 정의 불가).
  - 계약 테스트: `scripts/build/concentration.test.ts` (HHI 알려진 분포·KOR 샤드
    독립 재계산 대조·WLD≡1·synoptic 교차).

### meta/synoptic.json §14 확장 (Phase H)

- `per_quarter[period][asset]`에 `share`(자산÷분기 총 잔액, 합=1)와
  `share_obs`(관측-한정 변형 — VIS=OBS 근거) 추가.
- `corridor_concentration[period]`: {top10_share, top20_share, gross_usd,
  `*_obs` 변형, gross_obs_usd} — 분모는 샤드 전체 stock gross(top-20 리스트 아님).

### meta/fx_rates.json — 분기 환율 (Phase L)

`scripts/fetch/fx.ts`(`pnpm data:fx`, `data:fetch`에 포함)가 생성. CURR=LCU 다이얼의
근거. TS 미러: `FxRatesFile`.

- 소스 사다리: IMF ER `XDC_USD`·`EOP_RT`(기말, 분기, grade A) → WB `PA.NUS.FCRF`
  연간을 Q4에 적용(grade B + `method: wb_pa_nus_fcrf_annual_rate_q4`) → 둘 다 없으면
  국가 미제공(정직 공백 — 날조 금지).
- `countries[ISO3] = { currency(ISO 4217, world-countries), quarterly, rates{[period]:
  {rate(LCU per USD), grade, source_id, effective_date, method?}} }`.
- 소비 규칙: LCU 표시는 **국가 스코프 전용**(글로벌 집계는 통화 합산 무의미 → USD 고정).
  연간 국가는 같은 해 Q4 환율을 분기에 적용(공개된 근사). 분기 환율 부재 = '—'.
  도시에 원값은 항상 USD, LCU 표시 수치엔 FX RATE 행 병기(`src/lib/money.ts` 계약).
- `value_usd_constant_fx`(stocks)는 **미산출 유지** — 핵심 관측 샤드를 파생값으로
  덮어쓰지 않는다. v3 FXD는 아래 `exposure/`의 별도 coverage-gated 결과다.

### exposure/ — 통화·부문·파생 부채·FXD (v3)

v3는 기존 `stocks_*` 관측을 덮어쓰지 않고 `exposure/{ISO3}.json`에 별도 발행한다.
`exposure/index.json`은 가용 국가·기간과 명시적 고정환율 기준분기를 가진다.

- `currency[]`: IMF IIPCC의 대외채권·채무 통화구성 직접 관측(A). 비중복 버킷
  `USD|EUR|JPY|XDC|OTHC|UALLC`만 허용하며, 외화 소계 `FC`는 하위 통화와 겹치므로
  적재 금지한다. 부문은 IIPCC 정식 코드만 유지하고 결합군을 임의 분해하지 않는다.
- `sectors[]`: IMF PIP의 포트폴리오 자산 부문별 직접 관측(A). `S11`(비금융기업),
  `S13`(정부), `S14`(가계)가 실제 보고된 경우에만 독립 축으로 노출한다.
  `S1V`는 비금융기업·가계·NPISH 결합군 그대로이며 세 부문으로 배분하지 않는다.
- `reconstructed_liabilities[]`: 상대국 자산 보고를 전치한 파생 부채(C). 직접 부채
  관측이나 독립 미러로 부르지 않는다. 산식
  `counterparty_assets_transposed_to_reconstructed_liability`와 상향식 합계↔IIP
  하향식 총계 사이의 수치 범위·커버리지를 필수로 가지며 source lineage는
  `imf_pip`와 `imf_iip`를 모두 포함한다.
- `fxd[]`: `status=available|unavailable` 판별합. 가용 값은 기준분기·산식·등급·
  커버리지·잔여비중·유한 lower/upper를 모두 갖는다. `OTHC+UALLC>5%`, 환율 누락,
  또는 통화합↔총계 gap>0.5%면 숫자를 만들지 않고 비어 있지 않은 `reason`을 발행한다.
  `XDC`는 해당 국가 ISO 통화의 currency-level 환율을 먼저 사용하고 국가별 환율은
  폴백이다. 모든 결과는 IIPCC와 실제 사용한 IMF/WB 환율 `source_ids`를 보존한다.
  `unavailable`에 `value_usd`를 넣는 것은 계약 위반이다.

`position_closure/{period}.json`은 PIP 직접 양자자산을 seed, IIP 자산·부채 총계를
마진으로 하는 RAS/IPF 파생 뷰다. 원 관측을 수정하지 않으며 모든 셀은 grade E,
`biproportional_ras_position_closure`, 직접 seed 커버리지, 반복·잔차, Fréchet 범위를
가진다. 100회 안에 수렴하지 않거나 마진이 닫히지 않으면 산출물을 발행하지 않는다.
직접 seed 커버리지는 IIP 행·열 마진 도메인 안의 PIP 셀만 분자에 포함한다.
전체 행렬로 폐합한 뒤 정적 샤드에는 자산별 상위 1,000셀만 발행한다. 각 자산 결과의
`total_cells`·`omitted_cells`·`omitted_value_usd`가 tail을 숨김없이 기록하며, UI는
국가 셀이 발행 집합에 없을 때 이를 “관측/모델 없음”으로 오인시키지 않는다.

### 결정론적 샤드 + vintages/ — 이중 시간 (Phase N, 초안 §10)

**결정론 계약**: 개별 샤드(`stocks_*`·`flows_*`·`station/*`·`exposure/*`·
`position_closure/*`)와 파생 파일(`meta/synoptic.json`·`meta/flow_intensity.json`·
`meta/fx_rates.json`)은
**타임스탬프를 갖지 않는다** — 동일 상류 데이터 = 동일 바이트(테스트
`scripts/build/deterministic.test.ts`가 바이트 수준 강제). 타임스탬프 보유는
`index.json generated_at`(데이터 빈티지 정본)·`meta/sources.json retrieved_at`
(수집 시각)·`meta/pipeline_report.json`·`meta/global_crypto.json`뿐.

**커밋 게이트**: `pnpm data:changed`가 워킹트리↔HEAD를 대조해
실질(substantive) / 타임스탬프-전용 / 메타데이터로 분류한다. 일일 크론
(`data-refresh.yml`)은 실질 변경일 때만 커밋·배포한다.

**빈티지 다이제스트** (`public/data/vintages/{YYYY-MM-DD}.json` + `index.json`):
실질 변경 커밋마다 `pnpm data:vintage`가 스냅샷 요약을 보존한다 — TS 미러
`VintageDigestFile`. 내용: (basis→국가→자산) 최신 관측 `{p,v,g}`, (basis→국가)
최신분기 총계 `{p,v}`, 글로벌 요약, flow_intensity `(p,v)`. 날짜 =
`index.generated_at` 날짜부(내부 타임스탬프 없음 = 다이제스트도 결정론적).
파일당 5MB 조항 준수(현행 ~150KB).

**REVISIONS 행**(도시에, §15.5): `DossierPayload.revision_key`
(`{basis, country, asset|'total', period}`)가 있는 수치는 빈티지 다이제스트와
대조된다 — 분기 일치 + 상대차 >1e-4일 때만 개정으로 표기(다른 분기 값을
개정으로 오인 금지). 미추적 키는 "not tracked before {date}" 정직 표기.
stock 계열만 추적(흐름·파생 지표는 revision_key 없음 = 행 생략).

### flowmatrix/{period}.json — 자산 간 재배분 행렬 (Phase O, §8 축소 구현)

`scripts/build/flowmatrix.ts`(`pnpm data:flowmatrix`)가 커밋된 `flows_country`
샤드에서 **네트워크 없이** 생성. TS 미러: `FlowMatrixFile`.

- **관측 진실은 마진뿐**: 국가별 BOP `entry=assets` 순흐름(A등급)이 행(매도)/
  열(매수) 합 제약. 매수·매도 차액은 `external` 가상 노드(source=신규 자금 /
  sink=순회수)가 흡수 — 행렬은 항상 폐합(§12, sanity가 전 행렬 검증).
- **셀은 전부 grade E 모델 배분**: IPF(균등 prior = 최대엔트로피 독립해
  `F[i][j] = row_i·col_j / T`), 반복 상한 100·잔차 1e-9(미수렴 = 빌드 실패,
  부분 결과 커밋 금지). `lower/upper`는 **Fréchet 한계**
  (`max(0, r+c−T) ≤ F ≤ min(r, c)`) — 가정 없는 원리적 범위로 E등급
  "범위 필수" 조항을 충족한다.
- **흐름 부문 축 생략**: 초안 §8의 국가×부문×자산 중 BOP 흐름 부문은 원자료에
  분해가 없어 미구현(`basis_note`에 명시). v3 PIP 포지션 부문 관측은 별도
  `exposure/`에 있으며 흐름으로 전용하지 않는다.
- **UI 계약**: STATION ALL 탭 `REALLOC` 보기. 상시 "MODEL ALLOCATION ·
  GRADE E" 라벨 + E-안개, 셀 도시에에 산식·Fréchet 범위·반복·잔차·관측
  마진 전부 노출(source: `model_flow_reallocation` + `imf_bop`).
  **VIS=OBS에서 구역 통째 소멸**(전부 모델 — §6의 가장 순수한 적용).
- 결정론(N1): 타임스탬프 없음, 재실행 바이트 동일(테스트 강제). 65분기 ·
  파일당 ~110KB(5MB 조항 준수). 갱신 체인: `data:station` 다음.

### facts.ndjson.gz — 정본 수치 원장 (v3, 초안 §11.2 축소 + §16-6)

`scripts/build/facts.ts`가 stocks(3 basis)·flows_country·flows_bilateral과 v3
currency/sector/reconstructed/FXD/RAS 레코드를 라인당 JSON 1개(NDJSON)로
평탄화해 gzip 발행한다(505,316건, 6,322,452 bytes). `position_closure` 24,000건은
발행된 상위 셀이며 생략 tail 메타데이터는 원 `position_closure` 샤드가 정본이다.
TS 미러: `FactLine`(scripts/build/facts.ts). 규칙:

- **관측과 파생을 구분 보존**: A/B 직접 관측과 C–E 파생/모델 레코드를 한 원장에서
  조회하되 `confidence_grade`·`estimate_method`·bounds를 삭제해서는 안 된다.
- **UI 집계 비포함**: synoptic/station/flowmatrix는 이 테이블에서 재계산 가능한
  2차 뷰다. `position_closure`는 각 셀의 산식·범위를 감사하는 수치군이라 포함한다.
- **결정론**: 타임스탬프 없음, gzip 헤더 MTIME=0 고정 — 같은 상류면 같은 바이트.
- **정합 게이트**: 레코드 수(테이블별)·등급 분포 = 원 샤드 합. `data:facts`
  self-check + `data:check` + vitest 삼중 강제. 요약은 `meta/facts_summary.json`.
- 옵셔널 lineage 필드(estimate_method/bounds)는 **생략이지 null이 아니다**.
- 재배포 시 원 소스 라이선스(IMF attribution·WB CC BY-4.0·BIS terms) 표기 유지.

### reconciliation — §12-3 미러 폐합 (Phase P)

BIS LBS 양방향: **owner국 보고 claims(asset=loans)** vs **issuer국 보고
liabilities(asset=deposits)** 는 같은 방향(owner→issuer) 은행 포지션의 두 독립
관측. `scripts/build/reconcile.ts`가 커밋된 bilateral 샤드에서 계산한다(네트워크
없음, 결정론).

- `reconciliation/{period}.json`: `{ pairs: [{owner, issuer, claims_usd,
  liabilities_usd, gap_usd, gap_share}] }` — (owner,issuer) 정렬. 양쪽 관측이
  모두 있는 쌍만(§12 정신 — 조정하지 않고 기록, 한쪽뿐이면 정직 생략).
- `meta/reconciliation.json`: 분기별 분포(median/p25/p75 gap_share)·최신 상위
  gap 10쌍·method/caveat. sanity 게이트: 최신 분기 쌍≥100, 중앙 gap∈(0, 90%)
  (관대 임계 — gap은 상대국 부문 커버리지 차이가 섞여 수십%가 정상, 실측 ~36%).
- **PIP 직접 관측은 소유자 단방향이라 독립 미러 불가** — v3
  `reconstructed_liabilities`는 상대국 정보 전치 C등급이며 직접 미러를 대체하지 않는다.
- 프루닝(|값|≥$100M)으로 한쪽이 임계 미만인 쌍은 비교 불가 → 생략(도시에
  MIRROR 행 문구에 명시).
- UI: bis_lbs 양자 레코드의 계보 도시에 **MIRROR** 행(`mirror_key` — 자산 탭
  DEP/LOAN에서 부여, ALL 스코프는 자산 모호로 미부여).

## enum 정본

- `basis`: `owner` | `issuer` | `location`
- `measure_type`: `stock` | `flow` | `valuation` | `turnover`
- `asset`: `deposits` | `loans` | `debt_securities` | `listed_equity` |
  `unlisted_equity_fdi` | `funds` | `reserves_gold` | `residential_property` |
  `commodities` | `crypto`
- `confidence_grade`: `A`–`E`

## v3 소스 우선순위 (참고)

IMF IIP/BOP(잔액·흐름 골격) → IMF IIPCC(통화구성) → IMF PIP(양자·부문·SCC)
→ BIS 채무증권·LBS(채권·은행)
→ World Bank/WFE(시가총액 통제값) → 파생·롤포워드(C) → 모델(D/E).
모든 소스는 `meta/sources.json`에 등록 후 사용.
