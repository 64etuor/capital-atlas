# Data Pipeline (v3)

공개 통계 API → 정규화 → 계약 데이터셋(`public/data/`) 생성. 서버 없음 — 오프라인
스크립트가 정적 JSON을 굽는다.

## 실행

```bash
pnpm data:fetch
pnpm data:bis
pnpm data:exposure
pnpm data:closure
pnpm data:synoptic
pnpm data:station
pnpm data:flowmatrix
pnpm data:facts
pnpm data:reconcile
pnpm data:sources
pnpm data:check
```

화살표 순서 전체가 갱신 계약이다. `data:fetch` 뒤에는 조립 과정에서 다시 만들어진
bilateral에 BIS를 재병합하고, 그 다음 exposure/RAS와 모든 집계·원장을 재발행한다.

원시 응답은 `data-raw/`(gitignore)에 보존된다. 재실행은 24h 내 캐시를 재사용한다.
필수 공식 소스는 stage 단위로 원자적이다. bounded retry 뒤 요청 하나라도 실패하면
그 stage의 normalized 파일을 덮어쓰지 않고, BIS 성공-빈 응답을 포함한 모든 필수
네트워크 검증이 끝나기 전에는 public 산출을 쓰지 않는다. CoinGecko 글로벌 통제값만
명시적 optional이며 정적 스냅샷으로 폴백한다.

## 소스별 상태

행·보고국 수는 API 개정 때마다 바뀐다. 공개 수치군의 현재 건수는
`meta/facts_summary.json`, 기간은 `index.json`, BIS 프루닝·실패 내역은
`meta/pipeline_report.json`이 정본이며 이 표에 스냅샷 숫자를 복제하지 않는다.

| source_id | 데이터 | 상태 | 등급 |
|---|---|---|---|
| `imf_iip` | 대외 자산·부채 잔액, 국가×분기 (2010~) | ✅ 런타임 발견 | A |
| `imf_iipcc` | 대외채권·채무 통화구성 | ✅ 런타임 발견 | A |
| `imf_bop` | 금융계정 실거래 흐름, 국가×분기 | ✅ 런타임 발견 | A |
| `imf_pip` | 양자 포트폴리오 자산 (CPIS/PIP), 연간 2013~ | ✅ 런타임 발견 | A |
| `imf_pip` sector | 보고 부문별 포트폴리오 자산 | ✅ 런타임 발견 | A |
| `imf_pip` SCC | 상대국 정보로 유도한 포트폴리오 부채 | ✅ 런타임 발견 | C |
| `wb_wdi` | 상장주식 시총(발행국 총액)·GDP, 연간 | ✅ 런타임 발견 | B |
| `coingecko_global` | 암호자산 글로벌 통제값 + 분리된 일중 오버레이 | ✅ 글로벌만(국가배분 없음) | B |
| `bis_lbs` | 국경 간 은행 loans&deposits 양자 회랑, 분기 (Phase M) | ✅ 런타임 발견 | B |
| BIS DSS | 채무증권 발행잔액 | ❌ 미착수 (후속) | — |

**IMF API 주의**: 구 `dataservices.imf.org`는 DNS까지 폐기됨. 신 API는
`api.imf.org/external/sdmx/2.1` — **데이터는 SDMX StructureSpecificData XML만**
반환한다(JSON Accept 무시/500). 키 차원과 코드값은 문서보다 실호출 프로브가 정확했다:

- IIP/BOP 키: `COUNTRY.BOP_ACCOUNTING_ENTRY.INDICATOR.UNIT.FREQUENCY` (ISO3, USD, Q)
- IIPCC 키: `COUNTRY.BOP_ACCOUNTING_ENTRY.INDICATOR.CURRENCY.UNIT.FREQUENCY`.
  보고 부문은 별도 차원이 아니라 `DCNRES_DIC_S13` 같은 indicator 코드에 포함된다.
  `A_P/L_P` debt와 비중복 통화 버킷 `USD|EUR|JPY|XDC|OTHC|UALLC`만 적재한다.
- 잔액 엔트리: `A_P`/`L_P`. **흐름 엔트리는 `A_NFA_T`(자산 순취득)/`L_NIL_T`(부채 순발생)** — `A_T`/`L_T` 아님(1차 실행 0건의 원인).
- PIP 키: `COUNTRY.ACCOUNTING_ENTRY.INDICATOR.SECTOR.COUNTERPART_SECTOR.COUNTERPART_COUNTRY.FREQUENCY` — `{iso3}.A.P_F51_P_USD+P_F3_P_USD.S1.S1..A`
- PIP 부문은 원 코드를 그대로 보존한다. `S1V` 같은 결합군을 가계·기업으로 나누지
  않는다. SCC 지표(`*_SCC_USD`)는 IMF가 상대국 정보로 유도한 부채이므로 C등급이며,
  직접 관측이나 독립 미러로 승격하지 않는다.
- OBS_VALUE는 절대 USD (KOR D A_P 2024-Q4 ≈ $769.5B로 검증).

**BIS API (Phase M, 2026-07-13 실호출 프로브)**: `stats.bis.org/api/v2/data/dataflow/`
SDMX 2.1 REST, `format=csv`(SDMX-CSV) 지원 — IMF와 달리 CSV가 나와 파싱이 쉽다.

- LBS dataflow: `BIS/WS_LBS_D_PUB/1.0`, key **12차원**
  `Q.S.{C|L}.G.TO1.A.5J.A.{REP}.A.{CP}.N` (S=잔액, C/L=claims/liabilities,
  G=loans and deposits, TO1=전통화, 5J=전체 모행 소재국, N=cross-border).
- 값은 `OBS_VALUE × 10^UNIT_MULT`(=6, 백만 USD). 검증: KR→US claims 2024-Q4
  = $47.670B, KR liabilities to US = $14.191B (샤드 병합값과 정확 일치).
- 보고국은 1분기 전체 와일드카드로 런타임 발견한다. 국가 마스터 밖 역외센터는
  정직하게 드랍하고 실제 채택·드랍 코드를 `pipeline_report.bis_lbs`에 기록한다.
- 상품 G는 loans+deposits 합산 — 포지션 방향으로 분류(claims=loans/
  liabilities=deposits), grade B + estimate_method로 공개. 수집: `pnpm data:bis`
  (멱등 병합, 전체 재수집 불요).

## 자산 매핑 (BPM6 → 계약 asset)

| BPM6 지표 | asset | 비고 |
|---|---|---|
| `D` / `D_F` | `unlisted_equity_fdi` | 직접투자 |
| `P_F5_MV` / `P_F5` | `listed_equity` | 펀드지분 포함(F51+F52) — v1 한계 |
| `P_F3_MV` / `P_F3` | `debt_securities` | |
| `O_F2_NV` / `O_F2` | `deposits` | |
| `O_F4_NV` / `O_F4` | `loans` | |
| `R` | `reserves_gold` | owner 기준만 |
| PIP `P_F51_P_USD` | `listed_equity` | 양자 |
| PIP `P_F3_P_USD` | `debt_securities` | 양자 |

## 의미 계약 (Phase C 필독)

- **stocks_owner** = 거주자의 **대외**(국경 간) 자산. 국내 보유분은 v2.
- **stocks_issuer** = 자산별 의미 고정(계약 문서 표 참조): listed_equity만 WB **총액**,
  나머지는 비거주자 보유 대외부채.
- **flows_country** 부호: `entry=assets` 양수 = 거주자의 해외자산 취득(유출측),
  `entry=liabilities` 양수 = 비거주자의 국내 투자(유입측). BPM6 부호 보존.
- **flows_bilateral**: PIP는 연간 → `YYYY-Q4`로 표기. 파생 flow는 가격효과 미조정
  (`position_change_unadjusted_for_price`, D등급) — 가격조정 C등급은 v2.
- **평가변동**(valuation) = ΔIIP 포지션 − BOP 거래 (둘 다 관측된 분기만, C등급).

## 폴백 사다리 ("빈칸 금지", 초안 §6 축소판)

1. 직접 관측 (A/B)
2. 직전 관측 롤포워드, 최대 8분기 (D, ±20%)
3. 지역(subregion) 중앙값 GDP-비율 모델, 최근 4분기만 (E, ±35%)
4. GDP 앵커도 없으면 숫자를 만들지 않고 **명시적 unavailable 상태/사유**를 노출 —
   `meta/pipeline_report.json`에 커버리지 기록

주거부동산(location)은 지역별 주택자산/GDP 배율 휴리스틱(1.5~3.1×, 기본 1.6×) E등급.
조야한 v1 모델임을 명시한다 — 등기·센서스 기반은 v2.

## 프루닝 (침묵 금지)

양자 레코드는 |값| ≥ $100M만 유지 — 레코드 16.4%로 가치 99.82% 보존(실측).
드롭 수는 조립 로그와 `meta/pipeline_report.json`에 기록된다.

## 알려진 한계 (v3)

- 핵심 `stocks.value_usd_constant_fx`는 원 관측을 덮어쓰지 않기 위해 미산출 유지.
  고정환율 수치는 별도 `exposure/*.json`에서만 coverage-gated 파생값으로 제공한다.
- IIP `P_F5`에 펀드지분 포함 → `funds` asset은 미분리.
- PIP 파생 flow는 가격효과 미조정(D등급으로 정직 표기).
- 산출 규모는 station 사전집계 때문에 크지만 정적 서빙 파일은 5MB 계약 게이트를
  통과해야 한다. 다운로드용 `facts.ndjson.gz`의 현재 크기는
  `meta/facts_summary.json`의 `gzip_bytes`가 정본이다. 전부 lazy-load 전제.
  station 용량이 부담되면 후속에서 은행
  파트너 시계열 상한(top-N) 검토.
- BIS 양자합 ↔ IIP 국가 총계는 보고국 커버리지 차이로 불일치 — 조정하지 않고
  `pipeline_report.bis_lbs`에 기록(§12 폐합 정신, §5 중복 가드).
- 최신 분기와 소스별 실제 기간은 `index.json` 및 레코드 `effective_date`가 정본이다.

## exposure + position closure (v3)

- `data:exposure`: IIPCC 통화와 PIP 부문 직접 관측을 그대로 보존한다. FXD는 2020-Q4
  환율을 기준으로 계산하되 `OTHC+UALLC>5%`, 환율 누락, 통화합↔IIP 총계 gap>0.5%면
  값을 발행하지 않고 typed reason을 남긴다. 가용 값도 coverage·residual·민감도 범위를
  반드시 가진다. `XDC`는 국가의 ISO 4217 통화를 찾은 뒤 동일 통화 보고국의
  IMF A등급 환율 중앙값(없으면 WB B등급 중앙값)을 쓰고, 실제 사용한 IIPCC·IMF/WB
  source IDs를 함께 발행한다.
- `reconstructed_liabilities`: PIP SCC/상대국 자산을 부채 방향으로 전치한 C등급이다.
  상향식 합계와 IIP 하향식 총계 사이의 corridor를 범위로 공개하며, 독립 관측이 아니다.
- `data:closure`: 공개 bilateral 샤드의 $100M 절단 전 raw normalized PIP 직접 양자자산을
  seed, IIP 자산·부채를 마진으로 RAS/IPF를 실행한다.
  같은 입력의 결정론적 gzip 감사 미러를 함께 발행하므로 `data-raw/`가 없는 clean CI도
  공개 closure를 원 입력 행에서 독립 재계산할 수 있다.
  `direct_seed_share`는 IIP 행·열 마진 도메인 안에 실제로 들어온 seed만 센다.
  원 샤드를 수정하지 않고 모든 셀을 E등급으로 발행한다. 최대 100회, 잔차 1e-9,
  Fréchet 범위를 만족하지 않으면 부분 결과 없이 실패한다. 가용 기간은
  `position_closure/index.json`이 정본이다. 전체 행렬 폐합 후 기간·자산별 상위
  1,000셀을 발행하고 생략 셀 수·합계는 각 샤드에 보존한다.
- `data:check`: exposure index↔국가 shard↔facts summary의 변동 가능한 건수를 서로
  폐합하고, 통화·부문·재구성·FXD와 모든 발행 RAS 셀을 계약·등급·범위까지 전수 확인한다.

## flowmatrix (Phase O — §8 재배분 행렬)

- 입력: `flows_country/{period}` BOP `entry=assets` 순흐름(A등급)만 — 거주자의
  대외자산 재배분 관점(liabilities는 행위자가 달라 혼합 금지).
- 방법: IPF, 균등 prior(= 최대엔트로피 독립해 `row·col/T`), 상한 100회·잔차
  1e-9. 미수렴이면 빌드 자체가 실패한다(부분 산출 금지).
- 셀 드랍 없음 — 초소액 마진(달러 단위 국가)에서도 폐합이 정확해야 sanity의
  전수 마진 검증이 성립한다(개발 중 $1 컷이 폐합을 깨는 것을 적발해 제거).
- 발행 기간·국가-행렬 수는 `data:flowmatrix`와 sanity가 매 갱신 때 출력·검증한다.
  체인: `data:station` 다음 `data:flowmatrix`(크론 포함 — 체인 누락=스테일 산출물).
